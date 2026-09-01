from DBHelper import DBHelper

class Positions:

    def __init__(self):
        self.db = DBHelper()

    def dump(self):
        data, columns = self.db.fetch(
            """
            SELECT *
            FROM public.positions
            ORDER BY id
            """
        )

        positions = []

        for row in data:
            positions.append(dict(zip(columns, row)))

        return positions

    def read(self, position_id):
        data, columns = self.db.fetch(
            """
            SELECT *
            FROM public.positions
            WHERE id = %s
            """,
            (position_id,)
        )

        if len(data) == 0:
            return (
                {
                    "Is Error": True,
                    "Error Message": (
                        f"ไม่พบตำแหน่งงานรหัส {position_id}"
                    )
                },
                {}
            )

        position = dict(zip(columns, data[0]))

        return (
            {
                "Is Error": False,
                "Error Message": ""
            },
            position
        )

    def create(self, name):
        normalized_name = name.strip()
        with self.db.transaction() as cursor:
            cursor.execute(
                """
                SELECT id, code, name, level, is_active
                FROM public.positions
                WHERE LOWER(name) = LOWER(%s)
                LIMIT 1
                """,
                (normalized_name,)
            )
            existing = cursor.fetchone()
            if existing:
                columns = tuple(desc.name for desc in cursor.description)
                return dict(zip(columns, existing))

            cursor.execute(
                """
                INSERT INTO public.positions (code, name, level, is_active)
                VALUES (
                    'POS-' || UPPER(SUBSTRING(MD5(%s || CLOCK_TIMESTAMP()::TEXT), 1, 12)),
                    %s,
                    NULL,
                    TRUE
                )
                RETURNING id, code, name, level, is_active
                """,
                (normalized_name, normalized_name)
            )
            created = cursor.fetchone()
            columns = tuple(desc.name for desc in cursor.description)
            return dict(zip(columns, created))
