ALTER TABLE public.payroll_department_batches
  ADD COLUMN IF NOT EXISTS visible_pay_item_codes JSONB;

COMMENT ON COLUMN public.payroll_department_batches.visible_pay_item_codes IS
  'NULL means show every active pay item type; otherwise stores the ordered codes shown in this batch.';
