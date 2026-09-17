import json
import logging

from DBHelper import DBHelper


class AuditLogger:
    def __init__(self):
        self.db = DBHelper()

    def log(self, actor_user_id, action, entity_type, entity_id=None, metadata=None):
        try:
            with self.db.transaction() as cursor:
                cursor.execute(
                    """
                    INSERT INTO public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
                    VALUES (%s, %s, %s, %s, %s::jsonb)
                    """,
                    (actor_user_id, action, entity_type, str(entity_id) if entity_id is not None else None,
                     json.dumps(metadata or {}, ensure_ascii=False, default=str)),
                )
        except Exception:
            # The requested operation has already committed by the time audit
            # logging runs. Never tell the user that saving failed (and tempt a
            # duplicate retry) only because the secondary audit record failed.
            logging.exception("Unable to write audit log: %s %s", entity_type, action)
