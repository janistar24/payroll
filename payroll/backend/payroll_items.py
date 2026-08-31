from DBHelper import DBHelper


class PayrollItems:

    def __init__(self):
        self.db = DBHelper()

    def dump(self):
        data, columns = self.db.fetch(
            """
            SELECT
                id,
                payroll_period_id,
                employee_id,
                base_salary,
                total_earnings,
                total_deductions,
                net_pay,
                created_at,
                department_id,
                department_batch_id
            FROM public.payroll_items
            ORDER BY id
            """
        )
        return [dict(zip(columns, row)) for row in data]
