from DBHelper import DBHelper


class Employees:

    def __init__(self):
        self.db = DBHelper()

    def dump(self, department_id=None):
        data, columns = self.db.fetch(
            """
            SELECT
                employee.*,
                department.code AS department_code,
                department.name AS department_name,
                position.code AS position_code,
                position.name AS position_name,
                position.level AS position_level
            FROM public.employees employee
            LEFT JOIN public.departments department ON department.id = employee.department_id
            LEFT JOIN public.positions position ON position.id = employee.position_id
            WHERE employee.status <> 'TERMINATED'
              AND (%s::integer IS NULL OR employee.department_id = %s)
            ORDER BY employee.employee_code
            """,
            (department_id, department_id)
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

    @staticmethod
    def _validate_references(cursor, department_id, position_id):
        if department_id is not None:
            cursor.execute(
                "SELECT id FROM public.departments WHERE id = %s AND is_active = TRUE",
                (department_id,)
            )
            if cursor.fetchone() is None:
                raise ValueError("ไม่พบหน่วยงานที่เปิดใช้งาน")

        if position_id is not None:
            cursor.execute(
                "SELECT id FROM public.positions WHERE id = %s AND is_active = TRUE",
                (position_id,)
            )
            if cursor.fetchone() is None:
                raise ValueError("ไม่พบตำแหน่งที่เปิดใช้งาน")

    def create(self, employee):
        with self.db.transaction() as cursor:
            self._validate_references(
                cursor,
                employee.department_id,
                employee.position_id
            )
            cursor.execute(
                """
                INSERT INTO public.employees (
                    employee_code,
                    national_id,
                    prefix,
                    first_name,
                    last_name,
                    department_id,
                    position_id,
                    employee_type,
                    employee_type_other,
                    status,
                    birth_date,
                    start_date,
                    end_date,
                    email,
                    phone,
                    bank_name,
                    bank_account_no,
                    base_salary
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s, %s, %s, %s
                )
                RETURNING id
                """,
                (
                    employee.employee_code.strip(),
                    employee.national_id.strip(),
                    employee.prefix.strip() if employee.prefix else None,
                    employee.first_name.strip(),
                    employee.last_name.strip(),
                    employee.department_id,
                    employee.position_id,
                    employee.employee_type,
                    employee.employee_type_other.strip() if employee.employee_type_other else None,
                    employee.status,
                    employee.birth_date,
                    employee.start_date,
                    employee.end_date,
                    employee.email.strip() if employee.email else None,
                    employee.phone.strip() if employee.phone else None,
                    employee.bank_name.strip() if employee.bank_name else None,
                    employee.bank_account_no.strip() if employee.bank_account_no else None,
                    employee.base_salary
                )
            )
            return cursor.fetchone()[0]

    def update(self, employee_id, employee):
        with self.db.transaction() as cursor:
            self._validate_references(
                cursor,
                employee.department_id,
                employee.position_id
            )
            cursor.execute(
                """
                UPDATE public.employees
                SET employee_code = %s,
                    national_id = %s,
                    prefix = %s,
                    first_name = %s,
                    last_name = %s,
                    department_id = %s,
                    position_id = %s,
                    employee_type = %s,
                employee_type_other = %s,
                status = %s,
                birth_date = %s,
                start_date = %s,
                    end_date = %s,
                    email = %s,
                    phone = %s,
                    bank_name = %s,
                    bank_account_no = %s,
                    base_salary = %s,
                    updated_at = NOW()
                WHERE id = %s
                RETURNING id
                """,
                (
                    employee.employee_code.strip(),
                    employee.national_id.strip(),
                    employee.prefix.strip() if employee.prefix else None,
                    employee.first_name.strip(),
                    employee.last_name.strip(),
                    employee.department_id,
                    employee.position_id,
                    employee.employee_type,
                    employee.employee_type_other.strip() if employee.employee_type_other else None,
                    employee.status,
                    employee.birth_date,
                    employee.start_date,
                    employee.end_date,
                    employee.email.strip() if employee.email else None,
                    employee.phone.strip() if employee.phone else None,
                    employee.bank_name.strip() if employee.bank_name else None,
                    employee.bank_account_no.strip() if employee.bank_account_no else None,
                    employee.base_salary,
                    employee_id
                )
            )
            return cursor.fetchone() is not None

    def update_status(self, employee_id, status):
        with self.db.transaction() as cursor:
            cursor.execute(
                """
                UPDATE public.employees
                SET status = %s,
                    updated_at = NOW()
                WHERE id = %s
                RETURNING id
                """,
                (status, employee_id)
            )
            return cursor.fetchone() is not None

    def update_email(self, employee_id, email):
        with self.db.transaction() as cursor:
            cursor.execute(
                """
                UPDATE public.employees
                SET email = %s,
                    updated_at = NOW()
                WHERE id = %s
                RETURNING id
                """,
                (email.strip(), employee_id)
            )
            return cursor.fetchone() is not None
