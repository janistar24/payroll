CREATE TABLE IF NOT EXISTS public.organizations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS organizations_name_lower_unique
ON public.organizations (LOWER(name));

ALTER TABLE public.employees
ADD COLUMN IF NOT EXISTS organization_id INTEGER
REFERENCES public.organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS employees_organization_idx
ON public.employees (organization_id);
