from DBHelper import DBHelper

class Payroll_periods:

    def __init__(self):
        self.db = DBHelper()

    def dump(self, department_id=None):
        period_data, period_columns = self.db.fetch(
            """
            SELECT pp.id, pp.year, pp.month, pp.status,
                   pp.created_by_id, creator.full_name AS created_by_name,
                   pp.created_at, pp.approved_by_id,
                   approver.full_name AS approved_by_name, pp.approved_at
            FROM public.payroll_periods pp
            LEFT JOIN public.users creator ON creator.id = pp.created_by_id
            LEFT JOIN public.users approver ON approver.id = pp.approved_by_id
            WHERE %s IS NULL OR EXISTS (
                SELECT 1 FROM public.payroll_department_batches filter_batch
                WHERE filter_batch.payroll_period_id = pp.id
                  AND filter_batch.department_id = %s
            )
            ORDER BY pp.year DESC, pp.month DESC, pp.id DESC
            """,
            (department_id, department_id)
        )

        batch_data, batch_columns = self.db.fetch(
            """
            SELECT batch.id, batch.payroll_period_id, batch.department_id,
                   department.code AS department_code,
                   department.name AS department_name, batch.status,
                   batch.submitted_by_id, submitter.full_name AS submitted_by_name,
                   batch.submitted_at, batch.approved_by_id,
                   approver.full_name AS approved_by_name, batch.approved_at,
                   batch.reject_reason, batch.created_at
            FROM public.payroll_department_batches batch
            JOIN public.departments department ON department.id = batch.department_id
            LEFT JOIN public.users submitter ON submitter.id = batch.submitted_by_id
            LEFT JOIN public.users approver ON approver.id = batch.approved_by_id
            WHERE %s IS NULL OR batch.department_id = %s
            ORDER BY batch.payroll_period_id, batch.department_id
            """,
            (department_id, department_id)
        )

        item_data, item_columns = self.db.fetch(
            """
            SELECT item.id, item.payroll_period_id, item.department_batch_id,
                   item.department_id, item.employee_id, employee.employee_code,
                   employee.prefix, employee.first_name, employee.last_name,
                   employee.position_id, position.name AS position_name,
                   item.base_salary, item.total_earnings, item.total_deductions,
                   item.net_pay, item.created_at, line.pay_item_type_id,
                   item_type.code AS pay_item_code, item_type.name AS pay_item_name,
                   item_type.category AS pay_item_category, line.amount
            FROM public.payroll_items item
            JOIN public.employees employee ON employee.id = item.employee_id
            LEFT JOIN public.positions position ON position.id = employee.position_id
            LEFT JOIN public.payroll_item_lines line ON line.payroll_item_id = item.id
            LEFT JOIN public.pay_item_types item_type ON item_type.id = line.pay_item_type_id
            WHERE %s IS NULL OR item.department_id = %s
            ORDER BY item.payroll_period_id, item.department_batch_id,
                     employee.employee_code, line.id
            """,
            (department_id, department_id)
        )

        periods = {
            row[0]: {**dict(zip(period_columns, row)), "departments": []}
            for row in period_data
        }
        batches = {}
        for row in batch_data:
            batch = {**dict(zip(batch_columns, row)), "payroll_items": []}
            batches[batch["id"]] = batch
            if batch["payroll_period_id"] in periods:
                periods[batch["payroll_period_id"]]["departments"].append(batch)

        items = {}
        line_keys = {
            "pay_item_type_id", "pay_item_code", "pay_item_name",
            "pay_item_category", "amount"
        }
        for row in item_data:
            record = dict(zip(item_columns, row))
            item = items.get(record["id"])
            if item is None:
                item = {key: value for key, value in record.items() if key not in line_keys}
                item["lines"] = []
                items[record["id"]] = item
                batch = batches.get(item["department_batch_id"])
                if batch is not None:
                    batch["payroll_items"].append(item)
            if record["pay_item_type_id"] is not None:
                item["lines"].append({
                    "pay_item_type_id": record["pay_item_type_id"],
                    "code": record["pay_item_code"],
                    "name": record["pay_item_name"],
                    "category": record["pay_item_category"],
                    "amount": record["amount"]
                })

        return list(periods.values())

    def read(self, payroll_period_id):
        data, columns = self.db.fetch(
            """
            SELECT *
            FROM public.payroll_periods
            WHERE id = %s
            """,
            (payroll_period_id,)
        )

        if len(data) == 0:
            return (
                {
                    "Is Error": True,
                    "Error Message": (
                        f"ไม่พบรอบเงินเดือนรหัส {payroll_period_id}"
                    )
                },
                {}
            )

        payroll_period = dict(zip(columns, data[0]))

        return (
            {
                "Is Error": False,
                "Error Message": ""
            },
            payroll_period
        )
