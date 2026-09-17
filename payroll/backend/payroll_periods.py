from DBHelper import DBHelper

class Payroll_periods:

    def __init__(self):
        self.db = DBHelper()

    def dump(self, department_id=None):
        period_query = (
            """
            SELECT pp.id, pp.year, pp.month, pp.pay_date, pp.note, pp.status,
                   pp.created_by_id, creator.full_name AS created_by_name,
                   pp.created_at, pp.approved_by_id,
                   approver.full_name AS approved_by_name, pp.approved_at, pp.updated_at
            FROM public.payroll_periods pp
            LEFT JOIN public.users creator ON creator.id = pp.created_by_id
            LEFT JOIN public.users approver ON approver.id = pp.approved_by_id
            WHERE %s::integer IS NULL OR EXISTS (
                SELECT 1 FROM public.payroll_department_batches filter_batch
                WHERE filter_batch.payroll_period_id = pp.id
                  AND filter_batch.department_id = %s
                  AND filter_batch.is_current = TRUE
            )
            ORDER BY pp.year DESC, pp.month DESC, pp.id DESC
            """,
            (department_id, department_id)
        )

        batch_query = (
            """
            SELECT batch.id, batch.payroll_period_id, batch.department_id,
                   department.code AS department_code,
                   department.name AS department_name, batch.status,
                   batch.submitted_by_id, submitter.full_name AS submitted_by_name,
                   batch.submitted_at, batch.approved_by_id,
                   approver.full_name AS approved_by_name, batch.approved_at,
                   batch.reject_reason, batch.created_at, batch.revision_number,
                   batch.parent_batch_id, batch.revision_type, batch.revision_reason,
                   reviser.full_name AS revision_created_by_name,
                   batch.edit_version, batch.last_edited_at,
                   COALESCE(editor.full_name, editor.username) AS last_edited_by_name
            FROM public.payroll_department_batches batch
            JOIN public.departments department ON department.id = batch.department_id
            LEFT JOIN public.users submitter ON submitter.id = batch.submitted_by_id
            LEFT JOIN public.users approver ON approver.id = batch.approved_by_id
            LEFT JOIN public.users reviser ON reviser.id = batch.revision_created_by_id
            LEFT JOIN public.users editor ON editor.id = batch.last_edited_by_id
            WHERE batch.is_current = TRUE
              AND (%s::integer IS NULL OR batch.department_id = %s)
            ORDER BY batch.payroll_period_id, batch.department_id
            """,
            (department_id, department_id)
        )

        item_query = (
            """
            SELECT item.id, item.payroll_period_id, item.department_batch_id,
                   item.department_id, item.employee_id, employee.employee_code,
                   employee.prefix, employee.first_name, employee.last_name,
                   employee.position_id, position.name AS position_name,
                   employee.organization_name,
                   item.base_salary, item.total_earnings, item.total_deductions,
                   item.net_pay, item.created_at, line.pay_item_type_id,
                   item_type.code AS pay_item_code, item_type.name AS pay_item_name,
                   item_type.category AS pay_item_category, line.amount,
                   delivery.status AS email_status, delivery.sent_at AS email_sent_at
            FROM public.payroll_items item
            JOIN public.payroll_department_batches batch ON batch.id = item.department_batch_id
            JOIN public.employees employee ON employee.id = item.employee_id
            LEFT JOIN public.positions position ON position.id = employee.position_id
            LEFT JOIN public.payroll_item_lines line ON line.payroll_item_id = item.id
            LEFT JOIN public.pay_item_types item_type ON item_type.id = line.pay_item_type_id
            LEFT JOIN public.payslip_email_deliveries delivery ON delivery.payroll_item_id = item.id
            WHERE batch.is_current = TRUE
              AND (%s::integer IS NULL OR item.department_id = %s)
            ORDER BY item.payroll_period_id, item.department_batch_id,
                     employee.employee_code, line.id
            """,
            (department_id, department_id)
        )

        exclusion_query = (
            """
            SELECT exclusion.department_batch_id, employee.employee_code
            FROM public.payroll_batch_employee_exclusions exclusion
            JOIN public.employees employee ON employee.id = exclusion.employee_id
            JOIN public.payroll_department_batches batch ON batch.id = exclusion.department_batch_id
            WHERE batch.is_current = TRUE
              AND (%s::integer IS NULL OR batch.department_id = %s)
            ORDER BY exclusion.department_batch_id, employee.employee_code
            """,
            (department_id, department_id)
        )

        (period_data, period_columns), (batch_data, batch_columns), (item_data, item_columns), (exclusion_data, exclusion_columns) = self.db.fetch_many(
            [period_query, batch_query, item_query, exclusion_query]
        )

        periods = {
            row[0]: {**dict(zip(period_columns, row)), "departments": []}
            for row in period_data
        }
        batches = {}
        for row in batch_data:
            batch = {**dict(zip(batch_columns, row)), "payroll_items": [], "excluded_employee_codes": []}
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

        for row in exclusion_data:
            exclusion = dict(zip(exclusion_columns, row))
            batch = batches.get(exclusion["department_batch_id"])
            if batch is not None:
                batch["excluded_employee_codes"].append(exclusion["employee_code"])

        return list(periods.values())

    def batch_history(self, batch_id):
        """Return every immutable revision for one department payroll batch."""
        batch_query = """
            SELECT batch.id, batch.payroll_period_id, batch.department_id,
                   department.code AS department_code, department.name AS department_name,
                   batch.status, batch.submitted_by_id, submitter.full_name AS submitted_by_name,
                   batch.submitted_at, batch.approved_by_id, approver.full_name AS approved_by_name,
                   batch.approved_at, batch.reject_reason, batch.created_at, batch.revision_number,
                   batch.parent_batch_id, batch.revision_type, batch.revision_reason,
                   reviser.full_name AS revision_created_by_name, batch.is_current,
                   batch.edit_version, batch.last_edited_at,
                   COALESCE(editor.full_name, editor.username) AS last_edited_by_name
            FROM public.payroll_department_batches batch
            JOIN public.departments department ON department.id = batch.department_id
            LEFT JOIN public.users submitter ON submitter.id = batch.submitted_by_id
            LEFT JOIN public.users approver ON approver.id = batch.approved_by_id
            LEFT JOIN public.users reviser ON reviser.id = batch.revision_created_by_id
            LEFT JOIN public.users editor ON editor.id = batch.last_edited_by_id
            WHERE batch.payroll_period_id = (SELECT payroll_period_id FROM public.payroll_department_batches WHERE id = %s)
              AND batch.department_id = (SELECT department_id FROM public.payroll_department_batches WHERE id = %s)
            ORDER BY batch.revision_number DESC, batch.id DESC
        """
        item_query = """
            SELECT item.id, item.department_batch_id, item.employee_id, employee.employee_code,
                   employee.prefix, employee.first_name, employee.last_name,
                   position.name AS position_name, employee.organization_name,
                   item.base_salary,
                   line.pay_item_type_id, item_type.code AS pay_item_code, line.amount
            FROM public.payroll_items item
            JOIN public.payroll_department_batches batch ON batch.id = item.department_batch_id
            JOIN public.employees employee ON employee.id = item.employee_id
            LEFT JOIN public.positions position ON position.id = employee.position_id
            LEFT JOIN public.payroll_item_lines line ON line.payroll_item_id = item.id
            LEFT JOIN public.pay_item_types item_type ON item_type.id = line.pay_item_type_id
            WHERE batch.payroll_period_id = (SELECT payroll_period_id FROM public.payroll_department_batches WHERE id = %s)
              AND batch.department_id = (SELECT department_id FROM public.payroll_department_batches WHERE id = %s)
            ORDER BY item.department_batch_id, employee.employee_code, line.id
        """
        (batch_rows, batch_columns), (item_rows, item_columns) = self.db.fetch_many([
            (batch_query, (batch_id, batch_id)),
            (item_query, (batch_id, batch_id)),
        ])
        batches = {
            row[0]: {**dict(zip(batch_columns, row)), "payroll_items": []}
            for row in batch_rows
        }
        items = {}
        line_keys = {"pay_item_type_id", "pay_item_code", "amount"}
        for row in item_rows:
            record = dict(zip(item_columns, row))
            item = items.get(record["id"])
            if item is None:
                item = {key: value for key, value in record.items() if key not in line_keys}
                item["lines"] = []
                items[item["id"]] = item
                batches[item["department_batch_id"]]["payroll_items"].append(item)
            if record["pay_item_type_id"] is not None:
                item["lines"].append({"code": record["pay_item_code"], "amount": record["amount"]})
        return list(batches.values())

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
