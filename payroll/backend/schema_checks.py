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
    standard_categories = {
        "EXTRA_PAY": "EARNING",
        "POS_ALLOW": "EARNING",
        "KTB_LOAN": "DEDUCTION",
        "TAX": "DEDUCTION",
        "SSF": "DEDUCTION",
        "FUNERAL_FUND": "DEDUCTION",
        "KTB_BANK": "DEDUCTION",
        "SAVINGS_BANK_LOAN": "DEDUCTION",
    }
    pay_item_rows, _ = db.fetch(
        "SELECT code, category::text FROM public.pay_item_types WHERE code = ANY(%s) AND is_active = TRUE",
        (list(standard_categories),),
    )
    actual_categories = dict(pay_item_rows)
    missing_standard_codes = sorted(set(standard_categories) - set(actual_categories))
    if missing_standard_codes:
        raise RuntimeError(
            "ฐานข้อมูลยังไม่พร้อม กรุณารัน migration 017_activate_standard_pay_item_types.sql: "
            + ", ".join(missing_standard_codes)
        )
    wrong_categories = sorted(
        code for code, expected in standard_categories.items()
        if actual_categories.get(code) != expected
    )
    if wrong_categories:
        raise RuntimeError(
            "ฐานข้อมูลจัดหมวดรายการรับ/หักไม่ถูกต้อง กรุณารัน migration 017_activate_standard_pay_item_types.sql: "
            + ", ".join(wrong_categories)
        )
