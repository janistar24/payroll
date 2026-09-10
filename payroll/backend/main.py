import os
import time
import uuid
import logging
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
from payroll_periods import Payroll_periods
from payroll_items import PayrollItems
from payroll_department_batches import PayrollDepartmentBatches
from pay_item_types import PayItemTypes
from payroll_workflow import PayrollWorkflow
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


@app.exception_handler(HTTPException)
async def secure_http_errors(request: Request, error: HTTPException):
    detail = error.detail
    if environment == "production" and error.status_code >= 500:
        logging.exception("Request %s failed: %s", request.url.path, detail)
        detail = {"message": "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง"}
    return JSONResponse(status_code=error.status_code, content={"detail": detail})

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
    employee_code: str = Field(min_length=1, max_length=30)
    national_id: str = Field(min_length=13, max_length=13)
    prefix: str | None = Field(default=None, max_length=20)
    first_name: str = Field(min_length=1, max_length=150)
    last_name: str = Field(min_length=1, max_length=150)
    department_id: int | None = None
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


class PayrollPeriodCreate(BaseModel):
    month: int = Field(ge=1, le=12)
    year: int = Field(ge=2000, le=3000)
    pay_date: date
    note: str | None = Field(default=None, max_length=500)


class PayrollRowSave(BaseModel):
    employee_id: int
    lines: dict[str, Decimal] = Field(default_factory=dict)

    @field_validator("lines")
    @classmethod
    def validate_lines(cls, value):
        allowed = {"EXTRA_PAY", "POS_ALLOW", "KTB_LOAN", "TAX", "SSF", "FUNERAL_FUND", "SAVINGS_BANK_LOAN"}
        if not set(value).issubset(allowed):
            raise ValueError("พบประเภทรายการเงินเดือนที่ไม่รองรับ")
        if any(amount < 0 for amount in value.values()):
            raise ValueError("จำนวนเงินต้องไม่ติดลบ")
        return value


class PayrollBatchSave(BaseModel):
    rows: list[PayrollRowSave]


class PayrollBatchAction(BaseModel):
    action: str
    reject_reason: str | None = Field(default=None, max_length=500)

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
            raise HTTPException(status_code=403, detail="บัญชี HR ยังไม่ได้ผูกกับฝ่าย")
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
        "SELECT id, department_id FROM public.payroll_department_batches WHERE id = %s",
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


@app.post("/api/auth/change-password")
def change_my_password(request: PasswordChangeRequest, user=Depends(get_current_user)):
    try:
        auth_service.change_password(user["id"], request.current_password, request.new_password)
        audit_logger.log(user["id"], "CHANGE_PASSWORD", "user", user["id"])
        return {"success": True}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))


def _employee_database_error(error):
    if isinstance(error, psycopg.errors.UniqueViolation):
        raise HTTPException(
            status_code=409,
            detail="รหัสพนักงานหรือเลขประจำตัวประชาชนถูกใช้งานแล้ว"
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
        audit_logger.log(user["id"], "CREATE", "employee", employee_id, {"employee_code": request.employee_code})
        return {"success": True, "data": {"id": employee_id}}
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
        audit_logger.log(user["id"], "UPDATE", "employee", employee_id, {"employee_code": request.employee_code})
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


@app.post("/api/payroll_periods", status_code=201)
def create_payroll_period(request: PayrollPeriodCreate, user=Depends(get_current_user)):
    try:
        _require_payroll_role(user)
        period_id = payroll_workflow_service.create_period(
            request.year, request.month, request.pay_date,
            request.note.strip() if request.note else None, user["id"]
        )
        audit_logger.log(user["id"], "CREATE", "payroll_period", period_id, {"year": request.year, "month": request.month})
        return {"success": True, "data": {"id": period_id}}
    except psycopg.errors.UniqueViolation:
        raise HTTPException(status_code=409, detail="มีรอบเงินเดือนของเดือนและปีนี้แล้ว")
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except Exception as error:
        raise HTTPException(status_code=500, detail={"message": "สร้างรอบเงินเดือนไม่สำเร็จ", "error": str(error)})


@app.put("/api/payroll_department_batches/{batch_id}/items")
def save_payroll_batch_items(batch_id: int, request: PayrollBatchSave, user=Depends(get_current_user)):
    try:
        batch = _ensure_batch_access(batch_id, user)
        payroll_workflow_service.save_batch_items(
            batch_id, batch["department_id"], [row.model_dump() for row in request.rows]
        )
        audit_logger.log(user["id"], "SAVE_ITEMS", "payroll_batch", batch_id, {"row_count": len(request.rows)})
        return {"success": True}
    except HTTPException:
        raise
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except Exception as error:
        raise HTTPException(status_code=500, detail={"message": "บันทึกตารางเงินเดือนไม่สำเร็จ", "error": str(error)})


@app.post("/api/payroll_department_batches/{batch_id}/action")
def change_payroll_batch_status(batch_id: int, request: PayrollBatchAction, user=Depends(get_current_user)):
    try:
        batch = _ensure_batch_access(batch_id, user, allow_approval=request.action in {"approve", "reject"})
        payroll_workflow_service.change_batch_status(
            batch_id, request.action, user["id"], request.reject_reason.strip() if request.reject_reason else None
        )
        audit_logger.log(user["id"], request.action.upper(), "payroll_batch", batch_id)
        return {"success": True, "data": {"department_id": batch["department_id"]}}
    except HTTPException:
        raise
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
