-- The same employee can appear in the original batch and its revision.
-- They must still appear at most once within a single department batch.
ALTER TABLE public.payroll_items
  DROP CONSTRAINT IF EXISTS uq_payroll_item_period_employee;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_item_batch_employee
  ON public.payroll_items (department_batch_id, employee_id);
