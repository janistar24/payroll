CREATE TABLE IF NOT EXISTS public.access_requests (
    id bigserial PRIMARY KEY,
    invite_id bigint NOT NULL UNIQUE REFERENCES public.user_invites(id) ON DELETE CASCADE,
    username character varying(100) NOT NULL UNIQUE,
    password_hash character varying(255) NOT NULL,
    password_vault text,
    requested_role character varying(20) NOT NULL,
    employee_data jsonb NOT NULL,
    status character varying(20) NOT NULL DEFAULT 'PENDING',
    reviewed_by_id integer REFERENCES public.users(id) ON DELETE SET NULL,
    employee_id integer REFERENCES public.employees(id) ON DELETE SET NULL,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT NOW(),
    CONSTRAINT access_requests_status_check CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    CONSTRAINT access_requests_role_check CHECK (requested_role IN ('hr', 'director', 'admin'))
);

CREATE INDEX IF NOT EXISTS access_requests_pending_idx
ON public.access_requests (status, created_at DESC);

-- Safe for databases where this migration was partially applied during development.
ALTER TABLE public.access_requests ADD COLUMN IF NOT EXISTS password_vault text;
ALTER TABLE public.access_requests ADD COLUMN IF NOT EXISTS employee_id integer REFERENCES public.employees(id) ON DELETE SET NULL;
