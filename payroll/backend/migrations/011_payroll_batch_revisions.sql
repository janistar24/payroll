ALTER TABLE public.payroll_department_batches
  ADD COLUMN IF NOT EXISTS revision_number integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS parent_batch_id integer REFERENCES public.payroll_department_batches(id),
  ADD COLUMN IF NOT EXISTS revision_reason character varying(1000),
  ADD COLUMN IF NOT EXISTS revision_type character varying(40),
  ADD COLUMN IF NOT EXISTS revision_created_by_id integer REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS payroll_batch_current_revision_idx
  ON public.payroll_department_batches (payroll_period_id, department_id, is_current);
