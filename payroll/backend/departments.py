from DBHelper import DBHelper


class Departments:

    def __init__(self):
        self.db = DBHelper()

    def dump(self):
        data, columns = self.db.fetch(
            """
            SELECT
                id,
                code,
                name,
                is_active
            FROM public.departments
            WHERE is_active = TRUE
            ORDER BY id
            """
        )

        departments = []

        for row in data:
            departments.append(dict(zip(columns, row)))

        return departments

    def read(self, department_id):
        data, columns = self.db.fetch(
            """
            SELECT
                id,
                code,
                name,
                is_active
            FROM public.departments
            WHERE id = %s
            """,
            (department_id,)
        )

        if len(data) == 0:
            return (
                {
                    "Is Error": True,
                    "Error Message": (
                        f"ไม่พบหน่วยงานรหัส {department_id}"
                    )
                },
                {}
            )

        department = dict(zip(columns, data[0]))

        return (
            {
                "Is Error": False,
                "Error Message": ""
            },
            department
        )
