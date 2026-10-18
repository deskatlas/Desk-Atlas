-- MS-68: Customer Booking Cancellation Policy, Self-Service Cancellation, Refund Eligibility Notification, and Admin Reservations Refund Triage Queue
-- Traceability: PRD-F5, PRD-F6, SDD-C4, SDD-C5, SDD-C11, DSD-UI11, ERD-E2, ERD-E10, ERD-E11, ERD-E13, QAD-TC49
BEGIN;

ALTER TABLE public.business_settings
  ADD COLUMN IF NOT EXISTS customer_cancellation_cutoff_value integer NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS customer_cancellation_cutoff_unit text NOT NULL DEFAULT 'HOURS'
    CHECK (customer_cancellation_cutoff_unit IN ('HOURS', 'DAYS'));

ALTER TABLE public.payment_attempts
  ADD COLUMN IF NOT EXISTS cancellation_refund_notified_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_payment_attempts_cancellation_refund_notified
  ON public.payment_attempts(cancellation_refund_notified_at);

COMMIT;
