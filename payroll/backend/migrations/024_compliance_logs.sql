ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS actor_username VARCHAR(100),
  ADD COLUMN IF NOT EXISTS actor_role VARCHAR(30),
  ADD COLUMN IF NOT EXISTS outcome VARCHAR(20) NOT NULL DEFAULT 'SUCCESS',
  ADD COLUMN IF NOT EXISTS ip_address VARCHAR(64),
  ADD COLUMN IF NOT EXISTS user_agent VARCHAR(500),
  ADD COLUMN IF NOT EXISTS request_id UUID;

DROP TRIGGER IF EXISTS audit_logs_no_update ON public.audit_logs;

UPDATE public.audit_logs log
   SET actor_username = COALESCE(log.actor_username, users.username),
       actor_role = COALESCE(log.actor_role, roles.code)
  FROM public.users users
  JOIN public.roles roles ON roles.id = users.role_id
 WHERE log.actor_user_id = users.id
   AND (log.actor_username IS NULL OR log.actor_role IS NULL);

CREATE INDEX IF NOT EXISTS audit_logs_action_created_idx
  ON public.audit_logs (action, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_username_created_idx
  ON public.audit_logs (actor_username, created_at DESC);

CREATE TABLE IF NOT EXISTS public.access_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
  username VARCHAR(100),
  role VARCHAR(30),
  ip_address VARCHAR(64) NOT NULL,
  user_agent VARCHAR(500),
  method VARCHAR(10) NOT NULL,
  path VARCHAR(500) NOT NULL,
  status_code INTEGER NOT NULL CHECK (status_code BETWEEN 100 AND 599),
  request_id UUID NOT NULL UNIQUE,
  duration_ms NUMERIC(12,2) NOT NULL DEFAULT 0,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS access_logs_occurred_at_idx ON public.access_logs (occurred_at DESC);
CREATE INDEX IF NOT EXISTS access_logs_username_occurred_idx ON public.access_logs (username, occurred_at DESC);
CREATE INDEX IF NOT EXISTS access_logs_status_occurred_idx ON public.access_logs (status_code, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.prevent_compliance_log_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'compliance logs are append-only';
END;
$$;

CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON public.audit_logs
FOR EACH ROW EXECUTE FUNCTION public.prevent_compliance_log_update();

DROP TRIGGER IF EXISTS access_logs_no_update ON public.access_logs;
CREATE TRIGGER access_logs_no_update BEFORE UPDATE ON public.access_logs
FOR EACH ROW EXECUTE FUNCTION public.prevent_compliance_log_update();
