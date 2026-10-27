-- Backward Migration: Revert Automated Quarterly Retention Purge Stored Procedure
BEGIN;

DROP FUNCTION IF EXISTS public.execute_quarterly_retention_purge(timestamptz);

CREATE OR REPLACE FUNCTION public.prevent_reservation_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Reservations are historical business records and may not be hard-deleted';
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_payment_attempt_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Payment attempts are immutable historical records and may not be hard-deleted';
END;
$$;

COMMIT;
