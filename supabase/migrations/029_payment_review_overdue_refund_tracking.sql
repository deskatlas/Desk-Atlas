-- MS-67: Admin Payment Review Overdue Detection, Customer Refund Notification, and Segregated Triage Queue
-- Traceability: PRD-F5, PRD-F6, SDD-C4, SDD-C5, SDD-C11, DSD-UI11, ERD-E10, ERD-E11, ERD-E13, QAD-TC48
BEGIN;

ALTER TABLE public.payment_attempts
  ADD COLUMN IF NOT EXISTS overdue_notified_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_payment_attempts_overdue_notified
  ON public.payment_attempts(overdue_notified_at);

COMMIT;
