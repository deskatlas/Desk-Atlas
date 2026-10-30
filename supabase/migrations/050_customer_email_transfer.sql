-- Migration: 050_customer_email_transfer.sql
-- Description: Customer Identity Email Binding Transfer, Two-Factor OTP Verification, and Dual-Address Confirmation Lifecycle (MS-98)
-- Traceability: MS-98, PRD-F4, PRD-F14, PRD-F22, SDD-C1, SDD-C13, SDD-C15, ERD-E15, ERD-E18, ERD-E21, ERD-E23, QAD-TC22, QAD-TC36

BEGIN;

-- 1. Temporary OTP Verification Storage (ERD-E23)
CREATE TABLE IF NOT EXISTS public.customer_email_change_otps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  current_email TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  consumed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_otp_expiry_valid CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_customer_email_otps_lookup
  ON public.customer_email_change_otps (current_email, created_at DESC)
  WHERE consumed_at IS NULL;

ALTER TABLE public.customer_email_change_otps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_email_change_otps FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.customer_email_change_otps TO service_role;

-- 2. Pending Email Change Requests Table (ERD-E15, ERD-E23)
CREATE TABLE IF NOT EXISTS public.customer_email_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  old_email TEXT NOT NULL,
  new_email TEXT NOT NULL,
  confirmation_token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  confirmed_at TIMESTAMPTZ NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'EXPIRED', 'CANCELLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_new_email_format CHECK (
    new_email = lower(btrim(new_email)) AND length(new_email) <= 254 AND
    new_email ~* '^[a-zA-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$'
  ),
  CONSTRAINT chk_distinct_emails CHECK (new_email <> old_email)
);

CREATE INDEX IF NOT EXISTS idx_customer_email_requests_token
  ON public.customer_email_change_requests (confirmation_token_hash)
  WHERE status = 'PENDING';

ALTER TABLE public.customer_email_change_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_email_change_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.customer_email_change_requests TO service_role;

-- 3. Update rate_limit_events check constraint and consume function
ALTER TABLE public.rate_limit_events DROP CONSTRAINT IF EXISTS rate_limit_events_scope_check;
ALTER TABLE public.rate_limit_events ADD CONSTRAINT rate_limit_events_scope_check CHECK (scope IN (
  'VERIFY_IP','VERIFY_EMAIL','CUSTOMER_TOKEN','ASSISTANT_TOKEN','PROMO_IP','PROMO_EMAIL','EMAIL_CUSTOMER','EMAIL_VOUCHER',
  'PUBLIC_ASSISTANT_IP','PUBLIC_ASSISTANT_VISITOR','CUSTOMER_ID_RECOVERY',
  'EMAIL_CHANGE_OTP','EMAIL_CHANGE_VERIFY','EMAIL_CHANGE_INITIATE'
));

CREATE OR REPLACE FUNCTION public.consume_customer_access_limits(p_entries jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e jsonb; t timestamptz:=clock_timestamp(); n integer; oldest timestamptz; seconds integer;
BEGIN
  IF jsonb_typeof(p_entries)<>'array' OR jsonb_array_length(p_entries) NOT BETWEEN 1 AND 8 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_entries)) <> (SELECT count(DISTINCT (v->>'scope',v->>'subjectHash')) FROM jsonb_array_elements(p_entries) v) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(p_entries) ORDER BY value->>'scope',value->>'subjectHash' LOOP
    IF e->>'subjectHash' IS NULL OR e->>'subjectHash' !~ '^[a-f0-9]{64}$'
      OR e->>'scope' NOT IN ('VERIFY_IP','VERIFY_EMAIL','CUSTOMER_TOKEN','ASSISTANT_TOKEN','PROMO_IP','PROMO_EMAIL','EMAIL_CUSTOMER','EMAIL_VOUCHER','CUSTOMER_ID_RECOVERY','EMAIL_CHANGE_OTP','EMAIL_CHANGE_VERIFY','EMAIL_CHANGE_INITIATE')
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

-- 4. Adjust Customer Immutability Trigger
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
    IF NEW.first_confirmed_reservation_id <> OLD.first_confirmed_reservation_id THEN
      RAISE EXCEPTION 'first_confirmed_reservation_id is immutable';
    END IF;

    -- Check if email mutation is explicitly authorized via session configuration
    IF NEW.email <> OLD.email THEN
      IF current_setting('deskatlas.allow_customer_email_mutation', true) IS DISTINCT FROM 'authorized' THEN
        RAISE EXCEPTION 'Customer email is immutable except through authorized transfer flow';
      END IF;
    END IF;

    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

-- 5. Atomic Email Confirmation Stored Function
CREATE OR REPLACE FUNCTION public.confirm_customer_email_change(
  p_token_hash TEXT
)
RETURNS TABLE (
  success BOOLEAN,
  customer_id UUID,
  customer_code TEXT,
  old_email TEXT,
  new_email TEXT,
  error_code TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_request RECORD;
  v_collision UUID;
  v_customer RECORD;
BEGIN
  -- 1. Locate pending request
  SELECT req.* INTO v_request
  FROM public.customer_email_change_requests req
  WHERE req.confirmation_token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, 'TOKEN_NOT_FOUND'::TEXT;
    RETURN;
  END IF;

  IF v_request.status <> 'PENDING' THEN
    RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, 'ALREADY_PROCESSED'::TEXT;
    RETURN;
  END IF;

  IF v_request.expires_at < now() THEN
    UPDATE public.customer_email_change_requests req SET status = 'EXPIRED' WHERE req.id = v_request.id;
    RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, 'TOKEN_EXPIRED'::TEXT;
    RETURN;
  END IF;

  -- 2. Verify target email is still uncollided
  SELECT cust.id INTO v_collision
  FROM public.customers cust
  WHERE cust.email = v_request.new_email;

  IF v_collision IS NOT NULL THEN
    RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, 'EMAIL_COLLISION'::TEXT;
    RETURN;
  END IF;

  -- 3. Fetch customer details
  SELECT cust.id, cust.customer_code INTO v_customer
  FROM public.customers cust
  WHERE cust.id = v_request.customer_id;

  -- 4. Enable session authorization flag and mutate customer email
  PERFORM set_config('deskatlas.allow_customer_email_mutation', 'authorized', true);

  UPDATE public.customers cust
  SET email = v_request.new_email,
      updated_at = now()
  WHERE cust.id = v_request.customer_id;

  -- Reset session flag
  PERFORM set_config('deskatlas.allow_customer_email_mutation', '', true);

  -- 5. Mark request confirmed
  UPDATE public.customer_email_change_requests req
  SET status = 'CONFIRMED',
      confirmed_at = now()
  WHERE req.id = v_request.id;

  -- 6. Update reservations customer_email to preserve search indexing
  UPDATE public.reservations res
  SET customer_email = v_request.new_email
  WHERE res.customer_id = v_request.customer_id;

  RETURN QUERY SELECT true, v_customer.id, v_customer.customer_code, v_request.old_email, v_request.new_email, NULL::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_customer_email_change(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_customer_email_change(TEXT) TO service_role;

COMMIT;

