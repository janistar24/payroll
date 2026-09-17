REQUIRED_COLUMNS = {
    "employees": {"organization_id"},
    "payroll_department_batches": {"edit_version", "last_edited_at", "last_edited_by_id"},
    "payroll_change_notes": {"department_batch_id", "employee_id", "field_code", "reason"},
    "payslip_email_deliveries": {"payroll_item_id", "status", "updated_at"},
}


def validate_required_schema(db) -> None:
    """Fail deployment early instead of exposing users to unrelated API 500s."""
    data, _ = db.fetch(
        """SELECT table_name, column_name
           FROM information_schema.columns
           WHERE table_schema='public' AND table_name = ANY(%s)""",
        (list(REQUIRED_COLUMNS),),
    )
    available = {}
    for table_name, column_name in data:
        available.setdefault(table_name, set()).add(column_name)
    missing = [
        f"{table}.{column}"
        for table, columns in REQUIRED_COLUMNS.items()
        for column in sorted(columns - available.get(table, set()))
    ]
    if missing:
        raise RuntimeError("ฐานข้อมูลยังไม่พร้อม กรุณารัน migration ที่ขาด: " + ", ".join(missing))
    constraints, _ = db.fetch(
        """SELECT pg_get_constraintdef(oid)
           FROM pg_constraint
           WHERE conname='payslip_email_deliveries_status_check'"""
    )
    if not constraints or "SENDING" not in constraints[0][0]:
        raise RuntimeError("ฐานข้อมูลยังไม่พร้อม กรุณารัน migration 016_payslip_sending_lock.sql")
