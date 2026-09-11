ALTER TABLE public.access_requests
ADD COLUMN IF NOT EXISTS rejection_reason text;
