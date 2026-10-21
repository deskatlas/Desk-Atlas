-- MS78-R01 / SPEC-3 / ERD-E23: shared atomic hashed verification and token quotas.
BEGIN;
ALTER TABLE public.rate_limit_events DROP CONSTRAINT rate_limit_events_scope_check;
ALTER TABLE public.rate_limit_events ADD CONSTRAINT rate_limit_events_scope_check CHECK (scope IN (
 'VERIFY_IP','VERIFY_EMAIL','CUSTOMER_TOKEN','ASSISTANT_TOKEN','PROMO_IP','PROMO_EMAIL','EMAIL_CUSTOMER','EMAIL_VOUCHER',
 'PUBLIC_ASSISTANT_IP','PUBLIC_ASSISTANT_VISITOR'));
CREATE FUNCTION public.consume_customer_access_limits(p_entries jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e jsonb; t timestamptz:=clock_timestamp(); n integer; oldest timestamptz; seconds integer;
BEGIN
 IF jsonb_typeof(p_entries)<>'array' OR jsonb_array_length(p_entries) NOT BETWEEN 1 AND 8 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(p_entries)) <> (SELECT count(DISTINCT (v->>'scope',v->>'subjectHash')) FROM jsonb_array_elements(p_entries) v) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 FOR e IN SELECT value FROM jsonb_array_elements(p_entries) ORDER BY value->>'scope',value->>'subjectHash' LOOP
  IF e->>'subjectHash' IS NULL OR e->>'subjectHash' !~ '^[a-f0-9]{64}$'
   OR e->>'scope' NOT IN ('VERIFY_IP','VERIFY_EMAIL','CUSTOMER_TOKEN','ASSISTANT_TOKEN','PROMO_IP','PROMO_EMAIL','EMAIL_CUSTOMER','EMAIL_VOUCHER')
   OR (e->>'limit')::int NOT BETWEEN 1 AND 100 OR (e->>'windowSeconds')::int NOT BETWEEN 1 AND 3600
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
