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