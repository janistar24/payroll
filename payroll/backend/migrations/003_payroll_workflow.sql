ALTER TABLE public.payroll_periods
ADD COLUMN IF NOT EXISTS pay_date date,
ADD COLUMN IF NOT EXISTS note character varying(500),
ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT NOW();

UPDATE public.payroll_periods
SET pay_date = COALESCE(pay_date, (make_date(year, month, 1) + INTERVAL '1 month - 1 day')::date)
WHERE pay_date IS NULL;

CREATE TABLE IF NOT EXISTS public.payslip_email_deliveries (
    id bigserial PRIMARY KEY,
    payroll_item_id integer NOT NULL REFERENCES public.payroll_items(id) ON DELETE CASCADE,
    status character varying(20) NOT NULL DEFAULT 'PENDING',
    sent_at timestamp with time zone,
    error_message character varying(500),
    created_at timestamp with time zone NOT NULL DEFAULT NOW(),
    updated_at timestamp with time zone NOT NULL DEFAULT NOW(),
    CONSTRAINT payslip_email_deliveries_status_check CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
    CONSTRAINT payslip_email_deliveries_payroll_item_unique UNIQUE (payroll_item_id)
);

CREATE INDEX IF NOT EXISTS payslip_email_deliveries_status_idx
ON public.payslip_email_deliveries (status);
