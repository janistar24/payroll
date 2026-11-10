ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS current_session_id UUID;

COMMENT ON COLUMN public.users.current_session_id IS
  'Latest authenticated browser session. A new login invalidates the previous token.';
