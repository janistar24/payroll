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
        self.secret = os.getenv("JWT_SECRET") or os.getenv("POSTGRES_PASSWORD")
        if not self.secret:
            raise RuntimeError("กรุณากำหนด JWT_SECRET ในไฟล์ .env")

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


auth_service = AuthService()


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme)
):
    return auth_service.current_user(credentials)

