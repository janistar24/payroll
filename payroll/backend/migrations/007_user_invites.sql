CREATE TABLE IF NOT EXISTS public.user_invites (
    id bigserial PRIMARY KEY,
    token_hash character varying(64) NOT NULL UNIQUE,
    email character varying(255) NOT NULL,
    requested_role character varying(20) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_by_id integer REFERENCES public.users(id) ON DELETE SET NULL,
    created_at timestamp with time zone NOT NULL DEFAULT NOW(),
    CONSTRAINT user_invites_role_check CHECK (requested_role IN ('hr','director','admin'))
);
CREATE INDEX IF NOT EXISTS user_invites_active_idx ON public.user_invites (email, expires_at) WHERE used_at IS NULL;
