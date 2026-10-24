-- PRD-F26/F27 / SDD-C20/C21 / QAD-TC44-46: verify each version once per reader.
-- The complete kb_customer_version_valid check remains mandatory and unchanged.
BEGIN;
DO $migration$
DECLARE f record; definition text; args text; cut integer; tail integer; helper text; touched integer:=0;
BEGIN
 helper:=pg_get_functiondef('public.kb_customer_version_valid(uuid,text)'::regprocedure);
 IF strpos(helper,'count(*)=v.expected_chunk_count')=0 OR strpos(helper,'c.embedding_fingerprint=p_fingerprint')=0
  OR strpos(helper,'min(c.ordinal)=0')=0 OR strpos(helper,'max(c.ordinal)=v.expected_chunk_count-1')=0
  OR strpos(helper,'c.content_sha256=encode(digest(convert_to(c.content')=0
  OR strpos(helper,'v.manifest_sha256=encode(digest')=0 THEN
  RAISE EXCEPTION 'UNEXPECTED_COMPLETE_VERIFIER'; END IF;
 FOR f IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('customer_knowledge_availability','customer_search_hybrid')
 LOOP
  touched:=touched+1;
  definition:=pg_get_functiondef(f.oid); args:=pg_get_function_identity_arguments(f.oid);
  IF strpos(definition,'kb_customer_version_valid(v.id,p_fingerprint) AND')=0 THEN
   RAISE EXCEPTION 'MISSING_COMPLETE_VERIFIER: %',f.proname; END IF;
  IF f.proname='customer_knowledge_availability' THEN
   cut:=strpos(definition,'   AND (SELECT count(*) FROM kb_chunks c WHERE c.version_id=v.id');
   tail:=strpos(definition,' ) INTO v_enabled;');
  ELSE
   cut:=strpos(definition,'   AND (SELECT count(*)=v.expected_chunk_count');
   tail:=strpos(definition,' ), eligible AS MATERIALIZED (');
  END IF;
  IF cut=0 OR tail<=cut THEN RAISE EXCEPTION 'UNEXPECTED_READER: %',f.proname; END IF;
  EXECUTE 'ALTER FUNCTION public.'||f.proname||'('||args||') RENAME TO '||f.proname||'_verification_baseline';
  EXECUTE 'REVOKE ALL ON FUNCTION public.'||f.proname||'_verification_baseline('||args||') FROM PUBLIC,anon,authenticated,service_role';
  definition:=left(definition,cut-1)||substring(definition FROM tail);
  EXECUTE definition;
  EXECUTE 'REVOKE ALL ON FUNCTION public.'||f.proname||'('||args||') FROM PUBLIC,anon,authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.'||f.proname||'('||args||') TO service_role';
 END LOOP;
 IF touched<>2 THEN RAISE EXCEPTION 'MISSING_CUSTOMER_READERS'; END IF;
END $migration$;
COMMIT;
