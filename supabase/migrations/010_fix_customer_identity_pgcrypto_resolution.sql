-- Restore pgcrypto resolution for customer identity generation on Supabase.
-- Traceability: SPEC-1, SDD-C13, ERD-E15, ERD-E21, QAD-TC36.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('extensions.gen_random_bytes(integer)') IS NULL THEN
    RAISE EXCEPTION 'pgcrypto function extensions.gen_random_bytes(integer) is required';
  END IF;
END;
$$;

ALTER FUNCTION public.process_confirmed_reservation_identity_and_outbox(uuid, timestamptz)
  SET search_path TO public, extensions;

REVOKE ALL ON FUNCTION public.process_confirmed_reservation_identity_and_outbox(uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_confirmed_reservation_identity_and_outbox(uuid, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.process_confirmed_reservation_identity_and_outbox(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_confirmed_reservation_identity_and_outbox(uuid, timestamptz) TO service_role;

COMMIT;
