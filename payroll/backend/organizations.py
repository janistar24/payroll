from DBHelper import DBHelper


class Organizations:
    def __init__(self):
        self.db = DBHelper()

    def dump(self):
        data, columns = self.db.fetch("SELECT id, name, is_active FROM public.organizations ORDER BY name")
        return [dict(zip(columns, row)) for row in data]

    def create(self, name):
        normalized = name.strip()
        with self.db.transaction() as cursor:
            cursor.execute("SELECT id, name, is_active FROM public.organizations WHERE LOWER(name) = LOWER(%s) LIMIT 1", (normalized,))
            existing = cursor.fetchone()
            if existing:
                return dict(zip((desc.name for desc in cursor.description), existing))
            cursor.execute("INSERT INTO public.organizations (name, is_active) VALUES (%s, TRUE) RETURNING id, name, is_active", (normalized,))
            return dict(zip((desc.name for desc in cursor.description), cursor.fetchone()))
