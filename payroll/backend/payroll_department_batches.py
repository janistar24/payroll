from DBHelper import DBHelper


class PayrollDepartmentBatches:

    def __init__(self):
        self.db = DBHelper()

    def dump(self):
        data, columns = self.db.fetch(
            """
            SELECT
                id,
                payroll_period_id,
                department_id,
                status,
                submitted_by_id,
                submitted_at,
                approved_by_id,
                approved_at,
                reject_reason,
                created_at
            FROM public.payroll_department_batches
            ORDER BY id
            """
        )
        return [dict(zip(columns, row)) for row in data]
