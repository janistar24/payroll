ALTER TABLE public.employees
ADD COLUMN IF NOT EXISTS employee_type_other character varying(150);

ALTER TABLE public.employees
DROP CONSTRAINT IF EXISTS employees_employee_type_other_check;

ALTER TABLE public.employees
ADD CONSTRAINT employees_employee_type_other_check CHECK (
    (employee_type = 'OTHER' AND NULLIF(BTRIM(employee_type_other), '') IS NOT NULL)
    OR
    (employee_type <> 'OTHER' AND employee_type_other IS NULL)
);
