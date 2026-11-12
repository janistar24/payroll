import json
import logging
from contextvars import ContextVar

from DBHelper import DBHelper


request_audit_context = ContextVar("request_audit_context", default={})


class AuditLogger:
    def __init__(self):
        self.db = DBHelper()

    def log(self, actor_user_id, action, entity_type, entity_id=None, metadata=None, *, outcome="SUCCESS", actor_username=None, actor_role=None):
        try:
            context = request_audit_context.get() or {}
            with self.db.transaction() as cursor:
                cursor.execute(
                    """
                    INSERT INTO public.audit_logs (
                        actor_user_id, actor_username, actor_role, action, entity_type,
                        entity_id, outcome, metadata, ip_address, user_agent, request_id
                    )
                    VALUES (
                        %s,
                        COALESCE(%s, (SELECT username FROM public.users WHERE id = %s)),
                        COALESCE(%s, (SELECT roles.code FROM public.users JOIN public.roles roles ON roles.id=users.role_id WHERE users.id = %s)),
                        %s, %s, %s, %s, %s::jsonb, %s, %s, %s
                    )
                    """,
                    (
                        actor_user_id,
                        actor_username or context.get("username"),
                        actor_user_id,
                        actor_role or context.get("role"),
                        actor_user_id,
                        action,
                        entity_type,
                        str(entity_id) if entity_id is not None else None,
                        outcome,
                        json.dumps(metadata or {}, ensure_ascii=False, default=str),
                        context.get("ip_address"),
                        context.get("user_agent"),
                        context.get("request_id"),
                    ),
                )
        except Exception:
            # The requested operation has already committed by the time audit
            # logging runs. Never tell the user that saving failed (and tempt a
            # duplicate retry) only because the secondary audit record failed.
            logging.exception("Unable to write audit log: %s %s", entity_type, action)

    def log_access(self, *, actor_user_id, username, role, ip_address, user_agent, method, path, status_code, request_id, duration_ms):
        try:
            self.db.execute(
                """
                INSERT INTO public.access_logs (
                    actor_user_id, username, role, ip_address, user_agent, method,
                    path, status_code, request_id, duration_ms
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (request_id) DO NOTHING
                """,
                (actor_user_id, username, role, ip_address, user_agent, method, path,
                 status_code, request_id, round(duration_ms, 2)),
            )
        except Exception:
            logging.exception("Unable to write access log: %s %s", method, path)

    def purge_expired(self, retention_days):
        """Keep statutory traffic/audit records for at least the configured period."""
        retention_days = max(90, min(int(retention_days), 730))
        with self.db.transaction() as cursor:
            cursor.execute(
                "DELETE FROM public.access_logs WHERE occurred_at < NOW() - (%s * INTERVAL '1 day')",
                (retention_days,),
            )
            cursor.execute(
                "DELETE FROM public.audit_logs WHERE created_at < NOW() - (%s * INTERVAL '1 day')",
                (retention_days,),
            )

    @staticmethod
    def _describe_location(row):
        if row.get("log_type") == "access":
            path = str((row.get("details") or {}).get("path") or "")
            method = str((row.get("details") or {}).get("method") or "")
            routes = (
                ("/api/employees", "หน้าพนักงาน", "ดู/เพิ่ม/แก้ไขข้อมูลพนักงาน"),
                ("/api/payroll_periods", "หน้ารอบเงินเดือน", "สร้าง/ดู/ลบรอบเงินเดือน"),
                ("/api/payroll_department_batches", "ตารางรอบเงินเดือน", "บันทึกหรือเปลี่ยนสถานะรอบเงินเดือน"),
                ("/api/reports/", "หน้ารายงาน", "เรียกดูรายงาน"),
                ("/api/admin/audit-logs", "หน้าบันทึกการใช้งาน", "ค้นหาหรือส่งออกบันทึก"),
                ("/api/admin/invites", "หน้าจัดการผู้ใช้งาน", "สร้างลิงก์คำเชิญ"),
                ("/api/admin/access-requests", "หน้าจัดการผู้ใช้งาน", "ตรวจสอบคำขอใช้งาน"),
                ("/api/users", "หน้าจัดการผู้ใช้งาน", "จัดการบัญชีผู้ใช้"),
                ("/api/announcements", "หน้าหลัก", "ประกาศการอัปเดตระบบ"),
                ("/api/invites/", "หน้าสมัครขอใช้งาน", "เปิดหรือส่งแบบฟอร์มสมัคร"),
                ("/api/auth/", "หน้าเข้าสู่ระบบ/ข้อมูลของฉัน", "จัดการการเข้าสู่ระบบ"),
            )
            for prefix, page, feature in routes:
                if path.startswith(prefix):
                    return f"{page} · {feature} ({method})"
            return f"API {path or 'ไม่ทราบเส้นทาง'}"

        resource = str(row.get("resource_type") or "")
        action = str(row.get("action") or "")
        resource_locations = {
            "employee": ("หน้าพนักงาน", "เพิ่ม/แก้ไข/เปลี่ยนสถานะพนักงาน"),
            "payroll_period": ("หน้ารอบเงินเดือน", "จัดการรอบเงินเดือน"),
            "payroll_department_batch": ("ตารางรอบเงินเดือน", "บันทึก/ส่งอนุมัติ/อนุมัติ/แก้ไขรอบ"),
            "pay_item_type": ("ตารางรอบเงินเดือน", "แก้ไขประเภทรายการรับ/หัก"),
            "payslip_email": ("หน้าสถานะการส่งอีเมล", "ส่งสลิปเงินเดือน"),
            "user_invite": ("หน้าจัดการผู้ใช้งาน", "สร้างลิงก์คำเชิญ"),
            "access_request": ("หน้าจัดการผู้ใช้งาน", "อนุมัติหรือปฏิเสธคำขอ"),
            "user": ("หน้าจัดการผู้ใช้งาน", "จัดการบัญชีผู้ใช้"),
            "system_announcement": ("หน้าหลัก", "สร้างหรือลบประกาศ"),
            "audit_log": ("หน้าบันทึกการใช้งาน", "ส่งออก CSV"),
            "auth": ("หน้าเข้าสู่ระบบ/ข้อมูลของฉัน", "เข้าสู่ระบบ ออกจากระบบ หรือเปลี่ยนรหัสผ่าน"),
        }
        page, feature = resource_locations.get(resource, ("ระบบ", action))
        return f"{page} · {feature}"

    def list_logs(self, *, source="all", date_from=None, date_to=None, username=None, action=None, outcome=None, ip_address=None, limit=100, offset=0):
        conditions = []
        params = []
        if date_from:
            conditions.append("occurred_at >= %s")
            params.append(date_from)
        if date_to:
            conditions.append("occurred_at < %s")
            params.append(date_to)
        if username:
            conditions.append("LOWER(username) LIKE LOWER(%s)")
            params.append(f"%{username.strip()}%")
        if action:
            conditions.append("LOWER(action) LIKE LOWER(%s)")
            params.append(f"%{action.strip()}%")
        if outcome:
            conditions.append("outcome = %s")
            params.append(outcome)
        if ip_address:
            conditions.append("ip_address ILIKE %s")
            params.append(f"%{ip_address.strip()}%")
        where = " WHERE " + " AND ".join(conditions) if conditions else ""
        source_filter = " WHERE log_type = %s" if source in {"audit", "access"} else ""
        outer_params = [source] if source_filter else []
        sql = f"""
            WITH combined AS (
                SELECT 'audit'::text AS log_type, 'A-' || id::text AS id, created_at AS occurred_at,
                       actor_username AS username, actor_role AS role, action,
                       entity_type AS resource_type, entity_id AS resource_id, outcome,
                       ip_address, user_agent, request_id::text, metadata AS details
                  FROM public.audit_logs
                UNION ALL
                SELECT 'access'::text, 'T-' || id::text, occurred_at, username, role,
                       method || ' ' || path, 'http_request', NULL,
                       CASE WHEN status_code < 400 THEN 'SUCCESS' ELSE 'FAILED' END,
                       ip_address, user_agent, request_id::text,
                       jsonb_build_object('status_code', status_code, 'duration_ms', duration_ms,
                                          'path', path, 'method', method)
                  FROM public.access_logs access
                 WHERE NOT (
                       access.status_code < 400
                   AND access.method IN ('POST','PUT','PATCH','DELETE')
                   AND EXISTS (
                       SELECT 1 FROM public.audit_logs audit
                        WHERE audit.request_id = access.request_id
                   )
                 )
            ), filtered AS (
                SELECT * FROM combined{where}
            )
            SELECT *, COUNT(*) OVER() AS total_count
              FROM filtered{source_filter}
             ORDER BY occurred_at DESC, id DESC
             LIMIT %s OFFSET %s
        """
        query_params = params + outer_params + [limit, offset]
        data, columns = self.db.fetch(sql, tuple(query_params))
        rows = [dict(zip(columns, row)) for row in data]
        for row in rows:
            row["location"] = self._describe_location(row)
        return rows
