import os
import hashlib
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from cryptography.fernet import Fernet, InvalidToken
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
        self.password_vault_key = os.getenv("PASSWORD_VAULT_KEY")
        if not self.password_vault_key:
            raise RuntimeError("กรุณากำหนด PASSWORD_VAULT_KEY ในไฟล์ .env")
        self.password_vault = Fernet(self.password_vault_key.encode("utf-8"))

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
                   department.name AS department_name,
                   request.id AS access_request_id,
                   (request.password_vault IS NOT NULL) AS has_initial_password
            FROM public.users users
            JOIN public.roles roles ON roles.id = users.role_id
            LEFT JOIN public.employees employee ON employee.id = users.employee_id
            LEFT JOIN public.departments department ON department.id = employee.department_id
            LEFT JOIN public.access_requests request ON request.employee_id = users.employee_id
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

    def delete_user_and_employee(self, user_id, actor_user_id):
        """Permanently erase an account and every record owned by that employee."""
        if user_id == actor_user_id:
            raise ValueError("ไม่สามารถลบบัญชีที่กำลังเข้าสู่ระบบอยู่ได้")
        with self.db.transaction() as cursor:
            cursor.execute("SELECT employee_id, username FROM public.users WHERE id = %s FOR UPDATE", (user_id,))
            account = cursor.fetchone()
            if account is None:
                raise ValueError("ไม่พบบัญชีผู้ใช้")
            employee_id, username = account
            # Delete dependent payroll records first.  This action is intentionally
            # irreversible and is only exposed to an administrator via confirmation.
            if employee_id is not None:
                cursor.execute("DELETE FROM public.payroll_item_lines WHERE payroll_item_id IN (SELECT id FROM public.payroll_items WHERE employee_id = %s)", (employee_id,))
                cursor.execute("DELETE FROM public.payroll_items WHERE employee_id = %s", (employee_id,))
                cursor.execute("DELETE FROM public.payroll_batch_employee_exclusions WHERE employee_id = %s", (employee_id,))
                cursor.execute("DELETE FROM public.user_invites WHERE id IN (SELECT invite_id FROM public.access_requests WHERE employee_id = %s)", (employee_id,))
                cursor.execute("DELETE FROM public.access_requests WHERE employee_id = %s", (employee_id,))
            cursor.execute("DELETE FROM public.audit_logs WHERE (entity_type = 'user' AND entity_id = %s) OR actor_user_id = %s", (str(user_id), user_id))
            cursor.execute("DELETE FROM public.login_failures WHERE username = %s", (username,))
            # Clear every ownership/audit reference to the account.  Payroll
            # periods and batches are shared department records, so deleting the
            # account removes only its attribution, never other staff's payroll.
            cursor.execute("UPDATE public.access_requests SET reviewed_by_id = NULL WHERE reviewed_by_id = %s", (user_id,))
            cursor.execute("UPDATE public.user_invites SET created_by_id = NULL WHERE created_by_id = %s", (user_id,))
            cursor.execute("UPDATE public.payroll_department_batches SET submitted_by_id = NULL WHERE submitted_by_id = %s", (user_id,))
            cursor.execute("UPDATE public.payroll_department_batches SET approved_by_id = NULL WHERE approved_by_id = %s", (user_id,))
            cursor.execute("UPDATE public.payroll_periods SET created_by_id = NULL WHERE created_by_id = %s", (user_id,))
            cursor.execute("UPDATE public.payroll_periods SET approved_by_id = NULL WHERE approved_by_id = %s", (user_id,))
            cursor.execute("UPDATE public.salary_history SET created_by_id = NULL WHERE created_by_id = %s", (user_id,))
            cursor.execute("DELETE FROM public.users WHERE id = %s", (user_id,))
            if employee_id is not None:
                cursor.execute("DELETE FROM public.employees WHERE id = %s", (employee_id,))
            return username

    def deactivate_user(self, user_id, actor_user_id):
        if user_id == actor_user_id:
            raise ValueError("ไม่สามารถปิดการใช้งานบัญชีที่กำลังเข้าสู่ระบบอยู่ได้")
        with self.db.transaction() as cursor:
            cursor.execute("UPDATE public.users SET is_active = FALSE WHERE id = %s RETURNING username", (user_id,))
            record = cursor.fetchone()
            if record is None:
                raise ValueError("ไม่พบบัญชีผู้ใช้")
            return record[0]

    def change_password(self, user_id, current_password, new_password):
        with self.db.transaction() as cursor:
            cursor.execute("SELECT password_hash FROM public.users WHERE id = %s AND is_active = TRUE", (user_id,))
            record = cursor.fetchone()
            if record is None or not bcrypt.checkpw(current_password.encode("utf-8"), record[0].encode("utf-8")):
                raise ValueError("รหัสผ่านปัจจุบันไม่ถูกต้อง")
            password_hash = bcrypt.hashpw(new_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
            cursor.execute("UPDATE public.users SET password_hash = %s WHERE id = %s", (password_hash, user_id))

    def create_invite(self, email, role, actor_id):
        token = secrets.token_urlsafe(32)
        with self.db.transaction() as cursor:
            cursor.execute("INSERT INTO public.user_invites (token_hash,email,requested_role,expires_at,created_by_id) VALUES (%s,%s,%s,NOW()+INTERVAL '7 days',%s)", (hashlib.sha256(token.encode()).hexdigest(), email.lower().strip(), role, actor_id))
        return token

    def validate_invite(self, token):
        data, cols = self.db.fetch("SELECT id,email,requested_role,expires_at FROM public.user_invites WHERE token_hash=%s AND used_at IS NULL AND expires_at>NOW()", (hashlib.sha256(token.encode()).hexdigest(),))
        if not data: raise ValueError("ลิงก์เชิญไม่ถูกต้อง หมดอายุ หรือถูกใช้แล้ว")
        return dict(zip(cols,data[0]))

    def submit_access_request(self, token, username, password, employee_data):
        invite = self.validate_invite(token)
        if (employee_data.get("email") or "").strip().lower() != invite["email"]:
            raise ValueError("อีเมลต้องตรงกับอีเมลที่ได้รับคำเชิญ")
        password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        with self.db.transaction() as cursor:
            cursor.execute("SELECT id FROM public.users WHERE username = %s", (username,))
            if cursor.fetchone() is not None:
                raise ValueError("ชื่อผู้ใช้นี้ถูกใช้แล้ว")
            # A rejected request is not an account.  Remove its consumed invite
            # and request so the applicant may correct the form and apply again
            # with the same username.
            cursor.execute("SELECT id, invite_id, status FROM public.access_requests WHERE username = %s FOR UPDATE", (username,))
            previous_request = cursor.fetchone()
            if previous_request is not None:
                if previous_request[2] != "REJECTED":
                    raise ValueError("ชื่อผู้ใช้นี้มีคำขอที่กำลังดำเนินการอยู่")
                cursor.execute("DELETE FROM public.user_invites WHERE id = %s", (previous_request[1],))
            cursor.execute("SELECT id FROM public.access_requests WHERE invite_id = %s", (invite["id"],))
            if cursor.fetchone() is not None:
                raise ValueError("คำเชิญนี้ถูกส่งข้อมูลแล้ว")
            cursor.execute(
                """INSERT INTO public.access_requests
                   (invite_id, username, password_hash, password_vault, requested_role, employee_data)
                   VALUES (%s, %s, %s, %s, %s, %s::jsonb)""",
                (invite["id"], username.strip(), password_hash, self.password_vault.encrypt(password.encode("utf-8")).decode("utf-8"), invite["requested_role"], __import__("json").dumps(employee_data, default=str)),
            )
            cursor.execute("UPDATE public.user_invites SET used_at = NOW() WHERE id = %s", (invite["id"],))

    def list_access_requests(self):
        data, cols = self.db.fetch(
            """SELECT request.id, request.username, request.requested_role, request.status,
                      request.employee_data, request.created_at, invite.email AS invited_email
                 FROM public.access_requests request
                 JOIN public.user_invites invite ON invite.id = request.invite_id
                ORDER BY request.created_at DESC"""
        )
        return [dict(zip(cols, row)) for row in data]

    def reveal_requested_password(self, request_id):
        data, _ = self.db.fetch("SELECT password_vault FROM public.access_requests WHERE id = %s", (request_id,))
        if not data or not data[0][0]:
            raise ValueError("ไม่พบรหัสผ่านที่ตั้งตอนสมัคร")
        try:
            return self.password_vault.decrypt(data[0][0].encode("utf-8")).decode("utf-8")
        except InvalidToken as error:
            raise ValueError("ไม่สามารถอ่านรหัสผ่านที่เข้ารหัสไว้") from error

    def approve_access_request(self, request_id, employee_id, actor_id, actual_role):
        with self.db.transaction() as cursor:
            cursor.execute("SELECT username, password_hash, status FROM public.access_requests WHERE id = %s FOR UPDATE", (request_id,))
            request = cursor.fetchone()
            if request is None or request[2] != "PENDING":
                raise ValueError("ไม่พบคำขอที่รออนุมัติ")
            cursor.execute("SELECT id, prefix, first_name, last_name, email FROM public.employees WHERE id = %s", (employee_id,))
            employee = cursor.fetchone()
            if employee is None:
                raise ValueError("ไม่พบพนักงานที่ตรวจสอบแล้ว")
            cursor.execute("SELECT id FROM public.users WHERE employee_id = %s OR username = %s", (employee_id, request[0]))
            if cursor.fetchone() is not None:
                raise ValueError("พนักงานหรือชื่อผู้ใช้นี้มีบัญชีแล้ว")
            cursor.execute("SELECT id FROM public.roles WHERE code = %s", (actual_role,))
            role = cursor.fetchone()
            if role is None:
                raise ValueError("ไม่พบสิทธิ์ผู้ใช้งาน")
            full_name = f"{employee[1] or ''}{employee[2]} {employee[3]}".strip()
            cursor.execute(
                """INSERT INTO public.users (username, password_hash, full_name, email, role_id, employee_id, is_active, created_at)
                   VALUES (%s, %s, %s, %s, %s, %s, TRUE, NOW())""",
                (request[0], request[1], full_name, employee[4], role[0], employee_id),
            )
            cursor.execute("UPDATE public.access_requests SET status = 'APPROVED', employee_id = %s, reviewed_by_id = %s, reviewed_at = NOW() WHERE id = %s", (employee_id, actor_id, request_id))

    def find_unlinked_employee(self, employee_code, national_id):
        """Return an employee left by an interrupted approval, if it is safe to reuse."""
        data, columns = self.db.fetch(
            """SELECT employee.id, linked_user.id AS user_id
               FROM public.employees employee
               LEFT JOIN public.users linked_user ON linked_user.employee_id = employee.id
               WHERE employee.employee_code = %s OR employee.national_id = %s
               ORDER BY employee.id DESC""",
            (employee_code.strip(), national_id.strip()),
        )
        if not data:
            return None
        records = [dict(zip(columns, row)) for row in data]
        if any(record["user_id"] is not None for record in records):
            raise ValueError("รหัสพนักงานหรือเลขบัตรประชาชนนี้มีบัญชีผู้ใช้แล้ว")
        return records[0]["id"]

    def ensure_username_available(self, username):
        data, _ = self.db.fetch("SELECT id FROM public.users WHERE username = %s", (username.strip(),))
        if data:
            raise ValueError("ชื่อผู้ใช้นี้ถูกใช้แล้ว")

    def reject_access_request(self, request_id, actor_id, reason=None):
        with self.db.transaction() as cursor:
            cursor.execute(
                """SELECT invite_id FROM public.access_requests
                   WHERE id = %s AND status = 'PENDING'
                   FOR UPDATE""",
                (request_id,),
            )
            record = cursor.fetchone()
            if record is None:
                raise ValueError("ไม่พบคำขอที่รอพิจารณา")
            # Deleting the invite cascades to access_requests.  The rejected
            # applicant leaves no personal data, username, or password vault.
            cursor.execute("DELETE FROM public.user_invites WHERE id = %s", (record[0],))


auth_service = AuthService()


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme)
):
    return auth_service.current_user(credentials)
