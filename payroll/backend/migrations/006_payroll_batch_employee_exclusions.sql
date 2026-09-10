CREATE TABLE IF NOT EXISTS public.payroll_batch_employee_exclusions (
    department_batch_id integer NOT NULL REFERENCES public.payroll_department_batches(id) ON DELETE CASCADE,
    employee_id integer NOT NULL REFERENCES public.employees(id),
    created_at timestamp with time zone NOT NULL DEFAULT NOW(),
    PRIMARY KEY (department_batch_id, employee_id)
);

CREATE INDEX IF NOT EXISTS payroll_batch_employee_exclusions_employee_idx
ON public.payroll_batch_employee_exclusions (employee_id);
