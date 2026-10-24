-- PRD-F26/F27 / SDD-C20/C24 / QAD-TC44/46: preserve cancellation and leases.
BEGIN;
DO $migration$
DECLARE f record; definition text; args text; touched integer:=0;
 implementations integer; body_variants integer; signature_variants integer;
 original text := $body$  SELECT * INTO r FROM customer_assistant_controls WHERE request_id=p_request AND session_id=p_session AND generation=p_generation
   AND scope_id=p_scope AND principal=p_principal AND subject_digest=p_subject AND deadline>t FOR UPDATE;$body$;
BEGIN
 -- Some installed databases have the full implementation under both names.
 -- Accept that case only when both bodies and argument types are identical.
 -- Preserve the installed behavior rather than replacing either with a wrapper.
 SELECT count(*),count(DISTINCT p.prosrc),count(DISTINCT p.proargtypes::text)
 INTO implementations,body_variants,signature_variants
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public'
  AND p.proname IN ('customer_assistant_control','customer_assistant_control_ms76')
  AND strpos(p.prosrc,original)>0;
 IF implementations NOT IN (1,2)
  OR (implementations=2 AND (body_variants<>1 OR signature_variants<>1)) THEN
  RAISE EXCEPTION 'UNEXPECTED_CONTROL_IMPLEMENTATION'; END IF;
 FOR f IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('customer_assistant_control','customer_assistant_control_ms76')
 LOOP
  definition:=pg_get_functiondef(f.oid);
  IF strpos(definition,original)=0 THEN CONTINUE; END IF;
  touched:=touched+1; args:=pg_get_function_identity_arguments(f.oid);
  EXECUTE 'ALTER FUNCTION public.'||f.proname||'('||args||') RENAME TO '||f.proname||'_io_baseline';
  EXECUTE 'REVOKE ALL ON FUNCTION public.'||f.proname||'_io_baseline('||args||') FROM PUBLIC,anon,authenticated,service_role';
  definition:=replace(definition,original,
   '  IF p_operation IN (''check'',''progress'') THEN '||replace(original,' FOR UPDATE;',';')||
   ' ELSE '||original||' END IF;');
  EXECUTE definition;
  EXECUTE 'REVOKE ALL ON FUNCTION public.'||f.proname||'('||args||') FROM PUBLIC,anon,authenticated,service_role';
  -- Only the public wrapper is directly executable by the verified gateway.
  IF f.proname='customer_assistant_control' THEN
   EXECUTE 'GRANT EXECUTE ON FUNCTION public.'||f.proname||'('||args||') TO service_role'; END IF;
 END LOOP;
 IF touched<>implementations THEN RAISE EXCEPTION 'UNEXPECTED_CONTROL_IMPLEMENTATION'; END IF;
END $migration$;
COMMIT;
