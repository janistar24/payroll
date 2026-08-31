from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from DBHelper import DBHelper
from departments import Departments
from employees import Employees
from positions import Positions
from payroll_periods import Payroll_periods
from payroll_items import PayrollItems
from payroll_department_batches import PayrollDepartmentBatches
from pay_item_types import PayItemTypes

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
def get_employees():
    try:
        employees = employees_service.dump()

        return {
            "success": True,
            "count": len(employees),
            "data": employees
        }

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail={
                "message": "ไม่สามารถดึงข้อมูลพนักงานได้",
                "error": str(error)
            }
        )

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

@app.get("/api/payroll_periods")
def get_payroll_periods():
    try:
        payroll_periods = payroll_periods_service.dump()

        return {
            "success": True,
            "count": len(payroll_periods),
            "data": payroll_periods
        }

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail={
                "message": "ไม่สามารถดึงข้อมูลรอบการจ่ายเงินได้",
                "error": str(error)
            }
        )

@app.get("/api/payroll_items")
def get_payroll_items():
    try:
        payroll_items = payroll_items_service.dump()

        return {
            "success": True,
            "count": len(payroll_items),
            "data": payroll_items
        }

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail={
                "message": "ไม่สามารถดึงข้อมูลรอบการจ่ายเงินได้",
                "error": str(error)
            }
        )

@app.get("/api/payroll_department_batches")
def get_payroll_department_batches():
    try:
        batches = payroll_department_batches_service.dump()

        return {
            "success": True,
            "count": len(batches),
            "data": batches
        }

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
