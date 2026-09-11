-- A payroll department may have historical revisions, but only one revision
-- may be the current working version for a period and department.
ALTER TABLE public.payroll_department_batches
  DROP CONSTRAINT IF EXISTS uq_batch_period_department;

CREATE UNIQUE INDEX IF NOT EXISTS uq_current_batch_period_department
  ON public.payroll_department_batches (payroll_period_id, department_id)
  WHERE is_current = TRUE;
