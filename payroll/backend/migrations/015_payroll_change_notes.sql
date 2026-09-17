CREATE TABLE IF NOT EXISTS public.payroll_change_notes (
  id BIGSERIAL PRIMARY KEY,
  department_batch_id INTEGER NOT NULL
    REFERENCES public.payroll_department_batches(id) ON DELETE CASCADE,
  employee_id INTEGER
    REFERENCES public.employees(id) ON DELETE SET NULL,
  employee_name VARCHAR(300),
  field_code VARCHAR(80) NOT NULL,
  old_value NUMERIC(14,2) NOT NULL,
  new_value NUMERIC(14,2) NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  changed_by_id INTEGER
    REFERENCES public.users(id) ON DELETE SET NULL,
  editor_name VARCHAR(300),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.payroll_change_notes
  ADD COLUMN IF NOT EXISTS employee_name VARCHAR(300),
  ADD COLUMN IF NOT EXISTS editor_name VARCHAR(300);

ALTER TABLE public.payroll_change_notes
  ALTER COLUMN changed_by_id DROP NOT NULL;

ALTER TABLE public.payroll_change_notes
  DROP CONSTRAINT IF EXISTS payroll_change_notes_changed_by_id_fkey;

ALTER TABLE public.payroll_change_notes
  ADD CONSTRAINT payroll_change_notes_changed_by_id_fkey
  FOREIGN KEY (changed_by_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.payroll_department_batches
  ADD COLUMN IF NOT EXISTS edit_version INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_edited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_edited_by_id INTEGER REFERENCES public.users(id) ON DELETE SET NULL;

INSERT INTO public.pay_item_types (code, name, category, is_taxable, is_active)
SELECT 'KTB_BANK', 'ธนาคารกรุงไทย', 'DEDUCTION', FALSE, TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM public.pay_item_types WHERE code = 'KTB_BANK'
);

CREATE INDEX IF NOT EXISTS payroll_change_notes_batch_changed_at_idx
  ON public.payroll_change_notes (department_batch_id, changed_at DESC);
