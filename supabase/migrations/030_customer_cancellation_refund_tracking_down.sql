-- MS-68 Down Migration: Revert customer cancellation cutoff settings and notification tracking
BEGIN;

DROP INDEX IF EXISTS public.idx_payment_attempts_cancellation_refund_notified;

ALTER TABLE public.payment_attempts
  DROP COLUMN IF EXISTS cancellation_refund_notified_at;

ALTER TABLE public.business_settings
  DROP COLUMN IF EXISTS customer_cancellation_cutoff_value,
  DROP COLUMN IF EXISTS customer_cancellation_cutoff_unit;

COMMIT;
