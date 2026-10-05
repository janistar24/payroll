ALTER TABLE public.payroll_items
  ADD COLUMN IF NOT EXISTS calculation_method VARCHAR(20) NOT NULL DEFAULT 'FULL_MONTH',
  ADD COLUMN IF NOT EXISTS full_month_salary NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS calculation_base_days INTEGER,
  ADD COLUMN IF NOT EXISTS payable_days INTEGER,
  ADD COLUMN IF NOT EXISTS calculation_start_date DATE,
  ADD COLUMN IF NOT EXISTS calculation_end_date DATE,
  ADD COLUMN IF NOT EXISTS calculation_reason VARCHAR(1000);

UPDATE public.payroll_items
SET full_month_salary = base_salary
WHERE full_month_salary IS NULL;

ALTER TABLE public.payroll_items
  DROP CONSTRAINT IF EXISTS payroll_items_calculation_method_check;

ALTER TABLE public.payroll_items
  ADD CONSTRAINT payroll_items_calculation_method_check
  CHECK (calculation_method IN ('FULL_MONTH', 'DAILY'));

ALTER TABLE public.payroll_items
  DROP CONSTRAINT IF EXISTS payroll_items_calculation_days_check;

ALTER TABLE public.payroll_items
  ADD CONSTRAINT payroll_items_calculation_days_check
  CHECK (
    calculation_method = 'FULL_MONTH'
    OR (
      calculation_base_days BETWEEN 1 AND 31
      AND payable_days BETWEEN 1 AND calculation_base_days
      AND calculation_reason IS NOT NULL
      AND LENGTH(BTRIM(calculation_reason)) > 0
    )
  );
