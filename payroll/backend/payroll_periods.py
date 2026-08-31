from DBHelper import DBHelper

class Payroll_periods:

    def __init__(self):
        self.db = DBHelper()

    def dump(self):
        data, columns = self.db.fetch(
            """
            SELECT *
            FROM public.payroll_periods
            ORDER BY id
            """
        )

        payroll_periods = []

        for row in data:
            payroll_periods.append(dict(zip(columns, row)))

        return payroll_periods

    def read(self, payroll_period_id):
        data, columns = self.db.fetch(
            """
            SELECT *
            FROM public.payroll_periods
            WHERE id = %s
            """,
            (payroll_period_id,)
        )

        if len(data) == 0:
            return (
                {
                    "Is Error": True,
                    "Error Message": (
                        f"ไม่พบรอบเงินเดือนรหัส {payroll_period_id}"
                    )
                },
                {}
            )

        payroll_period = dict(zip(columns, data[0]))

        return (
            {
                "Is Error": False,
                "Error Message": ""
            },
            payroll_period
        )
