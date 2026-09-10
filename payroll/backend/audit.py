import json

from DBHelper import DBHelper


class AuditLogger:
    def __init__(self):
        self.db = DBHelper()

    def log(self, actor_user_id, action, entity_type, entity_id=None, metadata=None):
        with self.db.transaction() as cursor:
            cursor.execute(
                """
                INSERT INTO public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
                VALUES (%s, %s, %s, %s, %s::jsonb)
                """,
                (actor_user_id, action, entity_type, str(entity_id) if entity_id is not None else None,
                 json.dumps(metadata or {}, ensure_ascii=False, default=str)),
            )
