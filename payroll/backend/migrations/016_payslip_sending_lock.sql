ALTER TABLE public.payslip_email_deliveries
  DROP CONSTRAINT IF EXISTS payslip_email_deliveries_status_check;

ALTER TABLE public.payslip_email_deliveries
  ADD CONSTRAINT payslip_email_deliveries_status_check
  CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'FAILED'));
