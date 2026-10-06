ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS can_approve_payroll BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS users_can_approve_payroll_idx
  ON public.users (can_approve_payroll)
  WHERE can_approve_payroll = TRUE;
