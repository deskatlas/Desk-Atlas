-- MS-67 Down Migration: Revert overdue review notification tracking
BEGIN;

DROP INDEX IF EXISTS public.idx_payment_attempts_overdue_notified;

ALTER TABLE public.payment_attempts
  DROP COLUMN IF EXISTS overdue_notified_at;

COMMIT;
