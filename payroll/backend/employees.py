from DBHelper import DBHelper


class Employees:

    def __init__(self):
        self.db = DBHelper()

    def dump(self):
        data, columns = self.db.fetch(
            """
            SELECT *
            FROM public.employees
            ORDER BY id
            """
        )

        employees = []

        for row in data:
            employees.append(dict(zip(columns, row)))

        return employees

    def read(self, employee_id):
        data, columns = self.db.fetch(
            """
            SELECT *
            FROM public.employees
            WHERE id = %s
            """,
            (employee_id,)
        )

        if len(data) == 0:
            return (
                {
                    "Is Error": True,
                    "Error Message": (
                        f"ไม่พบพนักงานรหัส {employee_id}"
                    )
                },
                {}
            )

        employee = dict(zip(columns, data[0]))

        return (
            {
                "Is Error": False,
                "Error Message": ""
            },
            employee
        )