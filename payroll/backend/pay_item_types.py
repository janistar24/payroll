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
