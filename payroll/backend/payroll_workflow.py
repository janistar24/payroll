from decimal import Decimal

from DBHelper import DBHelper


class PayrollWorkflow:
    def __init__(self):
        self.db = DBHelper()

    def create_period(self, year, month, pay_date, note, created_by_id):
        with self.db.transaction() as cursor:
            cursor.execute(
                """
                INSERT INTO public.payroll_periods (year, month, pay_date, note, status, created_by_id, created_at, updated_at)
                VALUES (%s, %s, %s, %s, 'DRAFT', %s, NOW(), NOW())
                RETURNING id
                """,
                (year, month, pay_date, note, created_by_id),
            )
            period_id = cursor.fetchone()[0]
            cursor.execute(
                """
                INSERT INTO public.payroll_department_batches (payroll_period_id, department_id, status, created_at)
                SELECT %s, id, 'DRAFT', NOW()
                FROM public.departments
                WHERE is_active = TRUE
                """,
                (period_id,),
            )
            return period_id

    def save_batch_items(self, batch_id, department_id, rows):
        with self.db.transaction() as cursor:
            cursor.execute(
                """
                SELECT batch.id
                FROM public.payroll_department_batches batch
                WHERE batch.id = %s AND batch.department_id = %s
                FOR UPDATE
                """,
                (batch_id, department_id),
            )
            if cursor.fetchone() is None:
                raise ValueError("ไม่พบรายการฝ่ายของรอบเงินเดือน")

            employee_ids = [row["employee_id"] for row in rows]
            if employee_ids:
                cursor.execute(
                    """
                    SELECT id, base_salary
                    FROM public.employees
                    WHERE department_id = %s AND status = 'ACTIVE' AND id = ANY(%s)
                    """,
                    (department_id, employee_ids),
                )
                salaries = dict(cursor.fetchall())
                if len(salaries) != len(set(employee_ids)):
                    raise ValueError("พบพนักงานที่ไม่อยู่ในฝ่ายหรือไม่ได้ใช้งาน")
            else:
                salaries = {}

            cursor.execute("SELECT id FROM public.payroll_items WHERE department_batch_id = %s", (batch_id,))
            previous_item_ids = [record[0] for record in cursor.fetchall()]
            if previous_item_ids:
                cursor.execute("DELETE FROM public.payroll_item_lines WHERE payroll_item_id = ANY(%s)", (previous_item_ids,))
            cursor.execute("DELETE FROM public.payroll_items WHERE department_batch_id = %s", (batch_id,))

            for row in rows:
                base_salary = Decimal(str(salaries[row["employee_id"]]))
                line_values = row.get("lines", {})
                earnings = sum(Decimal(str(value)) for code, value in line_values.items() if code in {"EXTRA_PAY", "POS_ALLOW"})
                deductions = sum(Decimal(str(value)) for code, value in line_values.items() if code in {"KTB_LOAN", "TAX", "SSF", "FUNERAL_FUND", "SAVINGS_BANK_LOAN"})
                total_earnings = base_salary + earnings
                net_pay = total_earnings - deductions
                cursor.execute(
                    """
                    INSERT INTO public.payroll_items (
                        payroll_period_id, department_batch_id, department_id, employee_id,
                        base_salary, total_earnings, total_deductions, net_pay, created_at
                    )
                    SELECT payroll_period_id, id, department_id, %s, %s, %s, %s, %s, NOW()
                    FROM public.payroll_department_batches WHERE id = %s
                    RETURNING id
                    """,
                    (row["employee_id"], base_salary, total_earnings, deductions, net_pay, batch_id),
                )
                item_id = cursor.fetchone()[0]
                for code, amount in line_values.items():
                    amount = Decimal(str(amount))
                    if amount == 0:
                        continue
                    cursor.execute(
                        """
                        INSERT INTO public.payroll_item_lines (payroll_item_id, pay_item_type_id, amount)
                        SELECT %s, id, %s FROM public.pay_item_types WHERE code = %s
                        """,
                        (item_id, amount, code),
                    )
                    if cursor.rowcount != 1:
                        raise ValueError(f"ไม่พบประเภทรายการ {code}")

            cursor.execute("UPDATE public.payroll_periods SET updated_at = NOW() WHERE id = (SELECT payroll_period_id FROM public.payroll_department_batches WHERE id = %s)", (batch_id,))

    def change_batch_status(self, batch_id, action, user_id, reject_reason=None):
        with self.db.transaction() as cursor:
            cursor.execute("SELECT status FROM public.payroll_department_batches WHERE id = %s FOR UPDATE", (batch_id,))
            record = cursor.fetchone()
            if record is None:
                raise ValueError("ไม่พบรายการฝ่ายของรอบเงินเดือน")
            current_status = record[0]
            if action == "submit":
                if current_status not in {"DRAFT", "REJECTED"}:
                    raise ValueError("รายการนี้ไม่สามารถส่งอนุมัติได้")
                cursor.execute("UPDATE public.payroll_department_batches SET status = 'SUBMITTED', submitted_by_id = %s, submitted_at = NOW(), reject_reason = NULL WHERE id = %s", (user_id, batch_id))
            elif action == "approve":
                if current_status != "SUBMITTED":
                    raise ValueError("อนุมัติได้เฉพาะรายการที่รออนุมัติ")
                cursor.execute("UPDATE public.payroll_department_batches SET status = 'APPROVED', approved_by_id = %s, approved_at = NOW() WHERE id = %s", (user_id, batch_id))
                cursor.execute(
                    """
                    INSERT INTO public.payslip_email_deliveries (payroll_item_id, status, created_at, updated_at)
                    SELECT item.id, CASE WHEN employee.email IS NULL OR BTRIM(employee.email) = '' THEN 'FAILED' ELSE 'PENDING' END, NOW(), NOW()
                    FROM public.payroll_items item
                    JOIN public.employees employee ON employee.id = item.employee_id
                    WHERE item.department_batch_id = %s
                    ON CONFLICT (payroll_item_id) DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()
                    """,
                    (batch_id,),
                )
            elif action == "reject":
                if current_status != "SUBMITTED":
                    raise ValueError("ส่งกลับแก้ไขได้เฉพาะรายการที่รออนุมัติ")
                cursor.execute("UPDATE public.payroll_department_batches SET status = 'REJECTED', reject_reason = %s WHERE id = %s", (reject_reason, batch_id))
            else:
                raise ValueError("คำสั่งเปลี่ยนสถานะไม่ถูกต้อง")

            cursor.execute("UPDATE public.payroll_periods SET updated_at = NOW() WHERE id = (SELECT payroll_period_id FROM public.payroll_department_batches WHERE id = %s)", (batch_id,))
