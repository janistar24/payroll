CREATE TABLE IF NOT EXISTS public.user_sessions (
  session_id UUID PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  ip_address VARCHAR(64),
  user_agent TEXT,
  device_label VARCHAR(160) NOT NULL DEFAULT 'อุปกรณ์ที่ไม่ทราบชื่อ',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS user_sessions_user_active_idx
  ON public.user_sessions (user_id, created_at DESC)
  WHERE revoked_at IS NULL;

-- Preserve tokens that were already active before this migration.
INSERT INTO public.user_sessions (session_id, user_id, device_label)
SELECT current_session_id, id, 'อุปกรณ์เดิมก่อนอัปเดตระบบ'
FROM public.users
WHERE current_session_id IS NOT NULL
ON CONFLICT (session_id) DO NOTHING;

COMMENT ON TABLE public.user_sessions IS
  'Active browser sessions. PayFlow permits at most two active sessions per account.';
