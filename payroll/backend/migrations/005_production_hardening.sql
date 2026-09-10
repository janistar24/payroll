CREATE TABLE IF NOT EXISTS public.audit_logs (
    id bigserial PRIMARY KEY,
    actor_user_id integer REFERENCES public.users(id) ON DELETE SET NULL,
    action character varying(80) NOT NULL,
    entity_type character varying(80) NOT NULL,
    entity_id character varying(80),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamp with time zone NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON public.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_actor_created_idx ON public.audit_logs (actor_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.login_failures (
    id bigserial PRIMARY KEY,
    username character varying(100) NOT NULL,
    ip_address character varying(64),
    attempted_at timestamp with time zone NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS login_failures_username_attempted_idx
ON public.login_failures (username, attempted_at DESC);

CREATE INDEX IF NOT EXISTS employees_active_department_code_idx
ON public.employees (department_id, employee_code)
WHERE status <> 'TERMINATED';
CREATE INDEX IF NOT EXISTS payroll_batches_period_department_idx
ON public.payroll_department_batches (payroll_period_id, department_id);
CREATE INDEX IF NOT EXISTS payroll_batches_status_idx
ON public.payroll_department_batches (status);
CREATE INDEX IF NOT EXISTS payroll_items_period_department_idx
ON public.payroll_items (payroll_period_id, department_id, employee_id);
