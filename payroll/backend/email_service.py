import os
import smtplib
import hashlib
from datetime import datetime
from email.message import EmailMessage
from io import BytesIO

from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.lib.pdfencrypt import StandardEncryption
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

from DBHelper import DBHelper


class PayslipEmailService:
    def __init__(self):
        self.db = DBHelper()
        self.host = os.getenv("SMTP_HOST", "")
        self.port = int(os.getenv("SMTP_PORT", "465"))
        self.username = os.getenv("SMTP_USERNAME", "")
        self.password = os.getenv("SMTP_APP_PASSWORD", "")
        self.from_email = os.getenv("SMTP_FROM_EMAIL", self.username)
        self.from_name = os.getenv("SMTP_FROM_NAME", "ระบบจัดทำเงินเดือน")

    def _ensure_configured(self):
        if not all([self.host, self.username, self.password, self.from_email]):
            raise ValueError("ยังตั้งค่า SMTP ในไฟล์ .env ไม่ครบ")

    def _load_item(self, payroll_item_id):
        data, columns = self.db.fetch(
            """
            SELECT item.id, item.base_salary, item.total_earnings, item.total_deductions, item.net_pay,
                   employee.employee_code, employee.prefix, employee.first_name, employee.last_name, employee.email,
                   employee.birth_date, position.name AS position_name,
                   department.name AS department_name, period.month, period.year, period.pay_date
            FROM public.payroll_items item
            JOIN public.employees employee ON employee.id = item.employee_id
            JOIN public.departments department ON department.id = item.department_id
            JOIN public.payroll_periods period ON period.id = item.payroll_period_id
            LEFT JOIN public.positions position ON position.id = employee.position_id
            WHERE item.id = %s
            """,
            (payroll_item_id,),
        )
        if not data:
            raise ValueError("ไม่พบรายการสลิปเงินเดือน")
        item = dict(zip(columns, data[0]))
        lines, _ = self.db.fetch(
            """
            SELECT item_type.code, line.amount
            FROM public.payroll_item_lines line
            JOIN public.pay_item_types item_type ON item_type.id = line.pay_item_type_id
            WHERE line.payroll_item_id = %s
            """,
            (payroll_item_id,),
        )
        item["lines"] = dict(lines)
        return item

    @staticmethod
    def _money(value):
        return f"{float(value):,.2f}"

    def _email_pdf_password(self, item):
        if item["birth_date"] is None:
            raise ValueError("พนักงานยังไม่มีวันเดือนปีเกิด กรุณาเพิ่มข้อมูลก่อนส่งสลิป")
        return item["birth_date"].strftime("%d%m%Y")

    def _build_pdf(self, item, password=None):
        buffer = BytesIO()
        font_name = "Helvetica"
        latin_font_name = "Helvetica"
        thai_font = os.path.join(os.path.dirname(__file__), "assets", "NotoSansThai-Regular.ttf")
        latin_font = os.path.join(os.path.dirname(__file__), "assets", "NotoSans-Regular.ttf")
        if os.path.exists(thai_font):
            if "PayrollThai" not in pdfmetrics.getRegisteredFontNames():
                pdfmetrics.registerFont(TTFont("PayrollThai", thai_font))
            font_name = "PayrollThai"
        if os.path.exists(latin_font):
            if "PayrollLatin" not in pdfmetrics.getRegisteredFontNames():
                pdfmetrics.registerFont(TTFont("PayrollLatin", latin_font))
            latin_font_name = "PayrollLatin"
        encryption = None
        if password:
            owner_password = hashlib.sha256(
                f"{self.password}:{item['id']}:{item['employee_code']}".encode()
            ).hexdigest()
            encryption = StandardEncryption(
                userPassword=password,
                ownerPassword=owner_password,
                canPrint=0,
                canModify=0,
                canCopy=0,
                canAnnotate=0,
            )
        pdf = canvas.Canvas(buffer, pagesize=A4, encrypt=encryption)
        width, height = A4
        pdf.setTitle(f"Payslip {item['employee_code']}")

        def text(x, y, value, size=10, align="left"):
            # Noto Sans Thai deliberately has no Latin glyphs.  Split mixed
            # Thai/Latin text so employee codes, dates and money stay visible.
            value = str(value)
            runs = []
            current_font = None
            current_text = ""
            for character in value:
                selected_font = latin_font_name if ord(character) < 128 else font_name
                if current_font is not None and selected_font != current_font:
                    runs.append((current_font, current_text))
                    current_text = ""
                current_font = selected_font
                current_text += character
            if current_text:
                runs.append((current_font, current_text))
            total_width = sum(pdf.stringWidth(run, run_font, size) for run_font, run in runs)
            cursor_x = x - total_width if align == "right" else x - total_width / 2 if align == "center" else x
            for run_font, run in runs:
                pdf.setFont(run_font, size)
                pdf.drawString(cursor_x, y, run)
                cursor_x += pdf.stringWidth(run, run_font, size)

        def rule(x1, y1, x2, y2, rule_width=0.7):
            pdf.setLineWidth(rule_width)
            pdf.line(x1, y1, x2, y2)

        def line_amount(code):
            return item["lines"].get(code, 0)

        month_names = ["", "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"]
        pay_date = item["pay_date"]
        pay_date_text = pay_date.strftime("%d/%m/%Y") if hasattr(pay_date, "strftime") else str(pay_date or "-")
        employee_name = f"{item['prefix'] or ''}{item['first_name']} {item['last_name']}"

        logo_path = os.path.join(os.path.dirname(__file__), "assets", "takhli_black_logo.jpeg")
        if os.path.exists(logo_path):
            pdf.drawImage(ImageReader(logo_path), 125, height - 78, width=38, height=38, preserveAspectRatio=True, mask="auto")
        text(width / 2 + 18, height - 48, "เทศบาลเมืองตาคลี", 19, "center")
        text(width / 2 + 18, height - 69, "ใบจ่ายเงินเดือน (Pay Slip)", 12, "center")

        # Employee details: two paired fields across three rows, matching the paper slip layout.
        x0, x1, x2, x3, x4 = 38, 112, 300, 368, width - 38
        details_top, detail_row = height - 104, 24
        details_bottom = details_top - detail_row * 3
        pdf.rect(x0, details_bottom, x4 - x0, details_top - details_bottom)
        for x in (x1, x2, x3):
            rule(x, details_bottom, x, details_top)
        for index in range(1, 3):
            rule(x0, details_top - detail_row * index, x4, details_top - detail_row * index)
        detail_rows = [
            ("รหัสพนักงาน :", item["employee_code"], "ตำแหน่ง :", item.get("position_name") or "-"),
            ("ชื่อ-นามสกุล :", employee_name, "สังกัด :", item["department_name"]),
            ("วันที่จ่าย :", pay_date_text, "ประจำเดือน :", f"{month_names[item['month']]} {item['year'] + 543}"),
        ]
        for index, values in enumerate(detail_rows):
            y = details_top - detail_row * (index + 1) + 7
            text(x0 + 6, y, values[0], 9)
            text(x1 + 6, y, values[1], 9)
            text(x2 + 6, y, values[2], 9)
            text(x3 + 6, y, values[3], 9)

        # Income and deduction table.  All values come from the saved payroll lines.
        table_top, header_height, row_height, total_height = details_bottom - 18, 24, 25, 25
        item_rows = 5
        table_bottom = table_top - header_height - row_height * item_rows - total_height
        lx0, lx1, lx2, lx3, lx4 = 38, 210, 298, 470, width - 38
        pdf.rect(lx0, table_bottom, lx4 - lx0, table_top - table_bottom)
        # The header has two merged cells: เงินได้ and เงินหัก.  The inner
        # label/amount dividers begin below that header row.
        rule(lx2, table_bottom, lx2, table_top)
        for x in (lx1, lx3):
            rule(x, table_bottom, x, table_top - header_height)
        rule(lx0, table_top - header_height, lx4, table_top - header_height)
        for index in range(1, item_rows + 1):
            rule(lx0, table_top - header_height - row_height * index, lx4, table_top - header_height - row_height * index)
        text((lx0 + lx2) / 2, table_top - 16, "เงินได้", 11, "center")
        text((lx2 + lx4) / 2, table_top - 16, "เงินหัก", 11, "center")
        income_rows = [
            ("เงินเดือน", item["base_salary"]),
            ("เงินประจำตำแหน่ง", line_amount("POS_ALLOW")),
            ("เงินเพิ่ม", line_amount("EXTRA_PAY")),
            ("ตกเบิก", 0),
            ("รายได้อื่น ๆ", 0),
        ]
        deduction_rows = [
            ("ชำระหนี้ธนาคารกรุงไทย", line_amount("KTB_LOAN")),
            ("ภาษีหัก ณ ที่จ่าย", line_amount("TAX")),
            ("ประกันสังคม", line_amount("SSF")),
            ("ฌาปนกิจ", line_amount("FUNERAL_FUND")),
            ("ธนาคารออมสิน", line_amount("SAVINGS_BANK_LOAN")),
        ]
        for index, ((income_label, income_value), (deduct_label, deduct_value)) in enumerate(zip(income_rows, deduction_rows)):
            y = table_top - header_height - row_height * (index + 1) + 8
            text(lx0 + 7, y, income_label, 9)
            text(lx2 - 7, y, f"{self._money(income_value)} บาท", 9, "right")
            text(lx2 + 7, y, deduct_label, 9)
            text(lx4 - 7, y, f"{self._money(deduct_value)} บาท", 9, "right")
        # Use a light-gray summary band with black text: suitable for on-screen
        # reading and office printing while still separating the totals clearly.
        summary_gray = (0.90, 0.91, 0.93)
        pdf.setFillColorRGB(*summary_gray)
        pdf.rect(lx0, table_bottom, lx2 - lx0, total_height, fill=1, stroke=0)
        pdf.rect(lx2, table_bottom, lx4 - lx2, total_height, fill=1, stroke=0)
        pdf.setStrokeColorRGB(0, 0, 0)
        pdf.rect(lx0, table_bottom, lx4 - lx0, total_height, fill=0, stroke=1)
        rule(lx2, table_bottom, lx2, table_bottom + total_height)
        pdf.setFillColorRGB(0, 0, 0)
        total_y = table_bottom + 8
        text(lx0 + 7, total_y, "รวมเงินได้", 9)
        text(lx2 - 7, total_y, f"{self._money(item['total_earnings'])} บาท", 9, "right")
        text(lx2 + 7, total_y, "รวมเงินหัก", 9)
        text(lx4 - 7, total_y, f"{self._money(item['total_deductions'])} บาท", 9, "right")

        net_top, net_bottom = table_bottom - 12, table_bottom - 43
        pdf.setFillColorRGB(*summary_gray)
        pdf.rect(lx0, net_bottom, lx4 - lx0, net_top - net_bottom, fill=1, stroke=0)
        pdf.setFillColorRGB(0, 0, 0)
        pdf.rect(lx0, net_bottom, lx4 - lx0, net_top - net_bottom)
        rule(lx2, net_bottom, lx2, net_top)
        pdf.setFillColorRGB(0, 0, 0)
        text(lx0 + 7, net_bottom + 10, "รวมเงินได้สุทธิ", 9)
        text(lx4 - 7, net_bottom + 10, f"{self._money(item['net_pay'])} บาท", 9, "right")
        pdf.setFillColorRGB(0, 0, 0)

        signature_y = net_bottom - 66
        text(52, signature_y, "ลงชื่อผู้จ่ายเงิน", 10)
        rule(142, signature_y - 2, 292, signature_y - 2)
        text(322, signature_y, "ลงชื่อผู้รับเงิน", 10)
        rule(412, signature_y - 2, 557, signature_y - 2)
        text(38, 38, f"จัดทำโดยระบบเมื่อ {datetime.now().strftime('%d/%m/%Y %H:%M')}", 7)
        pdf.save()
        return buffer.getvalue()

    def build_payslip_pdf(self, payroll_item_id, lock_for_email=False):
        item = self._load_item(payroll_item_id)
        password = self._email_pdf_password(item) if lock_for_email else None
        filename = f"payslip-{item['employee_code']}-{item['year']}-{item['month']:02d}.pdf"
        return self._build_pdf(item, password=password), filename

    def _set_status(self, payroll_item_id, status, error_message=None):
        with self.db.transaction() as cursor:
            cursor.execute(
                """
                INSERT INTO public.payslip_email_deliveries (payroll_item_id, status, sent_at, error_message, created_at, updated_at)
                VALUES (%s, %s, CASE WHEN %s = 'SENT' THEN NOW() ELSE NULL END, %s, NOW(), NOW())
                ON CONFLICT (payroll_item_id) DO UPDATE SET
                    status = EXCLUDED.status,
                    sent_at = EXCLUDED.sent_at,
                    error_message = EXCLUDED.error_message,
                    updated_at = NOW()
                """,
                (payroll_item_id, status, status, error_message),
            )

    def send_payslip(self, payroll_item_id):
        self._ensure_configured()
        item = self._load_item(payroll_item_id)
        if not item["email"]:
            self._set_status(payroll_item_id, "FAILED", "พนักงานไม่มีอีเมล")
            raise ValueError("พนักงานไม่มีอีเมล")

        message = EmailMessage()
        message["Subject"] = f"สลิปเงินเดือน {item['month']}/{item['year'] + 543}"
        message["From"] = f"{self.from_name} <{self.from_email}>"
        message["To"] = item["email"]
        message.set_content(
            f"เรียน {item['prefix'] or ''}{item['first_name']} {item['last_name']}\n\n"
            f"โปรดตรวจสอบสลิปเงินเดือนประจำเดือน {item['month']}/{item['year'] + 543} ที่แนบมาพร้อมอีเมลนี้\n"
            "รหัสเปิดไฟล์: วันเดือนปีเกิด ค.ศ. 8 หลัก (เช่น 15/03/1992 ใช้ 15031992)\n"
            "หากพบข้อมูลไม่ถูกต้อง กรุณาติดต่อฝ่ายทรัพยากรบุคคล\n\n"
            "อีเมลนี้ส่งโดยระบบอัตโนมัติ กรุณาอย่าตอบกลับ"
        )
        pdf_data, filename = self.build_payslip_pdf(payroll_item_id, lock_for_email=True)
        message.add_attachment(
            pdf_data, maintype="application", subtype="pdf", filename=filename,
        )
        try:
            if self.port == 465:
                with smtplib.SMTP_SSL(self.host, self.port, timeout=30) as smtp:
                    smtp.login(self.username, self.password)
                    smtp.send_message(message)
            else:
                with smtplib.SMTP(self.host, self.port, timeout=30) as smtp:
                    smtp.starttls()
                    smtp.login(self.username, self.password)
                    smtp.send_message(message)
        except Exception as error:
            self._set_status(payroll_item_id, "FAILED", str(error)[:500])
            raise ValueError("ส่งอีเมลไม่สำเร็จ") from error

        self._set_status(payroll_item_id, "SENT")
        return item["email"]
