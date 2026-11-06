"""Create or remove the isolated September 2026 print-report demo dataset."""

import argparse
from datetime import date
from decimal import Decimal

from DBHelper import DBHelper


DEMO_NOTE = "PAYFLOW_PRINT_DEMO_V1"
DEMO_YEAR = 2026
DEMO_MONTH = 9
DEMO_EMPLOYEE_PREFIX = "DEMO_PRINT_"
PROTECTED_USERNAMES = ("admin", "janistaadmin", "1609700088033")

EMPLOYEES = (
    ("001", "นาย", "สมชาย", "ใจดี", 3, 2, Decimal("24000"), Decimal("1500"), Decimal("2000"), Decimal("750"), Decimal("900")),
    ("002", "นางสาว", "พิมพ์ชนก", "มั่นคง", 3, 6, Decimal("22000"), Decimal("1000"), Decimal("0"), Decimal("650"), Decimal("750")),
    ("003", "นาย", "ธนกฤต", "ก้าวหน้า", 4, 6, Decimal("26500"), Decimal("1200"), Decimal("2500"), Decimal("800"), Decimal("900")),
    ("004", "นาง", "สุภาวดี", "แสงทอง", 4, 2, Decimal("28500"), Decimal("1800"), Decimal("3000"), Decimal("950"), Decimal("900")),
    ("005", "นาย", "วิชาญ", "พร้อมงาน", 2, 6, Decimal("23500"), Decimal("1100"), Decimal("0"), Decimal("700"), Decimal("850")),
    ("006", "นางสาว", "กมลวรรณ", "สุขใจ", 2, 2, Decimal("27000"), Decimal("1600"), Decimal("2500"), Decimal("900"), Decimal("900")),
)


def assert_protected_users(cursor):
    cursor.execute(
        "SELECT username FROM public.users WHERE username = ANY(%s) ORDER BY username",
        (list(PROTECTED_USERNAMES),),
    )
    found = {row[0] for row in cursor.fetchall()}
    missing = set(PROTECTED_USERNAMES) - found
    if missing:
        raise RuntimeError(f"ไม่พบบัญชีที่ต้องป้องกัน: {', '.join(sorted(missing))}")


def create_demo():
    db = DBHelper()
    with db.transaction() as cursor:
        assert_protected_users(cursor)
        cursor.execute(
            "SELECT id, note FROM public.payroll_periods WHERE year = %s AND month = %s FOR UPDATE",
            (DEMO_YEAR, DEMO_MONTH),
        )
        existing = cursor.fetchone()
        if existing:
            if existing[1] == DEMO_NOTE:
                print(f"ชุดข้อมูลทดสอบมีอยู่แล้ว (payroll_period_id={existing[0]})")
                return
            raise RuntimeError("เดือนกันยายน 2569 มีรอบเงินจริงอยู่แล้ว จึงไม่สร้างข้อมูลทดสอบทับ")

        cursor.execute("SELECT id FROM public.users WHERE username = 'admin'")
        admin_id = cursor.fetchone()[0]
        cursor.execute(
            """INSERT INTO public.payroll_periods
               (year, month, pay_date, note, status, created_by_id, approved_by_id, approved_at)
               VALUES (%s, %s, %s, %s, 'APPROVED', %s, %s, NOW()) RETURNING id""",
            (DEMO_YEAR, DEMO_MONTH, date(2026, 9, 30), DEMO_NOTE, admin_id, admin_id),
        )
        period_id = cursor.fetchone()[0]

        cursor.execute("SELECT id, code FROM public.pay_item_types WHERE code = ANY(%s)", (["EXTRA_PAY", "POS_ALLOW", "TAX", "SSF"],))
        pay_types = {code: item_id for item_id, code in cursor.fetchall()}
        if set(pay_types) != {"EXTRA_PAY", "POS_ALLOW", "TAX", "SSF"}:
            raise RuntimeError("ประเภทรายการรับ/หักมาตรฐานไม่ครบ")

        batches = {}
        for department_id in sorted({employee[4] for employee in EMPLOYEES}):
            cursor.execute(
                """INSERT INTO public.payroll_department_batches
                   (payroll_period_id, department_id, status, submitted_by_id, submitted_at,
                    approved_by_id, approved_at, is_current, visible_pay_item_codes)
                   VALUES (%s, %s, 'APPROVED', %s, NOW(), %s, NOW(), TRUE, %s::jsonb)
                   RETURNING id""",
                (period_id, department_id, admin_id, admin_id, '["EXTRA_PAY","POS_ALLOW","TAX","SSF"]'),
            )
            batches[department_id] = cursor.fetchone()[0]

        for index, employee in enumerate(EMPLOYEES, start=1):
            suffix, prefix, first_name, last_name, department_id, position_id, salary, extra, allowance, tax, ssf = employee
            employee_code = f"{DEMO_EMPLOYEE_PREFIX}{suffix}"
            national_id = f"999990000{index:04d}"
            cursor.execute(
                """INSERT INTO public.employees
                   (employee_code, national_id, prefix, first_name, last_name, department_id,
                    position_id, employee_type, status, start_date, email, base_salary, organization_id)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, 'MUNICIPAL_EMPLOYEE', 'ACTIVE',
                           %s, %s, %s, 1)
                   RETURNING id""",
                (employee_code, national_id, prefix, first_name, last_name, department_id,
                 position_id, date(2024, 1, 1), f"demo.print.{index}@example.invalid", salary),
            )
            employee_id = cursor.fetchone()[0]
            total_earnings = salary + extra + allowance
            total_deductions = tax + ssf
            cursor.execute(
                """INSERT INTO public.payroll_items
                   (payroll_period_id, department_batch_id, department_id, employee_id,
                    base_salary, full_month_salary, total_earnings, total_deductions, net_pay)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
                (period_id, batches[department_id], department_id, employee_id, salary, salary,
                 total_earnings, total_deductions, total_earnings - total_deductions),
            )
            payroll_item_id = cursor.fetchone()[0]
            for code, amount in (("EXTRA_PAY", extra), ("POS_ALLOW", allowance), ("TAX", tax), ("SSF", ssf)):
                if amount:
                    cursor.execute(
                        "INSERT INTO public.payroll_item_lines (payroll_item_id, pay_item_type_id, amount) VALUES (%s, %s, %s)",
                        (payroll_item_id, pay_types[code], amount),
                    )
        print(f"สร้างชุดข้อมูลทดสอบแล้ว: payroll_period_id={period_id}, พนักงานทดสอบ={len(EMPLOYEES)} คน")


def delete_demo():
    db = DBHelper()
    with db.transaction() as cursor:
        assert_protected_users(cursor)
        cursor.execute("DELETE FROM public.payroll_periods WHERE year=%s AND month=%s AND note=%s RETURNING id", (DEMO_YEAR, DEMO_MONTH, DEMO_NOTE))
        deleted_periods = len(cursor.fetchall())
        cursor.execute("DELETE FROM public.employees WHERE employee_code LIKE %s RETURNING id", (f"{DEMO_EMPLOYEE_PREFIX}%",))
        deleted_employees = len(cursor.fetchall())
        print(f"ลบชุดข้อมูลทดสอบแล้ว: รอบ={deleted_periods}, พนักงาน={deleted_employees}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("create", "delete"))
    args = parser.parse_args()
    create_demo() if args.action == "create" else delete_demo()
