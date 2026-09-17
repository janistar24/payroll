import os
import time
import uuid
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from decimal import Decimal

import psycopg
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator, model_validator

from DBHelper import DBHelper
from departments import Departments
from employees import Employees
from positions import Positions
from organizations import Organizations
from payroll_periods import Payroll_periods
from payroll_items import PayrollItems
from payroll_department_batches import PayrollDepartmentBatches
from pay_item_types import PayItemTypes
from payroll_workflow import PayrollWorkflow, StalePayrollVersionError
from schema_checks import validate_required_schema
from email_service import PayslipEmailService
from auth import auth_service, get_current_user
from audit import AuditLogger

app = FastAPI(
    title="Payroll API",
    version="1.0.0",
)

db = DBHelper()
departments_service = Departments()
employees_service = Employees()
positions_service = Positions()
organizations_service = Organizations()
payroll_periods_service = Payroll_periods()
payroll_items_service = PayrollItems()
payroll_department_batches_service = PayrollDepartmentBatches()
pay_item_types_service = PayItemTypes()
payroll_workflow_service = PayrollWorkflow()
payslip_email_service = PayslipEmailService()
audit_logger = AuditLogger()
environment = os.getenv("APP_ENV", "development").lower()
allowed_origins = [origin.strip() for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if origin.strip()]
trusted_hosts = [host.strip() for host in os.getenv("TRUSTED_HOSTS", "localhost,127.0.0.1").split(",") if host.strip()]

# Railway calls the health endpoint through the service's generated internal
# hostname. Add only this deployment's exact generated hostnames; do not open
# TrustedHostMiddleware to every host.
railway_public_domain = os.getenv("RAILWAY_PUBLIC_DOMAIN", "").strip()
railway_private_domain = os.getenv("RAILWAY_PRIVATE_DOMAIN", "").strip()
railway_service_name = os.getenv("RAILWAY_SERVICE_NAME", "").strip()
for railway_host in (
    "healthcheck.railway.app",
    railway_public_domain,
    railway_private_domain,
    f"{railway_service_name}.railway.internal" if railway_service_name else "",
):
    if railway_host and railway_host not in trusted_hosts:
        trusted_hosts.append(railway_host)

if environment == "production" and (not os.getenv("JWT_SECRET") or not os.getenv("ALLOWED_ORIGINS") or not os.getenv("TRUSTED_HOSTS")):
    raise RuntimeError("production ต้องกำหนด JWT_SECRET, ALLOWED_ORIGINS และ TRUSTED_HOSTS")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=trusted_hosts)


@app.on_event("startup")
def warm_database_connections():
    """Move connection setup out of the first login request."""
    try:
        db.warm_pool()
        validate_required_schema(db)
    except Exception:
        # Keep local development bootable when the database is temporarily
        # offline; healthcheck and the request handlers still report the error.
        logging.warning("Database pool warm-up or schema check was not ready at startup", exc_info=True)
        if environment == "production":
            raise


@app.on_event("shutdown")
def close_database_connections():
    DBHelper.close_pool()


@app.exception_handler(HTTPException)
async def secure_http_errors(request: Request, error: HTTPException):
    detail = error.detail
    if environment == "production" and error.status_code >= 500:
        logging.exception("Request %s failed: %s", request.url.path, detail)
        detail = {"message": "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง"}
    return JSONResponse(status_code=error.status_code, content={"detail": detail})


@app.exception_handler(Exception)
async def unexpected_error(request: Request, error: Exception):
    """Keep API errors JSON-shaped so the browser never misreports them as CORS."""
    logging.exception("Unhandled request failure: %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": {"message": "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง"}},
    )

@app.middleware("http")
async def add_utf8_charset(request, call_next):
    started_at = time.perf_counter()
    request_id = str(uuid.uuid4())
    response = await call_next(request)

    if response.headers.get("content-type", "").startswith("application/json"):
        response.headers["content-type"] = "application/json; charset=utf-8"
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Cache-Control"] = "no-store" if request.url.path.startswith("/api/") else "no-cache"
    if environment == "production":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    response.headers["Server-Timing"] = f"app;dur={(time.perf_counter() - started_at) * 1000:.1f}"

    return response

@app.get("/healthz")
def healthcheck():
    try:
        db.fetch("SELECT 1")
    except Exception as error:
        logging.exception("Healthcheck failed")
        raise HTTPException(status_code=503, detail="ระบบยังไม่พร้อมให้บริการ") from error
    return {
        "status": "ok"
    }

@app.get("/api/departments")
def get_departments(user=Depends(get_current_user)):
    try:
        departments = departments_service.dump()

        return {
            "success": True,
            "count": len(departments),
            "data": departments
        }

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail={
                "message": "ไม่สามารถดึงข้อมูลพนักงานได้",
                "error": str(error)
            }
        )
    
@app.get("/api/employees")
def get_employees(user=Depends(get_current_user)):
    try:
        employees = employees_service.dump(_department_scope(user))

        return {
            "success": True,
            "count": len(employees),
            "data": employees
        }

    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail={
                "message": "ไม่สามารถดึงข้อมูลพนักงานได้",
                "error": str(error)
            }
        )


@app.get("/api/bootstrap")
def get_bootstrap(user=Depends(get_current_user)):
    """Load the directory data needed immediately after login in one browser request."""
    try:
        return {
            "success": True,
            "data": {
                "employees": employees_service.dump(_department_scope(user)),
                "departments": departments_service.dump(),
                "positions": positions_service.dump(),
            },
        }
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail={"message": "โหลดข้อมูลเริ่มต้นไม่สำเร็จ", "error": str(error)})


@app.get("/api/app-data")
def get_app_data(user=Depends(get_current_user)):
    """Return everything the authenticated shell needs in one browser request.

    This removes a second token-validation query and a browser round-trip at
    login while keeping each service as the single source of database data.
    """
    try:
        department_id = _department_scope(user)
        # These reads are independent.  Keep one HTTP request for the
        # browser, while letting the bounded database pool run the reads in
        # parallel instead of adding their remote latency together.
        with ThreadPoolExecutor(max_workers=6) as executor:
            employees_future = executor.submit(employees_service.dump, department_id)
            departments_future = executor.submit(departments_service.dump)
            positions_future = executor.submit(positions_service.dump)
            payroll_future = executor.submit(payroll_periods_service.dump, department_id)
            pay_item_types_future = executor.submit(pay_item_types_service.dump)
            organizations_future = executor.submit(organizations_service.dump)
            # Employee directory data is required for the application shell.
            # Optional payroll-related reads are isolated below so one broken
            # report query cannot make the Employees page fail with the same 500.
            employees = employees_future.result()
            departments = departments_future.result()
            positions = positions_future.result()
            warnings = {}

            def optional_result(name, future):
                try:
                    return future.result()
                except Exception as optional_error:
                    logging.exception("Unable to load optional app-data section: %s", name)
                    warnings[name] = str(optional_error)
                    return []

            payroll_periods = optional_result("payroll_periods", payroll_future)
            pay_item_types = optional_result("pay_item_types", pay_item_types_future)
            organizations = optional_result("organizations", organizations_future)
        return {
            "success": True,
            "data": {
                "employees": employees,
                "departments": departments,
                "positions": positions,
                "payroll_periods": payroll_periods,
                "pay_item_types": pay_item_types,
                "organizations": organizations,
                "warnings": warnings,
            },
        }
    except HTTPException:
        raise
    except Exception as error:
        logging.exception("Unable to load authenticated application data")
        raise HTTPException(status_code=500, detail={"message": "โหลดข้อมูลเริ่มต้นไม่สำเร็จ", "error": str(error)})


EMPLOYEE_TYPES = {
    "CIVIL_SERVANT",
    "MUNICIPAL_EMPLOYEE",
    "PERMANENT_WORKER",
    "TEMPORARY_EMPLOYEE",
    "GENERAL_EMPLOYEE",
    "CONTRACT_EMPLOYEE",
    "POLITICAL_OFFICIAL",
    "REGULAR_PENSIONER",
    "TEACHER_PENSIONER",
    "PERMANENT_WORKER_MONTHLY_PENSION",
    "OTHER"
}
EMPLOYEE_STATUSES = {
    "ACTIVE",
    "ON_LEAVE",
    "RESIGNED",
    "RETIRED",
    "TERMINATED"
}


class EmployeeSave(BaseModel):
    # This legacy identifier is generated by the server and never displayed.
    employee_code: str = Field(default="", max_length=30)
    national_id: str = Field(min_length=13, max_length=13)
    prefix: str | None = Field(default=None, max_length=20)
    first_name: str = Field(min_length=1, max_length=150)
    last_name: str = Field(min_length=1, max_length=150)
    department_id: int | None = None
    organization_id: int | None = None
    position_id: int | None = None
    employee_type: str
    employee_type_other: str | None = Field(default=None, max_length=150)
    status: str = "ACTIVE"
    birth_date: date | None = None
    start_date: date | None = None
    end_date: date | None = None
    email: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=30)
    bank_name: str | None = Field(default=None, max_length=150)
    bank_account_no: str | None = Field(default=None, max_length=50)
    base_salary: Decimal = Field(ge=0, max_digits=12, decimal_places=2)

    @field_validator("national_id")
    @classmethod
    def validate_national_id(cls, value):
        if not value.isdigit():
            raise ValueError("เลขประจำตัวประชาชนต้องเป็นตัวเลข 13 หลัก")
        return value

    @field_validator("employee_type")
    @classmethod
    def validate_employee_type(cls, value):
        if value not in EMPLOYEE_TYPES:
            raise ValueError("ประเภทพนักงานไม่ถูกต้อง")
        return value

    @field_validator("status")
    @classmethod
    def validate_status(cls, value):
        if value not in EMPLOYEE_STATUSES:
            raise ValueError("สถานะพนักงานไม่ถูกต้อง")
        return value

    @model_validator(mode="after")
    def validate_employee_type_other(self):
        if self.employee_type == "OTHER" and not (self.employee_type_other or "").strip():
            raise ValueError("กรุณาระบุประเภทพนักงานอื่นๆ")
        if self.employee_type != "OTHER":
            self.employee_type_other = None
        return self


class EmployeeStatusUpdate(BaseModel):
    status: str

    @field_validator("status")
    @classmethod
    def validate_status(cls, value):
        if value not in EMPLOYEE_STATUSES:
            raise ValueError("สถานะพนักงานไม่ถูกต้อง")
        return value


class EmployeeEmailUpdate(BaseModel):
    email: str = Field(min_length=5, max_length=255)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value):
        value = value.strip()
        if "@" not in value or value.startswith("@") or value.endswith("@"):
            raise ValueError("กรุณากรอกอีเมลให้ถูกต้อง")
        return value


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=255)


class UserCreateRequest(BaseModel):
    username: str = Field(min_length=3, max_length=100)
    temporary_password: str = Field(min_length=8, max_length=255)
    employee_id: int
    role: str

    @field_validator("role")
    @classmethod
    def validate_role(cls, value):
        if value not in {"hr", "director", "admin"}:
            raise ValueError("สิทธิ์ผู้ใช้งานไม่ถูกต้อง")
        return value


class PasswordResetRequest(BaseModel):
    temporary_password: str = Field(min_length=8, max_length=255)


class PasswordChangeRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=255)
    new_password: str = Field(min_length=8, max_length=255)


class InviteCreateRequest(BaseModel):
    email: str = Field(min_length=5, max_length=255)
    requested_role: str

    @field_validator("requested_role")
    @classmethod
    def validate_requested_role(cls, value):
        if value not in {"hr", "director", "admin"}:
            raise ValueError("สิทธิ์ผู้ใช้งานไม่ถูกต้อง")
        return value


class AccessRequestSubmit(BaseModel):
    username: str = Field(min_length=3, max_length=100)
    password: str = Field(min_length=8, max_length=255)
    position_name: str | None = Field(default=None, max_length=255)
    organization_name: str | None = Field(default=None, max_length=255)
    employee: EmployeeSave

    @model_validator(mode="after")
    def validate_required_invite_employee_data(self):
        if self.employee.birth_date is None:
            raise ValueError("กรุณากรอกวันเดือนปีเกิดให้ครบถ้วน")
        if self.employee.department_id is None:
            raise ValueError("กรุณาเลือกฝ่าย")
        if not self.employee.first_name.strip() or not self.employee.last_name.strip():
            raise ValueError("กรุณากรอกชื่อและนามสกุล")
        return self


class AccessRequestApprove(BaseModel):
    actual_role: str

    @field_validator("actual_role")
    @classmethod
    def validate_actual_role(cls, value):
        if value not in {"hr", "director", "admin"}:
            raise ValueError("สิทธิ์ผู้ใช้งานไม่ถูกต้อง")
        return value


class AccessRequestReject(BaseModel):
    reason: str | None = Field(default=None, max_length=1000)

class PayrollRevisionCreate(BaseModel):
    revision_type: str = Field(min_length=1, max_length=40)
    reason: str = Field(min_length=5, max_length=1000)


class PayrollPeriodCreate(BaseModel):
    month: int = Field(ge=1, le=12)
    year: int = Field(ge=2000, le=3000)
    pay_date: date
    note: str | None = Field(default=None, max_length=500)
    department_id: int | None = None


class PayrollRowSave(BaseModel):
    employee_id: int
    lines: dict[str, Decimal] = Field(default_factory=dict)

    @field_validator("lines")
    @classmethod
    def validate_lines(cls, value):
        if any(not code or len(code) > 80 or not code.replace("_", "").isalnum() for code in value):
            raise ValueError("รหัสประเภทรายการเงินเดือนไม่ถูกต้อง")
        if any(amount < 0 for amount in value.values()):
            raise ValueError("จำนวนเงินต้องไม่ติดลบ")
        return value


class PayrollChangeNoteSave(BaseModel):
    employee_id: int
    field_code: str = Field(min_length=1, max_length=80)
    old_value: Decimal
    new_value: Decimal
    reason: str = Field(min_length=1, max_length=1000)


class PayrollBatchSave(BaseModel):
    rows: list[PayrollRowSave]
    change_notes: list[PayrollChangeNoteSave] = Field(default_factory=list)
    expected_version: int = Field(ge=0)


class PayItemTypeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    category: str

    @field_validator("category")
    @classmethod
    def validate_category(cls, value):
        if value not in {"EARNING", "DEDUCTION"}:
            raise ValueError("ประเภทรายการไม่ถูกต้อง")
        return value


class PayrollBatchAction(BaseModel):
    action: str
    reject_reason: str | None = Field(default=None, max_length=500)
    expected_version: int = Field(ge=0)

    @model_validator(mode="after")
    def validate_rejection_reason(self):
        if self.action not in {"submit", "approve", "reject"}:
            raise ValueError("คำสั่งเปลี่ยนสถานะไม่ถูกต้อง")
        if self.action == "reject" and not (self.reject_reason or "").strip():
            raise ValueError("กรุณาระบุเหตุผลที่ส่งกลับแก้ไข")
        return self


def _require_payroll_role(user):
    if user["role"] not in {"hr", "director", "admin", "finance", "dept_head"}:
        raise HTTPException(status_code=403, detail="ไม่มีสิทธิ์เข้าถึงข้อมูลเงินเดือน")


def _department_scope(user):
    _require_payroll_role(user)
    if user["role"] == "hr":
        if user["department_id"] is None:
            raise HTTPException(status_code=403, detail="บัญชีพนักงานฝ่ายธุรการยังไม่ได้ผูกกับฝ่าย")
        return user["department_id"]
    return None


def _require_global_payroll_role(user):
    if user["role"] not in {"director", "admin", "finance"}:
        raise HTTPException(status_code=403, detail="ไม่มีสิทธิ์ดูข้อมูลเงินเดือนทุกฝ่าย")


def _require_employee_creation_role(user):
    if user["role"] not in {"hr", "director", "admin"}:
        raise HTTPException(status_code=403, detail="ไม่มีสิทธิ์เพิ่มพนักงาน")


def _ensure_batch_access(batch_id, user, allow_approval=False):
    data, columns = db.fetch(
        "SELECT id, department_id, submitted_by_id FROM public.payroll_department_batches WHERE id = %s",
        (batch_id,)
    )
    if not data:
        raise HTTPException(status_code=404, detail="ไม่พบรายการฝ่ายของรอบเงินเดือน")
    batch = dict(zip(columns, data[0]))
    if allow_approval:
        _require_global_payroll_role(user)
    else:
        scope = _department_scope(user)
        if scope is not None and batch["department_id"] != scope:
            raise HTTPException(status_code=403, detail="ไม่มีสิทธิ์จัดการข้อมูลของฝ่ายอื่น")
    return batch


def _ensure_payroll_item_access(payroll_item_id, user):
    data, columns = db.fetch(
        """
        SELECT item.id, item.department_id, batch.status AS batch_status
        FROM public.payroll_items item
        JOIN public.payroll_department_batches batch ON batch.id = item.department_batch_id
        WHERE item.id = %s
        """,
        (payroll_item_id,)
    )
    if not data:
        raise HTTPException(status_code=404, detail="ไม่พบรายการสลิปเงินเดือน")
    item = dict(zip(columns, data[0]))
    scope = _department_scope(user)
    if scope is not None and item["department_id"] != scope:
        raise HTTPException(status_code=403, detail="ไม่มีสิทธิ์ส่งอีเมลของฝ่ายอื่น")
    if item["batch_status"] != "APPROVED":
        raise HTTPException(status_code=400, detail="ส่งสลิปได้เมื่อรายการของฝ่ายได้รับอนุมัติแล้วเท่านั้น")
    return item


@app.post("/api/auth/login")
def login(request: LoginRequest, http_request: Request):
    username = request.username.strip()
    client_ip = http_request.client.host if http_request.client else "unknown"
    auth_service.ensure_login_allowed(username, client_ip)
    user = auth_service.authenticate(username, request.password)
    if user is None:
        auth_service.record_login_failure(username, client_ip)
        raise HTTPException(status_code=401, detail="ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง")
    auth_service.clear_login_failures(username, client_ip)
    return {
        "success": True,
        "data": {
            "access_token": auth_service.create_token(user),
            "token_type": "bearer",
            "user": user
        }
    }


@app.get("/api/auth/me")
def auth_me(user=Depends(get_current_user)):
    return {"success": True, "data": user}


def _require_admin(user):
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="เฉพาะผู้ดูแลระบบเท่านั้น")


@app.get("/api/users")
def get_users(user=Depends(get_current_user)):
    _require_admin(user)
    return {"success": True, "data": auth_service.list_users()}


@app.post("/api/users", status_code=201)
def create_user(request: UserCreateRequest, user=Depends(get_current_user)):
    try:
        _require_admin(user)
        user_id = auth_service.create_user(request.username.strip(), request.temporary_password, request.employee_id, request.role)
        audit_logger.log(user["id"], "CREATE_USER", "user", user_id, {"username": request.username, "employee_id": request.employee_id, "role": request.role})
        return {"success": True, "data": {"id": user_id}}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except psycopg.errors.UniqueViolation:
        raise HTTPException(status_code=409, detail="Username นี้ถูกใช้งานแล้ว")


@app.post("/api/users/{user_id}/reset-password")
def reset_user_password(user_id: int, request: PasswordResetRequest, user=Depends(get_current_user)):
    try:
        _require_admin(user)
        auth_service.reset_password(user_id, request.temporary_password)
        audit_logger.log(user["id"], "RESET_PASSWORD", "user", user_id)
        return {"success": True}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.delete("/api/users/{user_id}")
def delete_user(user_id: int, user=Depends(get_current_user)):
    try:
        _require_admin(user)
        username = auth_service.delete_user_and_employee(user_id, user["id"])
        audit_logger.log(user["id"], "DELETE_USER_AND_EMPLOYEE", "user", user_id, {"username": username})
        return {"success": True}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.post("/api/users/{user_id}/deactivate")
def deactivate_user(user_id: int, user=Depends(get_current_user)):
    try:
        _require_admin(user)
        username = auth_service.deactivate_user(user_id, user["id"])
        audit_logger.log(user["id"], "DEACTIVATE_USER", "user", user_id, {"username": username})
        return {"success": True}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.post("/api/users/{user_id}/activate")
def activate_user(user_id: int, user=Depends(get_current_user)):
    try:
        _require_admin(user)
        username = auth_service.activate_user(user_id)
        audit_logger.log(user["id"], "ACTIVATE_USER", "user", user_id, {"username": username})
        return {"success": True}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.post("/api/auth/change-password")
def change_my_password(request: PasswordChangeRequest, user=Depends(get_current_user)):
    try:
        auth_service.change_password(user["id"], request.current_password, request.new_password)
        audit_logger.log(user["id"], "CHANGE_PASSWORD", "user", user["id"])
        return {"success": True}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.post("/api/admin/invites", status_code=201)
def create_invite(request: InviteCreateRequest, http_request: Request, user=Depends(get_current_user)):
    _require_admin(user)
    token = auth_service.create_invite(request.email, request.requested_role, user["id"])
    # The API and the SPA are separate during development; deployment sets this
    # to the public PayFlow domain so an invite always opens the frontend route.
    public_url = os.getenv("PUBLIC_APP_URL") or os.getenv("FRONTEND_URL") or "http://127.0.0.1:5173"
    audit_logger.log(user["id"], "CREATE_INVITE", "user_invite", None, {"email": request.email, "requested_role": request.requested_role})
    return {"success": True, "data": {"invite_url": f"{public_url}/invite/{token}", "expires_in_days": 7}}


@app.get("/api/invites/{token}")
def get_invite(token: str):
    try:
        invite = auth_service.validate_invite(token)
        return {"success": True, "data": {"email": invite["email"], "requested_role": invite["requested_role"], "departments": departments_service.dump(), "positions": positions_service.dump(), "organizations": organizations_service.dump()}}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.post("/api/invites/{token}/submit", status_code=201)
def submit_access_request(token: str, request: AccessRequestSubmit):
    try:
        auth_service.submit_access_request(
            token, request.username, request.password,
            request.employee.model_dump(mode="json"),
            request.position_name, request.organization_name,
        )
        return {"success": True, "message": "ส่งคำขอเรียบร้อยแล้ว"}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except psycopg.errors.UniqueViolation:
        raise HTTPException(status_code=409, detail="ชื่อผู้ใช้นี้ถูกใช้แล้ว")


@app.get("/api/admin/access-requests")
def get_access_requests(user=Depends(get_current_user)):
    _require_admin(user)
    return {"success": True, "data": auth_service.list_access_requests()}


@app.get("/api/admin/access-requests/{request_id}/password")
def reveal_access_request_password(request_id: int, user=Depends(get_current_user)):
    _require_admin(user)
    try:
        password = auth_service.reveal_requested_password(request_id)
        audit_logger.log(user["id"], "REVEAL_REQUESTED_PASSWORD", "access_request", request_id)
        return {"success": True, "data": {"password": password}}
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))


@app.post("/api/admin/access-requests/{request_id}/approve")
def approve_access_request(request_id: int, request: AccessRequestApprove, user=Depends(get_current_user)):
    _require_admin(user)
    requests = {item["id"]: item for item in auth_service.list_access_requests()}
    item = requests.get(request_id)
    if item is None or item["status"] != "PENDING":
        raise HTTPException(status_code=404, detail="ไม่พบคำขอที่รออนุมัติ")
    try:
        # Re-validate stored form data before entering the transaction. The
        # service then creates employee + account + approval in one commit.
        EmployeeSave(**item["employee_data"])
        employee_id = auth_service.approve_access_request_with_employee(request_id, user["id"], request.actual_role)
        audit_logger.log(user["id"], "APPROVE_ACCESS_REQUEST", "access_request", request_id, {"employee_id": employee_id, "role": request.actual_role})
        return {"success": True}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except psycopg.errors.UniqueViolation:
        raise HTTPException(status_code=409, detail="เลขประจำตัวประชาชนหรือชื่อผู้ใช้นี้ถูกใช้งานแล้ว")


@app.post("/api/admin/access-requests/{request_id}/reject")
def reject_access_request(request_id: int, request: AccessRequestReject, user=Depends(get_current_user)):
    _require_admin(user)
    try:
        auth_service.reject_access_request(request_id, user["id"], request.reason)
        audit_logger.log(user["id"], "REJECT_ACCESS_REQUEST", "access_request", request_id, {"purged": True})
        return {"success": True}
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))


def _employee_database_error(error):
    if isinstance(error, psycopg.errors.UniqueViolation):
        raise HTTPException(
            status_code=409,
            detail="เลขประจำตัวประชาชนถูกใช้งานแล้ว"
        )
    if isinstance(error, ValueError):
        raise HTTPException(status_code=400, detail=str(error))
    raise HTTPException(
        status_code=500,
        detail={"message": "บันทึกข้อมูลพนักงานไม่สำเร็จ", "error": str(error)}
    )


@app.get("/api/employees/{employee_id}")
def get_employee(employee_id: int, user=Depends(get_current_user)):
    department_id = _department_scope(user)
    error, employee = employees_service.read(employee_id)
    if error["Is Error"]:
        raise HTTPException(status_code=404, detail=error["Error Message"])
    if department_id is not None and employee["department_id"] != department_id:
        raise HTTPException(status_code=403, detail="ไม่มีสิทธิ์เข้าถึงพนักงานฝ่ายอื่น")
    return {"success": True, "data": employee}


@app.post("/api/employees", status_code=201)
def create_employee(request: EmployeeSave, user=Depends(get_current_user)):
    try:
        _require_employee_creation_role(user)
        employee_id = employees_service.create(request)
        try:
            audit_logger.log(user["id"], "CREATE", "employee", employee_id, {"employee_code": request.employee_code})
        except Exception:
            logging.exception("Unable to record employee creation audit event")
        return {"success": True, "data": {"id": employee_id, "employee_code": request.employee_code}}
    except Exception as error:
        _employee_database_error(error)


@app.put("/api/employees/{employee_id}")
def update_employee(employee_id: int, request: EmployeeSave, user=Depends(get_current_user)):
    try:
        _require_payroll_role(user)
        scope = _department_scope(user)
        current_error, current_employee = employees_service.read(employee_id)
        if current_error["Is Error"]:
            raise HTTPException(status_code=404, detail="ไม่พบพนักงาน")
        if scope is not None and current_employee["department_id"] != scope:
            raise HTTPException(status_code=403, detail="ไม่มีสิทธิ์แก้ไขพนักงานฝ่ายอื่น")
        if not employees_service.update(employee_id, request):
            raise HTTPException(status_code=404, detail="ไม่พบพนักงาน")
        try:
            audit_logger.log(user["id"], "UPDATE", "employee", employee_id, {"employee_code": request.employee_code})
        except Exception:
            logging.exception("Unable to record employee update audit event")
        return {"success": True}
    except HTTPException:
        raise
    except Exception as error:
        _employee_database_error(error)


@app.patch("/api/employees/{employee_id}/status")
def update_employee_status(employee_id: int, request: EmployeeStatusUpdate, user=Depends(get_current_user)):
    department_id = _department_scope(user)
    error, employee = employees_service.read(employee_id)
    if error["Is Error"]:
        raise HTTPException(status_code=404, detail=error["Error Message"])
    if department_id is not None and employee["department_id"] != department_id:
        raise HTTPException(status_code=403, detail="ไม่มีสิทธิ์แก้ไขพนักงานฝ่ายอื่น")
    if not employees_service.update_status(employee_id, request.status):
        raise HTTPException(status_code=404, detail="ไม่พบพนักงาน")
    audit_logger.log(user["id"], "UPDATE_STATUS", "employee", employee_id, {"status": request.status})
    return {"success": True}


@app.patch("/api/employees/{employee_id}/email")
def update_employee_email(employee_id: int, request: EmployeeEmailUpdate, user=Depends(get_current_user)):
    department_id = _department_scope(user)
    error, employee = employees_service.read(employee_id)
    if error["Is Error"]:
        raise HTTPException(status_code=404, detail=error["Error Message"])
    if department_id is not None and employee["department_id"] != department_id:
        raise HTTPException(status_code=403, detail="ไม่มีสิทธิ์แก้ไขพนักงานฝ่ายอื่น")
    if not employees_service.update_email(employee_id, request.email):
        raise HTTPException(status_code=404, detail="ไม่พบพนักงาน")
    audit_logger.log(user["id"], "UPDATE_EMAIL", "employee", employee_id, {"email": request.email})
    return {"success": True, "data": {"email": request.email}}

@app.get("/api/positions")
def get_positions(user=Depends(get_current_user)):
    try:
        positions = positions_service.dump()

        return {
            "success": True,
            "count": len(positions),
            "data": positions
        }

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail={
                "message": "ไม่สามารถดึงข้อมูลตำแหน่งงานได้",
                "error": str(error)
            }
        )


class PositionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class OrganizationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)


@app.post("/api/positions", status_code=201)
def create_position(request: PositionCreate, user=Depends(get_current_user)):
    try:
        _require_employee_creation_role(user)
        position = positions_service.create(request.name)
        audit_logger.log(user["id"], "CREATE", "position", position["id"], {"name": request.name})
        return {"success": True, "data": position}
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail={
                "message": "ไม่สามารถเพิ่มตำแหน่งงานได้",
                "error": str(error)
            }
        )


@app.get("/api/organizations")
def get_organizations(user=Depends(get_current_user)):
    return {"success": True, "data": organizations_service.dump()}


@app.post("/api/organizations", status_code=201)
def create_organization(request: OrganizationCreate, user=Depends(get_current_user)):
    try:
        _require_employee_creation_role(user)
        organization = organizations_service.create(request.name)
        audit_logger.log(user["id"], "CREATE", "organization", organization["id"], {"name": organization["name"]})
        return {"success": True, "data": organization}
    except Exception as error:
        raise HTTPException(status_code=500, detail={"message": "ไม่สามารถเพิ่มหน่วยงานได้", "error": str(error)})

@app.get("/api/payroll_periods")
def get_payroll_periods(user=Depends(get_current_user)):
    try:
        payroll_periods = payroll_periods_service.dump(_department_scope(user))

        return {
            "success": True,
            "count": len(payroll_periods),
            "data": payroll_periods
        }

    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail={
                "message": "ไม่สามารถดึงข้อมูลรอบการจ่ายเงินได้",
                "error": str(error)
            }
        )


@app.get("/api/reports/annual-tax")
def get_annual_tax_report(year: int, department_id: int | None = None, report_type: str = "tax", user=Depends(get_current_user)):
    """Read annual tax or income data directly from approved payroll snapshots.

    The report is derived on demand so it cannot become out of sync with the
    saved payroll tables. HR is always restricted to their own department.
    """
    try:
        if year < 2000 or year > 3000:
            raise HTTPException(status_code=400, detail="ปีที่เลือกไม่ถูกต้อง")
        if report_type not in {"tax", "income"}:
            raise HTTPException(status_code=400, detail="ประเภทรายงานไม่ถูกต้อง")
        scoped_department_id = _department_scope(user)
        effective_department_id = scoped_department_id if scoped_department_id is not None else department_id
        amount_join = ""
        amount_expression = "item.total_earnings"
        if report_type == "tax":
            amount_join = """
                LEFT JOIN (
                    SELECT line.payroll_item_id, line.amount
                    FROM public.payroll_item_lines line
                    JOIN public.pay_item_types item_type ON item_type.id = line.pay_item_type_id
                    WHERE item_type.code = 'TAX'
                ) tax_line ON tax_line.payroll_item_id = item.id
            """
            amount_expression = "COALESCE(tax_line.amount, 0)"
        monthly_columns = ",\n                   ".join(
            f"COALESCE(SUM(CASE WHEN period.month = {month} THEN {amount_expression} ELSE 0 END), 0) AS month_{month}"
            for month in range(1, 13)
        )
        query = """
            SELECT employee.id AS employee_id,
                   COALESCE(employee.prefix, '') AS prefix,
                   employee.first_name,
                   employee.last_name,
                   department.name AS department_name,
                   COALESCE(position.name, '–') AS position_name,
                   {monthly_columns}
            FROM public.payroll_items item
            JOIN public.payroll_department_batches batch ON batch.id = item.department_batch_id
            JOIN public.payroll_periods period ON period.id = item.payroll_period_id
            JOIN public.employees employee ON employee.id = item.employee_id
            JOIN public.departments department ON department.id = item.department_id
            LEFT JOIN public.positions position ON position.id = employee.position_id
            {amount_join}
            WHERE period.year = %s
              AND batch.is_current = TRUE
              AND batch.status IN ('APPROVED', 'PAID')
              AND (%s::integer IS NULL OR item.department_id = %s)
            GROUP BY employee.id, employee.prefix, employee.first_name, employee.last_name,
                     department.name, position.name
            ORDER BY department.name, employee.first_name, employee.last_name, employee.id
        """.format(monthly_columns=monthly_columns, amount_join=amount_join)
        data, columns = db.fetch(query, (year, effective_department_id, effective_department_id))
        rows = []
        for value in data:
            record = dict(zip(columns, value))
            months = [float(record[f"month_{month}"] or 0) for month in range(1, 13)]
            rows.append({
                "employee_id": record["employee_id"],
                "full_name": f"{record['prefix']}{record['first_name']} {record['last_name']}",
                "department_name": record["department_name"],
                "position_name": record["position_name"],
                "months": months,
                "total": sum(months),
            })
        return {"success": True, "data": {"year": year, "department_id": effective_department_id, "report_type": report_type, "rows": rows}}
    except HTTPException:
        raise
    except Exception as error:
        logging.exception("Unable to load annual tax report")
        raise HTTPException(status_code=500, detail={"message": "ไม่สามารถโหลดรายงานภาษีประจำปีได้", "error": str(error)})


@app.post("/api/payroll_periods", status_code=201)
def create_payroll_period(request: PayrollPeriodCreate, user=Depends(get_current_user)):
    try:
        if user["role"] not in {"hr", "admin"}:
            raise HTTPException(status_code=403, detail="ไม่มีสิทธิ์สร้างรอบเงินเดือน")
        own_department_id = _department_scope(user)
        if user["role"] == "admin":
            if request.department_id is None:
                raise HTTPException(status_code=400, detail="กรุณาเลือกฝ่ายที่ต้องการจัดทำ")
            department_id = request.department_id
        else:
            if request.department_id is not None and request.department_id != own_department_id:
                raise HTTPException(status_code=403, detail="พนักงานฝ่ายธุรการสร้างรอบได้เฉพาะฝ่ายของตน")
            department_id = own_department_id
        result = payroll_workflow_service.create_or_get_department_batch(
            request.year, request.month, request.pay_date,
            request.note.strip() if request.note else None, user["id"], department_id
        )
        audit_logger.log(user["id"], "CREATE_OR_OPEN", "payroll_department_batch", result["batch_id"], {"year": request.year, "month": request.month, "department_id": department_id, "existing": result["existing"]})
        return {"success": True, "data": result}
    except psycopg.errors.UniqueViolation:
        raise HTTPException(status_code=409, detail="มีรอบเงินเดือนของเดือนและปีนี้แล้ว")
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except Exception as error:
        raise HTTPException(status_code=500, detail={"message": "สร้างรอบเงินเดือนไม่สำเร็จ", "error": str(error)})


@app.delete("/api/payroll_periods/{period_id}")
def delete_payroll_period(period_id: int, user=Depends(get_current_user)):
    """Remove draft payroll data within the caller's permitted scope."""
    try:
        if user["role"] not in {"hr", "director", "admin"}:
            raise HTTPException(status_code=403, detail="ไม่มีสิทธิ์ลบรอบเงินเดือน")
        with db.transaction() as cursor:
            cursor.execute("SELECT id FROM public.payroll_periods WHERE id = %s FOR UPDATE", (period_id,))
            if cursor.fetchone() is None:
                raise ValueError("ไม่พบรอบเงินเดือน")
            cursor.execute("SELECT id, status FROM public.payroll_department_batches WHERE payroll_period_id = %s FOR UPDATE", (period_id,))
            batches = cursor.fetchall()
            if user["role"] == "hr":
                department_id = _department_scope(user)
                cursor.execute(
                    "SELECT id, status FROM public.payroll_department_batches WHERE payroll_period_id = %s AND department_id = %s FOR UPDATE",
                    (period_id, department_id),
                )
                own_batch = cursor.fetchone()
                if own_batch is None:
                    raise HTTPException(status_code=403, detail="ไม่มีสิทธิ์ลบรอบเงินเดือนของฝ่ายนี้")
                if own_batch[1] != "DRAFT":
                    raise ValueError("ลบได้เฉพาะรอบของฝ่ายที่ยังเป็นแบบร่างเท่านั้น")
                batch_ids = [own_batch[0]]
            else:
                if any(status != "DRAFT" for _, status in batches):
                    raise ValueError("ลบได้เฉพาะรอบที่ทุกฝ่ายยังเป็นแบบร่างเท่านั้น")
                batch_ids = [batch_id for batch_id, _ in batches]
            if batch_ids:
                cursor.execute("SELECT id FROM public.payroll_items WHERE department_batch_id = ANY(%s)", (batch_ids,))
                item_ids = [row[0] for row in cursor.fetchall()]
                if item_ids:
                    cursor.execute("DELETE FROM public.payslip_email_deliveries WHERE payroll_item_id = ANY(%s)", (item_ids,))
                    cursor.execute("DELETE FROM public.payroll_item_lines WHERE payroll_item_id = ANY(%s)", (item_ids,))
                cursor.execute("DELETE FROM public.payroll_items WHERE department_batch_id = ANY(%s)", (batch_ids,))
                cursor.execute("DELETE FROM public.payroll_batch_employee_exclusions WHERE department_batch_id = ANY(%s)", (batch_ids,))
                cursor.execute("DELETE FROM public.payroll_department_batches WHERE id = ANY(%s)", (batch_ids,))
            cursor.execute("SELECT COUNT(*) FROM public.payroll_department_batches WHERE payroll_period_id = %s", (period_id,))
            if cursor.fetchone()[0] == 0:
                cursor.execute("DELETE FROM public.payroll_periods WHERE id = %s", (period_id,))
        audit_logger.log(user["id"], "DELETE_PAYROLL_PERIOD", "payroll_period", period_id, {})
        return {"success": True}
    except HTTPException:
        raise
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except Exception as error:
        raise HTTPException(status_code=500, detail={"message": "ไม่สามารถลบรอบเงินเดือนได้", "error": str(error)})


@app.post("/api/payroll_department_batches/{batch_id}/revisions", status_code=201)
def create_payroll_revision(batch_id: int, request: PayrollRevisionCreate, user=Depends(get_current_user)):
    batch = _ensure_batch_access(batch_id, user)
    try:
        revision_id = payroll_workflow_service.create_revision(batch_id, request.revision_type, request.reason, user["id"])
        audit_logger.log(user["id"], "CREATE_PAYROLL_REVISION", "payroll_department_batch", revision_id, {"source_batch_id": batch_id, "department_id": batch["department_id"], "reason": request.reason})
        return {"success": True, "data": {"batch_id": revision_id}}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except Exception:
        # Return a normal API response so CORS middleware can add its headers;
        # the browser should never mask a server-side revision error as CORS.
        raise HTTPException(status_code=500, detail="สร้างฉบับแก้ไขไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")


@app.get("/api/payroll_department_batches/{batch_id}/history")
def get_payroll_batch_history(batch_id: int, user=Depends(get_current_user)):
    # HR users may inspect previous versions of their own department. Global
    # roles keep access to every department through the normal scope helper.
    _ensure_batch_access(batch_id, user)
    try:
        return {"success": True, "data": payroll_periods_service.batch_history(batch_id)}
    except Exception:
        raise HTTPException(status_code=500, detail="ไม่สามารถโหลดประวัติฉบับเงินเดือนได้")


@app.put("/api/payroll_department_batches/{batch_id}/items")
def save_payroll_batch_items(batch_id: int, request: PayrollBatchSave, user=Depends(get_current_user)):
    try:
        batch = _ensure_batch_access(batch_id, user)
        edit_version = payroll_workflow_service.save_batch_items(
            batch_id,
            batch["department_id"],
            [row.model_dump() for row in request.rows],
            [note.model_dump() for note in request.change_notes],
            user["id"],
            request.expected_version,
        )
        audit_logger.log(user["id"], "SAVE_ITEMS", "payroll_batch", batch_id, {
            "row_count": len(request.rows),
            "change_note_count": len(request.change_notes),
        })
        return {"success": True, "data": {"edit_version": edit_version}}
    except HTTPException:
        raise
    except StalePayrollVersionError as error:
        raise HTTPException(status_code=409, detail=str(error))
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail={"message": "บันทึกตารางเงินเดือนไม่สำเร็จ", "error": str(error)},
        )


@app.get("/api/payroll_department_batches/{batch_id}/change-notes")
def get_payroll_change_notes(batch_id: int, user=Depends(get_current_user)):
    batch = _ensure_batch_access(batch_id, user)
    note_query = (
        """SELECT note.id, note.employee_id, note.field_code, note.old_value, note.new_value,
                  note.reason, note.changed_at,
                  COALESCE(note.employee_name,
                      CONCAT(COALESCE(employee.prefix, ''), employee.first_name, ' ', employee.last_name)
                  ) AS employee_name,
                  COALESCE(note.editor_name, editor.full_name, editor.username) AS changed_by_name
           FROM public.payroll_change_notes note
           LEFT JOIN public.employees employee ON employee.id = note.employee_id
           LEFT JOIN public.users editor ON editor.id = note.changed_by_id
           WHERE note.department_batch_id = %s
           ORDER BY note.changed_at DESC, note.id DESC""",
        (batch["id"],),
    )
    previous_query = (
        """WITH current_batch AS (
               SELECT batch.department_id, period.year, period.month
               FROM public.payroll_department_batches batch
               JOIN public.payroll_periods period ON period.id = batch.payroll_period_id
               WHERE batch.id = %s
           ), previous_batch AS (
               SELECT batch.id
               FROM public.payroll_department_batches batch
               JOIN public.payroll_periods period ON period.id = batch.payroll_period_id
               CROSS JOIN current_batch current
               WHERE batch.department_id = current.department_id
                 AND batch.is_current = TRUE
                 AND (period.year, period.month) < (current.year, current.month)
               ORDER BY period.year DESC, period.month DESC, batch.id DESC
               LIMIT 1
           )
           SELECT item.employee_id, item_type.code AS field_code, line.amount
           FROM previous_batch previous
           JOIN public.payroll_items item ON item.department_batch_id = previous.id
           JOIN public.payroll_item_lines line ON line.payroll_item_id = item.id
           JOIN public.pay_item_types item_type ON item_type.id = line.pay_item_type_id
           ORDER BY item.employee_id, item_type.code""",
        (batch["id"],),
    )
    (note_data, note_columns), (previous_data, previous_columns) = db.fetch_many(
        [note_query, previous_query]
    )
    return {
        "success": True,
        "data": {
            "notes": [dict(zip(note_columns, row)) for row in note_data],
            "previous_values": [dict(zip(previous_columns, row)) for row in previous_data],
            "current_version": payroll_workflow_service.current_batch_version(batch["id"]),
        },
    }


@app.get("/api/payroll_department_batches/{batch_id}/version")
def get_payroll_batch_version(batch_id: int, user=Depends(get_current_user)):
    batch = _ensure_batch_access(batch_id, user)
    return {"success": True, "data": {"edit_version": payroll_workflow_service.current_batch_version(batch["id"])}}


@app.post("/api/payroll_department_batches/{batch_id}/action")
def change_payroll_batch_status(batch_id: int, request: PayrollBatchAction, user=Depends(get_current_user)):
    try:
        batch = _ensure_batch_access(batch_id, user, allow_approval=request.action in {"approve", "reject"})
        if request.action in {"approve", "reject"} and batch.get("submitted_by_id") == user["id"]:
            raise HTTPException(status_code=403, detail="ไม่สามารถอนุมัติหรือส่งกลับแก้ไขรายการที่ตนเองส่งอนุมัติได้")
        payroll_workflow_service.change_batch_status(
            batch_id, request.action, user["id"], request.reject_reason.strip() if request.reject_reason else None,
            request.expected_version,
        )
        audit_logger.log(user["id"], request.action.upper(), "payroll_batch", batch_id)
        return {"success": True, "data": {"department_id": batch["department_id"]}}
    except HTTPException:
        raise
    except StalePayrollVersionError as error:
        raise HTTPException(status_code=409, detail=str(error))
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except Exception as error:
        raise HTTPException(status_code=500, detail={"message": "เปลี่ยนสถานะรายการไม่สำเร็จ", "error": str(error)})


@app.post("/api/payslip-email-deliveries/{payroll_item_id}/send")
def send_payslip_email(payroll_item_id: int, user=Depends(get_current_user)):
    try:
        _ensure_payroll_item_access(payroll_item_id, user)
        recipient = payslip_email_service.send_payslip(payroll_item_id)
        audit_logger.log(user["id"], "SEND_EMAIL", "payroll_item", payroll_item_id, {"recipient": recipient})
        return {"success": True, "data": {"recipient": recipient}}
    except HTTPException:
        raise
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except Exception as error:
        raise HTTPException(status_code=500, detail={"message": "ส่งอีเมลไม่สำเร็จ", "error": str(error)})


@app.get("/api/payslip-email-deliveries/{payroll_item_id}/pdf")
def view_payslip_pdf(payroll_item_id: int, user=Depends(get_current_user)):
    try:
        if user["role"] not in {"hr", "director", "admin"}:
            raise HTTPException(status_code=403, detail="ไม่มีสิทธิ์ดูสลิปเงินเดือน")
        _ensure_payroll_item_access(payroll_item_id, user)
        from fastapi.responses import Response
        pdf_data, filename = payslip_email_service.build_payslip_pdf(payroll_item_id, lock_for_email=False)
        return Response(
            content=pdf_data,
            media_type="application/pdf",
            headers={"Content-Disposition": f'inline; filename="{filename}"'}
        )
    except HTTPException:
        raise
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except Exception as error:
        raise HTTPException(status_code=500, detail={"message": "สร้างไฟล์สลิปไม่สำเร็จ", "error": str(error)})

@app.get("/api/payroll_items")
def get_payroll_items(user=Depends(get_current_user)):
    try:
        _require_global_payroll_role(user)
        payroll_items = payroll_items_service.dump()

        return {
            "success": True,
            "count": len(payroll_items),
            "data": payroll_items
        }

    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail={
                "message": "ไม่สามารถดึงข้อมูลรอบการจ่ายเงินได้",
                "error": str(error)
            }
        )

@app.get("/api/payroll_department_batches")
def get_payroll_department_batches(user=Depends(get_current_user)):
    try:
        _require_global_payroll_role(user)
        batches = payroll_department_batches_service.dump()

        return {
            "success": True,
            "count": len(batches),
            "data": batches
        }

    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail={
                "message": "ไม่สามารถดึงข้อมูลการอนุมัติได้",
                "error": str(error)
            }
        )

@app.get("/api/pay_item_types")
def get_pay_item_types(user=Depends(get_current_user)):
    try:
        pay_item_types = pay_item_types_service.dump()

        return {
            "success": True,
            "count": len(pay_item_types),
            "data": pay_item_types
        }

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail={
                "message": "ไม่สามารถดึงข้อมูลรอบการจ่ายเงินได้",
                "error": str(error)
            }
        )


@app.post("/api/pay_item_types", status_code=201)
def create_pay_item_type(request: PayItemTypeCreate, user=Depends(get_current_user)):
    try:
        _require_payroll_role(user)
        if user["role"] == "director":
            raise HTTPException(status_code=403, detail="ผู้บริหารไม่สามารถเพิ่มประเภทรายการเงินเดือนได้")
        item_type = pay_item_types_service.create(request.name, request.category)
        audit_logger.log(user["id"], "CREATE_PAY_ITEM_TYPE", "pay_item_type", item_type["id"], {"name": item_type["name"], "category": item_type["category"]})
        return {"success": True, "data": item_type}
    except HTTPException:
        raise
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except Exception as error:
        raise HTTPException(status_code=500, detail={"message": "ไม่สามารถเพิ่มประเภทรายการเงินเดือนได้", "error": str(error)})
