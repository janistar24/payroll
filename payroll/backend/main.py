from datetime import date
from decimal import Decimal

import psycopg
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
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
from auth import auth_service, get_current_user

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

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

@app.middleware("http")
async def add_utf8_charset(request, call_next):
    response = await call_next(request)

    if response.headers.get("content-type", "").startswith("application/json"):
        response.headers["content-type"] = "application/json; charset=utf-8"

    return response

@app.get("/")
def home():
    return {
        "message": "Payroll Backend Running"
    }

@app.get("/api/database-test")
def database_test():
    try:
        data, columns = db.fetch(
            """
            SELECT
                current_database() AS database_name,
                current_user AS database_user,
                NOW() AS server_time
            """
        )

        result = dict(zip(columns, data[0]))

        return {
            "success": True,
            "message": "เชื่อมต่อ PostgreSQL สำเร็จ",
            "data": result
        }

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail={
                "message": "เชื่อมต่อ PostgreSQL ไม่สำเร็จ",
                "error": str(error)
            }
        )

@app.get("/api/departments")
def get_departments():
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
    if user["role"] not in {"director", "admin"}:
        raise HTTPException(status_code=403, detail="เฉพาะ Director และ Admin เท่านั้นที่เพิ่มพนักงานได้")


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


@app.post("/api/auth/login")
def login(request: LoginRequest):
    user = auth_service.authenticate(request.username.strip(), request.password)
    if user is None:
        raise HTTPException(status_code=401, detail="ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง")
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
        return {"success": True, "data": {"id": employee_id}}
    except Exception as error:
        _employee_database_error(error)


@app.put("/api/employees/{employee_id}")
def update_employee(employee_id: int, request: EmployeeSave, user=Depends(get_current_user)):
    try:
        _require_payroll_role(user)
        if not employees_service.update(employee_id, request):
            raise HTTPException(status_code=404, detail="ไม่พบพนักงาน")
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
    return {"success": True}

@app.get("/api/positions")
def get_positions():
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
def create_position(request: PositionCreate):
    try:
        position = positions_service.create(request.name)
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
        return {"success": True, "data": {"department_id": batch["department_id"]}}
    except HTTPException:
        raise
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except Exception as error:
        raise HTTPException(status_code=500, detail={"message": "เปลี่ยนสถานะรายการไม่สำเร็จ", "error": str(error)})

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
def get_pay_item_types():
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
