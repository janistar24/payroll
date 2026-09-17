import json
from decimal import Decimal

from DBHelper import DBHelper


class StalePayrollVersionError(ValueError):
    """Raised when another user saved a newer version of the same batch."""


class PayrollWorkflow:
    def __init__(self):
        self.db = DBHelper()

    def create_or_get_department_batch(self, year, month, pay_date, note, created_by_id, department_id):
        """Use one current batch per department/month so every authorised editor shares it."""
        with self.db.transaction() as cursor:
            cursor.execute(
                "SELECT id FROM public.departments WHERE id = %s AND is_active = TRUE",
                (department_id,)
            )
            if cursor.fetchone() is None:
                raise ValueError("ไม่พบฝ่ายที่เปิดใช้งาน")
            cursor.execute(
                "SELECT id FROM public.payroll_periods WHERE year = %s AND month = %s FOR UPDATE",
                (year, month)
            )
            existing_period = cursor.fetchone()
            if existing_period is not None:
                period_id = existing_period[0]
                cursor.execute(
                    """SELECT id FROM public.payroll_department_batches
                       WHERE payroll_period_id = %s AND department_id = %s AND is_current = TRUE
                       FOR UPDATE""",
                    (period_id, department_id)
                )
                existing_batch = cursor.fetchone()
                if existing_batch is not None:
                    return {"period_id": period_id, "batch_id": existing_batch[0], "existing": True}
            else:
                cursor.execute(
                    """
                    INSERT INTO public.payroll_periods (year, month, pay_date, note, status, created_by_id, created_at, updated_at)
                    VALUES (%s, %s, %s, %s, 'DRAFT', %s, NOW(), NOW())
                    RETURNING id
                    """,
                    (year, month, pay_date, note, created_by_id),
                )
                period_id = cursor.fetchone()[0]
            cursor.execute(
                """
                INSERT INTO public.payroll_department_batches (payroll_period_id, department_id, status, created_at)
                VALUES (%s, %s, 'DRAFT', NOW())
                RETURNING id
                """,
                (period_id, department_id),
            )
            return {"period_id": period_id, "batch_id": cursor.fetchone()[0], "existing": False}

    def create_revision(self, batch_id, revision_type, reason, actor_id):
        with self.db.transaction() as cursor:
            cursor.execute("SELECT payroll_period_id, department_id, status, revision_number, is_current FROM public.payroll_department_batches WHERE id=%s FOR UPDATE", (batch_id,))
            source = cursor.fetchone()
            if source is None or source[2] not in {"APPROVED", "PAID"} or not source[4]:
                raise ValueError("สร้างฉบับแก้ไขได้เฉพาะรายการที่อนุมัติแล้ว")
            cursor.execute("UPDATE public.payroll_department_batches SET is_current=FALSE WHERE payroll_period_id=%s AND department_id=%s AND is_current=TRUE", (source[0], source[1]))
            cursor.execute("""INSERT INTO public.payroll_department_batches (payroll_period_id,department_id,status,created_at,revision_number,parent_batch_id,revision_type,revision_reason,revision_created_by_id,is_current)
                              VALUES (%s,%s,'DRAFT',NOW(),%s,%s,%s,%s,%s,TRUE) RETURNING id""", (source[0],source[1],source[3]+1,batch_id,revision_type,reason.strip(),actor_id))
            revision_id=cursor.fetchone()[0]
            cursor.execute("""INSERT INTO public.payroll_items (payroll_period_id,department_batch_id,department_id,employee_id,base_salary,total_earnings,total_deductions,net_pay,created_at)
                              SELECT payroll_period_id,%s,department_id,employee_id,base_salary,total_earnings,total_deductions,net_pay,NOW() FROM public.payroll_items WHERE department_batch_id=%s""", (revision_id,batch_id))
            cursor.execute("""INSERT INTO public.payroll_item_lines (payroll_item_id,pay_item_type_id,amount)
                              SELECT new.id,line.pay_item_type_id,line.amount FROM public.payroll_item_lines line JOIN public.payroll_items old ON old.id=line.payroll_item_id JOIN public.payroll_items new ON new.department_batch_id=%s AND new.employee_id=old.employee_id WHERE old.department_batch_id=%s""", (revision_id,batch_id))
            # Keep intentional removals in the revised version as well.  Without
            # this, employees removed from the original batch return after a
            # refresh of the newly created revision.
            cursor.execute(
                """INSERT INTO public.payroll_batch_employee_exclusions (department_batch_id, employee_id)
                   SELECT %s, employee_id
                   FROM public.payroll_batch_employee_exclusions
                   WHERE department_batch_id = %s
                   ON CONFLICT (department_batch_id, employee_id) DO NOTHING""",
                (revision_id, batch_id),
            )
            return revision_id

    def save_batch_items(
        self,
        batch_id,
        department_id,
        rows,
        change_notes=None,
        changed_by_id=None,
        expected_version=None,
    ):
        change_notes = change_notes or []
        with self.db.transaction() as cursor:
            cursor.execute(
                """
                SELECT batch.id, batch.status, batch.is_current, batch.edit_version
                FROM public.payroll_department_batches batch
                WHERE batch.id = %s AND batch.department_id = %s
                FOR UPDATE
                """,
                (batch_id, department_id),
            )
            batch = cursor.fetchone()
            if batch is None:
                raise ValueError("ไม่พบรายการฝ่ายของรอบเงินเดือน")
            if batch[1] not in {"DRAFT", "REJECTED"} or not batch[2]:
                raise ValueError("รายการนี้ถูกส่งอนุมัติหรือปิดแล้ว จึงไม่สามารถบันทึกทับได้")
            current_version = int(batch[3] or 0)
            if expected_version is not None and int(expected_version) != current_version:
                raise StalePayrollVersionError(
                    "ข้อมูลรอบเงินเดือนถูกแก้ไขและบันทึกโดยผู้ใช้อื่นแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนแก้ไขอีกครั้ง"
                )

            if changed_by_id is None:
                raise ValueError("ไม่พบผู้แก้ไขข้อมูล")

            employee_ids = [row["employee_id"] for row in rows]
            if len(employee_ids) != len(set(employee_ids)):
                raise ValueError("พบข้อมูลพนักงานซ้ำในตารางเงินเดือน")
            if employee_ids:
                cursor.execute(
                    """
                    SELECT id, base_salary
                    FROM public.employees
                    WHERE department_id = %s AND status = 'ACTIVE' AND id = ANY(%s)
                    """,
                    (department_id, employee_ids),
                )
                salaries = dict(cursor.fetchall())
                if len(salaries) != len(set(employee_ids)):
                    raise ValueError("พบพนักงานที่ไม่อยู่ในฝ่ายหรือไม่ได้ใช้งาน")
            else:
                salaries = {}

            cursor.execute(
                """
                SELECT item.employee_id, item_type.code, line.amount
                FROM public.payroll_items item
                JOIN public.payroll_item_lines line ON line.payroll_item_id = item.id
                JOIN public.pay_item_types item_type ON item_type.id = line.pay_item_type_id
                WHERE item.department_batch_id = %s
                """,
                (batch_id,),
            )
            saved_lines = {
                (employee_id, code): Decimal(str(amount))
                for employee_id, code, amount in cursor.fetchall()
            }
            cursor.execute(
                "SELECT employee_id FROM public.payroll_items WHERE department_batch_id = %s",
                (batch_id,),
            )
            saved_employee_ids = {record[0] for record in cursor.fetchall()}

            # Remember staff intentionally removed from this payroll batch.  Without
            # this, the live employee directory would add them back after a refresh.
            if employee_ids:
                cursor.execute(
                    "DELETE FROM public.payroll_batch_employee_exclusions WHERE department_batch_id = %s AND employee_id = ANY(%s)",
                    (batch_id, employee_ids),
                )
            cursor.execute(
                """
                INSERT INTO public.payroll_batch_employee_exclusions (department_batch_id, employee_id)
                SELECT %s, employee.id
                FROM public.employees employee
                WHERE employee.department_id = %s
                  AND employee.status = 'ACTIVE'
                  AND (CARDINALITY(%s::integer[]) = 0 OR employee.id <> ALL(%s::integer[]))
                ON CONFLICT (department_batch_id, employee_id) DO NOTHING
                """,
                (batch_id, department_id, employee_ids, employee_ids),
            )

            cursor.execute("SELECT id FROM public.payroll_items WHERE department_batch_id = %s", (batch_id,))
            previous_item_ids = [record[0] for record in cursor.fetchall()]
            if previous_item_ids:
                cursor.execute("DELETE FROM public.payroll_item_lines WHERE payroll_item_id = ANY(%s)", (previous_item_ids,))
            cursor.execute("DELETE FROM public.payroll_items WHERE department_batch_id = %s", (batch_id,))

            all_line_codes = {code for row in rows for code in row.get("lines", {})}
            if all_line_codes:
                cursor.execute(
                    "SELECT code, category FROM public.pay_item_types WHERE is_active = TRUE AND code = ANY(%s)",
                    (list(all_line_codes),),
                )
                line_categories = dict(cursor.fetchall())
                if len(line_categories) != len(all_line_codes):
                    raise ValueError("พบประเภทรายการรับหรือรายการหักที่ไม่ถูกต้อง")
            else:
                line_categories = {}

            incoming_lines = {
                (row["employee_id"], code): Decimal(str(amount))
                for row in rows
                for code, amount in row.get("lines", {}).items()
            }
            changed_keys = {
                key
                for key in set(saved_lines) | set(incoming_lines)
                if key[0] in set(employee_ids) and saved_lines.get(key, Decimal("0")) != incoming_lines.get(key, Decimal("0"))
            }
            notes_by_key = {}
            for note in change_notes:
                employee_id = note["employee_id"]
                field_code = note["field_code"]
                if employee_id not in set(employee_ids) | saved_employee_ids:
                    raise ValueError("พบประวัติการแก้ไขของพนักงานที่ไม่อยู่ในรอบเงินเดือน")
                if field_code not in line_categories and (employee_id, field_code) not in saved_lines:
                    raise ValueError("พบประเภทรายการในประวัติการแก้ไขที่ไม่ถูกต้อง")
                reason = str(note.get("reason") or "").strip()
                if not reason:
                    raise ValueError("กรุณาระบุเหตุผลของรายการที่แก้ไขให้ครบถ้วน")
                normalized = {
                    **note,
                    "reason": reason,
                    "old_value": Decimal(str(note["old_value"])),
                    "new_value": Decimal(str(note["new_value"])),
                }
                notes_by_key.setdefault((employee_id, field_code), []).append(normalized)

            for key in changed_keys:
                notes = notes_by_key.get(key, [])
                if not notes:
                    raise ValueError("กรุณาระบุเหตุผลของยอดเงินที่เปลี่ยนแปลงทุกช่อง")
                expected_old = saved_lines.get(key, Decimal("0"))
                expected_new = incoming_lines.get(key, Decimal("0"))
                if notes[0]["old_value"] != expected_old or notes[-1]["new_value"] != expected_new:
                    raise ValueError("ค่าเดิมหรือค่าใหม่ในประวัติการแก้ไขไม่ตรงกับข้อมูลล่าสุด กรุณาโหลดหน้าใหม่")
                if any(left["new_value"] != right["old_value"] for left, right in zip(notes, notes[1:])):
                    raise ValueError("ลำดับประวัติการแก้ไขไม่ต่อเนื่อง กรุณาโหลดหน้าใหม่")

            item_payload = []
            line_payload = []
            for row in rows:
                base_salary = Decimal(str(salaries[row["employee_id"]]))
                line_values = row.get("lines", {})
                earnings = sum(Decimal(str(value)) for code, value in line_values.items() if line_categories[code] == "EARNING")
                deductions = sum(Decimal(str(value)) for code, value in line_values.items() if line_categories[code] == "DEDUCTION")
                total_earnings = base_salary + earnings
                net_pay = total_earnings - deductions
                item_payload.append({
                    "employee_id": row["employee_id"],
                    "base_salary": str(base_salary),
                    "total_earnings": str(total_earnings),
                    "total_deductions": str(deductions),
                    "net_pay": str(net_pay),
                })

            # Insert every employee in one SQL call.  The old approach inserted
            # each person, then each pay line, one round-trip at a time.
            item_ids = {}
            if item_payload:
                cursor.execute(
                    """
                    INSERT INTO public.payroll_items (
                        payroll_period_id, department_batch_id, department_id, employee_id,
                        base_salary, total_earnings, total_deductions, net_pay, created_at
                    )
                    SELECT batch.payroll_period_id, batch.id, batch.department_id,
                           payload.employee_id, payload.base_salary, payload.total_earnings,
                           payload.total_deductions, payload.net_pay, NOW()
                    FROM public.payroll_department_batches batch
                    CROSS JOIN jsonb_to_recordset(%s::jsonb) AS payload(
                        employee_id integer, base_salary numeric, total_earnings numeric,
                        total_deductions numeric, net_pay numeric
                    )
                    WHERE batch.id = %s
                    RETURNING employee_id, id
                    """,
                    (json.dumps(item_payload), batch_id),
                )
                item_ids = dict(cursor.fetchall())

            for row in rows:
                item_id = item_ids[row["employee_id"]]
                for code, amount in row.get("lines", {}).items():
                    amount = Decimal(str(amount))
                    if amount != 0:
                        line_payload.append({
                            "payroll_item_id": item_id,
                            "code": code,
                            "amount": str(amount),
                        })

            if line_payload:
                cursor.execute(
                    """
                    INSERT INTO public.payroll_item_lines (payroll_item_id, pay_item_type_id, amount)
                    SELECT payload.payroll_item_id, item_type.id, payload.amount
                    FROM jsonb_to_recordset(%s::jsonb) AS payload(
                        payroll_item_id integer, code text, amount numeric
                    )
                    JOIN public.pay_item_types item_type ON item_type.code = payload.code
                    """,
                    (json.dumps(line_payload),),
                )
                if cursor.rowcount != len(line_payload):
                    raise ValueError("พบประเภทรายการรับหรือรายการหักที่ไม่ถูกต้อง")

            persisted_notes = [
                note
                for key in changed_keys
                for note in notes_by_key.get(key, [])
            ]
            added_employee_ids = set(employee_ids) - saved_employee_ids
            removed_employee_ids = saved_employee_ids - set(employee_ids)
            persisted_notes.extend({
                "employee_id": employee_id,
                "field_code": "__EMPLOYEE_ADDED__",
                "old_value": Decimal("0"),
                "new_value": Decimal("1"),
                "reason": "เพิ่มพนักงานเข้าตารางเงินเดือน",
            } for employee_id in added_employee_ids)
            persisted_notes.extend({
                "employee_id": employee_id,
                "field_code": "__EMPLOYEE_REMOVED__",
                "old_value": Decimal("1"),
                "new_value": Decimal("0"),
                "reason": "นำพนักงานออกจากตารางเงินเดือน",
            } for employee_id in removed_employee_ids)

            if persisted_notes:
                cursor.execute(
                    """INSERT INTO public.payroll_change_notes
                    (department_batch_id, employee_id, employee_name, field_code,
                     old_value, new_value, reason, changed_by_id, editor_name)
                    SELECT %s, payload.employee_id,
                           CONCAT(COALESCE(employee.prefix, ''), employee.first_name, ' ', employee.last_name),
                           payload.field_code, payload.old_value, payload.new_value,
                           payload.reason, %s, COALESCE(editor.full_name, editor.username)
                    FROM jsonb_to_recordset(%s::jsonb) AS payload(
                        employee_id integer,
                        field_code text,
                        old_value numeric,
                        new_value numeric,
                        reason text
                    )
                    LEFT JOIN public.employees employee ON employee.id = payload.employee_id
                    LEFT JOIN public.users editor ON editor.id = %s""",
                    (
                        batch_id,
                        changed_by_id,
                        json.dumps([
                            {
                                **note,
                                "old_value": str(note["old_value"]),
                                "new_value": str(note["new_value"]),
                            }
                            for note in persisted_notes
                        ]),
                        changed_by_id,
                    ),
                )

            cursor.execute(
                """UPDATE public.payroll_department_batches
                   SET edit_version = edit_version + 1,
                       last_edited_at = NOW(),
                       last_edited_by_id = %s
                   WHERE id = %s
                   RETURNING edit_version""",
                (changed_by_id, batch_id),
            )
            new_version = cursor.fetchone()[0]
            cursor.execute(
                """UPDATE public.payroll_periods
                   SET updated_at = NOW()
                   WHERE id = (
                       SELECT payroll_period_id
                       FROM public.payroll_department_batches
                       WHERE id = %s
                   )""",
                (batch_id,),
            )
            return new_version

    def change_batch_status(self, batch_id, action, user_id, reject_reason=None):
        with self.db.transaction() as cursor:
            cursor.execute("SELECT status FROM public.payroll_department_batches WHERE id = %s FOR UPDATE", (batch_id,))
            record = cursor.fetchone()
            if record is None:
                raise ValueError("ไม่พบรายการฝ่ายของรอบเงินเดือน")
            current_status = record[0]
            if action == "submit":
                if current_status not in {"DRAFT", "REJECTED"}:
                    raise ValueError("รายการนี้ไม่สามารถส่งอนุมัติได้")
                cursor.execute("UPDATE public.payroll_department_batches SET status = 'SUBMITTED', submitted_by_id = %s, submitted_at = NOW(), reject_reason = NULL WHERE id = %s", (user_id, batch_id))
            elif action == "approve":
                if current_status != "SUBMITTED":
                    raise ValueError("อนุมัติได้เฉพาะรายการที่รออนุมัติ")
                cursor.execute("UPDATE public.payroll_department_batches SET status = 'APPROVED', approved_by_id = %s, approved_at = NOW() WHERE id = %s", (user_id, batch_id))
                cursor.execute(
                    """
                    INSERT INTO public.payslip_email_deliveries (payroll_item_id, status, created_at, updated_at)
                    SELECT item.id, CASE WHEN employee.email IS NULL OR BTRIM(employee.email) = '' THEN 'FAILED' ELSE 'PENDING' END, NOW(), NOW()
                    FROM public.payroll_items item
                    JOIN public.employees employee ON employee.id = item.employee_id
                    WHERE item.department_batch_id = %s
                    ON CONFLICT (payroll_item_id) DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()
                    """,
                    (batch_id,),
                )
            elif action == "reject":
                if current_status != "SUBMITTED":
                    raise ValueError("ส่งกลับแก้ไขได้เฉพาะรายการที่รออนุมัติ")
                cursor.execute("UPDATE public.payroll_department_batches SET status = 'REJECTED', reject_reason = %s WHERE id = %s", (reject_reason, batch_id))
            else:
                raise ValueError("คำสั่งเปลี่ยนสถานะไม่ถูกต้อง")

            cursor.execute("UPDATE public.payroll_periods SET updated_at = NOW() WHERE id = (SELECT payroll_period_id FROM public.payroll_department_batches WHERE id = %s)", (batch_id,))
