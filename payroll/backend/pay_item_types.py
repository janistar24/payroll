import uuid

from DBHelper import DBHelper


class PayItemTypes:

    def __init__(self):
        self.db = DBHelper()

    def dump(self):
        data, columns = self.db.fetch(
            """
            SELECT
                id,
                code,
                name,
                category,
                is_taxable,
                is_active
            FROM public.pay_item_types
            ORDER BY id
            """
        )
        return [dict(zip(columns, row)) for row in data]

    def create(self, name, category):
        """Create a reusable earning/deduction type without trusting client codes."""
        normalized_name = " ".join(name.split())
        if not normalized_name:
            raise ValueError("กรุณาระบุชื่อรายการ")
        if category not in {"EARNING", "DEDUCTION"}:
            raise ValueError("ประเภทรายการไม่ถูกต้อง")

        with self.db.transaction() as cursor:
            cursor.execute(
                """
                SELECT id, code, name, category, is_taxable, is_active
                FROM public.pay_item_types
                WHERE LOWER(BTRIM(name)) = LOWER(BTRIM(%s)) AND category = %s
                LIMIT 1
                """,
                (normalized_name, category),
            )
            existing = cursor.fetchone()
            if existing:
                columns = tuple(desc.name for desc in cursor.description)
                return dict(zip(columns, existing))

            prefix = "EARN" if category == "EARNING" else "DEDUCT"
            code = f"CUSTOM_{prefix}_{uuid.uuid4().hex[:12].upper()}"
            cursor.execute(
                """
                INSERT INTO public.pay_item_types (code, name, category, is_taxable, is_active)
                VALUES (%s, %s, %s, FALSE, TRUE)
                RETURNING id, code, name, category, is_taxable, is_active
                """,
                (code, normalized_name, category),
            )
            columns = tuple(desc.name for desc in cursor.description)
            return dict(zip(columns, cursor.fetchone()))

    def rename(self, item_type_id, name):
        normalized_name = " ".join(name.split())
        if not normalized_name:
            raise ValueError("กรุณาระบุชื่อรายการ")
        with self.db.transaction() as cursor:
            cursor.execute(
                "SELECT id, code, category FROM public.pay_item_types WHERE id=%s FOR UPDATE",
                (item_type_id,),
            )
            existing = cursor.fetchone()
            if existing is None:
                raise ValueError("ไม่พบประเภทรายการ")
            if not existing[1].startswith("CUSTOM_"):
                raise ValueError("ไม่สามารถแก้ชื่อประเภทรายการมาตรฐานของระบบได้")
            cursor.execute(
                """SELECT 1 FROM public.pay_item_types
                   WHERE id<>%s AND category=%s AND LOWER(BTRIM(name))=LOWER(BTRIM(%s))
                   LIMIT 1""",
                (item_type_id, existing[2], normalized_name),
            )
            if cursor.fetchone() is not None:
                raise ValueError("มีชื่อประเภทรายการนี้อยู่แล้ว")
            cursor.execute(
                """UPDATE public.pay_item_types SET name=%s WHERE id=%s
                   RETURNING id, code, name, category, is_taxable, is_active""",
                (normalized_name, item_type_id),
            )
            columns = tuple(desc.name for desc in cursor.description)
            return dict(zip(columns, cursor.fetchone()))
