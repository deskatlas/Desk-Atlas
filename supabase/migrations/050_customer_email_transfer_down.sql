-- Rollback Migration: 050_customer_email_transfer_down.sql
-- Description: Revert Customer Identity Email Transfer additions (MS-98)
-- Traceability: MS-98, PRD-F4, PRD-F22, ERD-E15, ERD-E23

BEGIN;

DROP FUNCTION IF EXISTS public.confirm_customer_email_change(TEXT);

-- Restore original immutability guard
CREATE OR REPLACE FUNCTION public.trg_customers_immutability_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Customer identities are permanent and cannot be deleted';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id THEN
      RAISE EXCEPTION 'Customer id is immutable';
    END IF;
    IF NEW.customer_code <> OLD.customer_code THEN
      RAISE EXCEPTION 'Customer code is immutable';
    END IF;
    IF NEW.email <> OLD.email THEN
      RAISE EXCEPTION 'Customer email is immutable';
    END IF;
    IF NEW.first_confirmed_reservation_id <> OLD.first_confirmed_reservation_id THEN
      RAISE EXCEPTION 'first_confirmed_reservation_id is immutable';
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TABLE IF EXISTS public.customer_email_change_requests CASCADE;
DROP TABLE IF EXISTS public.customer_email_change_otps CASCADE;

-- Revert rate_limit_events_scope_check constraint and function
ALTER TABLE public.rate_limit_events DROP CONSTRAINT IF EXISTS rate_limit_events_scope_check;
ALTER TABLE public.rate_limit_events ADD CONSTRAINT rate_limit_events_scope_check CHECK (scope IN (
  'VERIFY_IP','VERIFY_EMAIL','CUSTOMER_TOKEN','ASSISTANT_TOKEN','PROMO_IP','PROMO_EMAIL','EMAIL_CUSTOMER','EMAIL_VOUCHER',
  'PUBLIC_ASSISTANT_IP','PUBLIC_ASSISTANT_VISITOR','CUSTOMER_ID_RECOVERY'
));

CREATE OR REPLACE FUNCTION public.consume_customer_access_limits(p_entries jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e jsonb; t timestamptz:=clock_timestamp(); n integer; oldest timestamptz; seconds integer;
BEGIN
  IF jsonb_typeof(p_entries)<>'array' OR jsonb_array_length(p_entries) NOT BETWEEN 1 AND 8 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_entries)) <> (SELECT count(DISTINCT (v->>'scope',v->>'subjectHash')) FROM jsonb_array_elements(p_entries) v) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(p_entries) ORDER BY value->>'scope',value->>'subjectHash' LOOP
    IF e->>'subjectHash' IS NULL OR e->>'subjectHash' !~ '^[a-f0-9]{64}$'
      OR e->>'scope' NOT IN ('VERIFY_IP','VERIFY_EMAIL','CUSTOMER_TOKEN','ASSISTANT_TOKEN','PROMO_IP','PROMO_EMAIL','EMAIL_CUSTOMER','EMAIL_VOUCHER','CUSTOMER_ID_RECOVERY')
      OR (e->>'limit')::int NOT BETWEEN 1 AND 100 OR (e->>'windowSeconds')::int NOT BETWEEN 1 AND 86400
    THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('access-limit:'||(e->>'scope')||':'||(e->>'subjectHash'),0));
  END LOOP;
  FOR e IN SELECT value FROM jsonb_array_elements(p_entries) LOOP
    seconds:=(e->>'windowSeconds')::int;
    SELECT count(*), min(created_at) INTO n,oldest FROM rate_limit_events
      WHERE scope=e->>'scope' AND subject_hash=e->>'subjectHash' AND created_at>t-make_interval(secs=>seconds);
    IF n >= (e->>'limit')::int THEN RETURN jsonb_build_object('allowed',false,'retryAfterSeconds',greatest(1,ceil(extract(epoch FROM oldest+make_interval(secs=>seconds)-t)))); END IF;
  END LOOP;
  INSERT INTO rate_limit_events(scope,subject_hash,created_at) SELECT v->>'scope',v->>'subjectHash',t FROM jsonb_array_elements(p_entries) v;
  RETURN jsonb_build_object('allowed',true);
END $$;

REVOKE ALL ON FUNCTION public.consume_customer_access_limits(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_customer_access_limits(jsonb) TO service_role;

COMMIT;

