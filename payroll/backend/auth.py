import os
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from DBHelper import DBHelper


TOKEN_ALGORITHM = "HS256"
TOKEN_LIFETIME_HOURS = 8
bearer_scheme = HTTPBearer(auto_error=False)


class AuthService:
    def __init__(self):
        self.db = DBHelper()
        self.secret = os.getenv("JWT_SECRET")
        if not self.secret:
            raise RuntimeError("กรุณากำหนด JWT_SECRET ในไฟล์ .env")

    def ensure_login_allowed(self, username, ip_address):
        data, _ = self.db.fetch(
            """SELECT COUNT(*) FROM public.login_failures
               WHERE username = %s AND ip_address = %s
               AND attempted_at > NOW() - INTERVAL '15 minutes'""",
            (username, ip_address),
        )
        if data[0][0] >= int(os.getenv("LOGIN_MAX_FAILURES", "5")):
            raise HTTPException(status_code=429, detail="ลองเข้าสู่ระบบมากเกินไป กรุณารอ 15 นาที")

    def record_login_failure(self, username, ip_address):
        self.db.execute(
            "INSERT INTO public.login_failures (username, ip_address) VALUES (%s, %s)",
            (username, ip_address),
        )

    def clear_login_failures(self, username, ip_address):
        self.db.execute("DELETE FROM public.login_failures WHERE username = %s AND ip_address = %s", (username, ip_address))

    def authenticate(self, username, password):
        data, columns = self.db.fetch(
            """
            SELECT
                users.id,
                users.username,
                users.password_hash,
                users.full_name,
                users.email,
                roles.code AS role,
                employees.department_id,
                departments.name AS department_name
            FROM public.users users
            JOIN public.roles roles ON roles.id = users.role_id
            LEFT JOIN public.employees employees ON employees.id = users.employee_id
            LEFT JOIN public.departments departments ON departments.id = employees.department_id
            WHERE users.username = %s
              AND users.is_active = TRUE
            """,
            (username,)
        )
        if not data:
            return None

        user = dict(zip(columns, data[0]))
        if not bcrypt.checkpw(password.encode("utf-8"), user["password_hash"].encode("utf-8")):
            return None
        user.pop("password_hash")
        return user

    def create_token(self, user):
        now = datetime.now(timezone.utc)
        payload = {
            "sub": str(user["id"]),
            "username": user["username"],
            "role": user["role"],
            "department_id": user["department_id"],
            "iat": now,
            "exp": now + timedelta(hours=TOKEN_LIFETIME_HOURS)
        }
        return jwt.encode(payload, self.secret, algorithm=TOKEN_ALGORITHM)

    def decode_token(self, token):
        try:
            return jwt.decode(token, self.secret, algorithms=[TOKEN_ALGORITHM])
        except jwt.PyJWTError as error:
            raise HTTPException(status_code=401, detail="โทเคนไม่ถูกต้องหรือหมดอายุ") from error

    def current_user(self, credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme)):
        if credentials is None:
            raise HTTPException(status_code=401, detail="กรุณาเข้าสู่ระบบ")
        claims = self.decode_token(credentials.credentials)
        data, columns = self.db.fetch(
            """
            SELECT
                users.id,
                users.username,
                users.full_name,
                users.email,
                roles.code AS role,
                employees.department_id,
                departments.name AS department_name
            FROM public.users users
            JOIN public.roles roles ON roles.id = users.role_id
            LEFT JOIN public.employees employees ON employees.id = users.employee_id
            LEFT JOIN public.departments departments ON departments.id = employees.department_id
            WHERE users.id = %s
              AND users.is_active = TRUE
            """,
            (int(claims["sub"]),)
        )
        if not data:
            raise HTTPException(status_code=401, detail="ไม่พบบัญชีผู้ใช้ที่เปิดใช้งาน")
        return dict(zip(columns, data[0]))

    def list_users(self):
        data, columns = self.db.fetch(
            """
            SELECT users.id, users.username, users.full_name, users.email, users.employee_id,
                   users.is_active, users.created_at, roles.code AS role,
                   employee.employee_code, employee.first_name, employee.last_name,
                   department.name AS department_name
            FROM public.users users
            JOIN public.roles roles ON roles.id = users.role_id
            LEFT JOIN public.employees employee ON employee.id = users.employee_id
            LEFT JOIN public.departments department ON department.id = employee.department_id
            ORDER BY users.username
            """
        )
        return [dict(zip(columns, row)) for row in data]

    def create_user(self, username, temporary_password, employee_id, role_code):
        password_hash = bcrypt.hashpw(temporary_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        with self.db.transaction() as cursor:
            cursor.execute("SELECT id, prefix, first_name, last_name, email FROM public.employees WHERE id = %s", (employee_id,))
            employee = cursor.fetchone()
            if employee is None:
                raise ValueError("ไม่พบข้อมูลพนักงานที่เลือก")
            cursor.execute("SELECT id FROM public.roles WHERE code = %s", (role_code,))
            role = cursor.fetchone()
            if role is None:
                raise ValueError("ไม่พบสิทธิ์ผู้ใช้งาน")
            cursor.execute("SELECT id FROM public.users WHERE employee_id = %s", (employee_id,))
            if cursor.fetchone() is not None:
                raise ValueError("พนักงานคนนี้มีบัญชีผู้ใช้งานแล้ว")
            full_name = f"{employee[1] or ''}{employee[2]} {employee[3]}".strip()
            cursor.execute(
                """INSERT INTO public.users (username, password_hash, full_name, email, role_id, employee_id, is_active, created_at)
                   VALUES (%s, %s, %s, %s, %s, %s, TRUE, NOW()) RETURNING id""",
                (username, password_hash, full_name, employee[4], role[0], employee_id),
            )
            return cursor.fetchone()[0]

    def reset_password(self, user_id, temporary_password):
        password_hash = bcrypt.hashpw(temporary_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        with self.db.transaction() as cursor:
            cursor.execute("UPDATE public.users SET password_hash = %s WHERE id = %s RETURNING id", (password_hash, user_id))
            if cursor.fetchone() is None:
                raise ValueError("ไม่พบบัญชีผู้ใช้")

    def change_password(self, user_id, current_password, new_password):
        with self.db.transaction() as cursor:
            cursor.execute("SELECT password_hash FROM public.users WHERE id = %s AND is_active = TRUE", (user_id,))
            record = cursor.fetchone()
            if record is None or not bcrypt.checkpw(current_password.encode("utf-8"), record[0].encode("utf-8")):
                raise ValueError("รหัสผ่านปัจจุบันไม่ถูกต้อง")
            password_hash = bcrypt.hashpw(new_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
            cursor.execute("UPDATE public.users SET password_hash = %s WHERE id = %s", (password_hash, user_id))


auth_service = AuthService()


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme)
):
    return auth_service.current_user(credentials)
