-- PRD-F26/F27, SDD-C20/C21/C24, ERD-E24-E29, QAD-TC44-TC46.
-- Preserve installed audience amendments and complete answer-time verification.
BEGIN;
DO $migration$
DECLARE f record; definition text; signature text; args text; cut integer; tail integer;
 old_item text := $item$jsonb_build_object('document_id',v.did,'version_id',v.id,'chunk_id',c.id,'title',v.title,'heading_path',c.heading_path,
    'source_page',c.page_start,'epoch',v.epoch,'extraction_method',c.extraction_method,'content_hash',c.content_sha256,'content',c.content) item$item$;
 payload text := $item$jsonb_build_object('document_id',v.did,'version_id',v.id,'chunk_id',c.id,'title',v.title,'heading_path',c.heading_path,
    'source_page',c.page_start,'epoch',v.epoch,'extraction_method',c.extraction_method,'content_hash',c.content_sha256,'content',c.content)$item$;
BEGIN
 FOR f IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('assistant_knowledge_availability','customer_knowledge_availability')
 LOOP
  definition:=pg_get_functiondef(f.oid);
  args:=pg_get_function_identity_arguments(f.oid);
  cut:=strpos(definition,'   AND (SELECT count(*) FROM kb_chunks c WHERE c.version_id=v.id');
  tail:=strpos(definition,' ) INTO v_enabled;');
  IF cut=0 OR tail<=cut THEN RAISE EXCEPTION 'UNEXPECTED_AVAILABILITY_DEFINITION: %',f.proname; END IF;
  definition:=left(definition,cut-1)||substring(definition FROM tail);
  -- Customer clones inject the same full verification helper; UI status alone
  -- may skip it. Original availability/search/evidence RPCs remain unchanged.
  definition:=replace(definition,'kb_customer_version_valid(v.id,p_fingerprint) AND ','');
  definition:=replace(definition,'FUNCTION public.'||f.proname||'(',
   'FUNCTION public.'||replace(f.proname,'_availability','_status')||'(');
  EXECUTE definition;
  signature:='public.'||replace(f.proname,'_availability','_status')||'('||args||')';
  EXECUTE 'REVOKE ALL ON FUNCTION '||signature||' FROM PUBLIC,anon,authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION '||signature||' TO service_role';
 END LOOP;
 IF to_regprocedure('public.assistant_knowledge_status(uuid,text,text)') IS NULL THEN
  RAISE EXCEPTION 'MISSING_ASSISTANT_STATUS'; END IF;

 FOR f IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('assistant_search_hybrid','customer_search_hybrid')
 LOOP
  definition:=pg_get_functiondef(f.oid); args:=pg_get_function_identity_arguments(f.oid);
  IF strpos(definition,old_item)=0 OR strpos(definition,'SELECT e.item,e.id')=0
   OR strpos(definition,'LIMIT 12) s) semantic')=0 OR strpos(definition,'LIMIT 12) l) lexical')=0 THEN
   RAISE EXCEPTION 'UNEXPECTED_HYBRID_DEFINITION: %',f.proname; END IF;
  -- Save the exact installed implementation for transactional rollback.
  EXECUTE 'ALTER FUNCTION public.'||f.proname||'('||args||') RENAME TO '||f.proname||'_io_baseline';
  EXECUTE 'REVOKE ALL ON FUNCTION public.'||f.proname||'_io_baseline('||args||') FROM PUBLIC,anon,authenticated,service_role';
  definition:=replace(definition,'SELECT v.*,d.title,d.id did,k.epoch','SELECT v.id,v.generation,d.title,d.id did,k.epoch');
  definition:=replace(definition,old_item,'c.version_id');
  definition:=replace(definition,'SELECT e.item,e.id','SELECT e.id');
  definition:=replace(definition,'jsonb_agg(s.item ORDER BY','jsonb_agg('||payload||' ORDER BY');
  definition:=replace(definition,'jsonb_agg(l.item ORDER BY','jsonb_agg('||payload||' ORDER BY');
  definition:=replace(definition,'LIMIT 12) s) semantic',
   'LIMIT 12) s JOIN kb_chunks c ON c.id=s.id JOIN versions v ON v.id=c.version_id) semantic');
  definition:=replace(definition,'LIMIT 12) l) lexical',
   'LIMIT 12) l JOIN kb_chunks c ON c.id=l.id JOIN versions v ON v.id=c.version_id) lexical');
  EXECUTE definition;
  signature:='public.'||f.proname||'('||args||')';
  EXECUTE 'REVOKE ALL ON FUNCTION '||signature||' FROM PUBLIC,anon,authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION '||signature||' TO service_role';
 END LOOP;
END $migration$;
COMMIT;
