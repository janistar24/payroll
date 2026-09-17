INSERT INTO public.pay_item_types (code, name, category, is_taxable, is_active)
VALUES
  ('EXTRA_PAY', 'เงินเพิ่ม', 'EARNING', TRUE, TRUE),
  ('POS_ALLOW', 'เงินประจำตำแหน่ง', 'EARNING', TRUE, TRUE),
  ('KTB_LOAN', 'ชำระหนี้ธนาคารกรุงไทย', 'DEDUCTION', FALSE, TRUE),
  ('TAX', 'ภาษีหัก ณ ที่จ่าย', 'DEDUCTION', FALSE, TRUE),
  ('SSF', 'เงินสมทบประกันสังคม', 'DEDUCTION', FALSE, TRUE),
  ('FUNERAL_FUND', 'ฌาปนกิจ', 'DEDUCTION', FALSE, TRUE),
  ('KTB_BANK', 'ธนาคารกรุงไทย', 'DEDUCTION', FALSE, TRUE),
  ('SAVINGS_BANK_LOAN', 'ธ.ออมสิน/ธ.ธอส.', 'DEDUCTION', FALSE, TRUE)
ON CONFLICT (code) DO UPDATE
SET category = EXCLUDED.category,
    is_active = TRUE;
