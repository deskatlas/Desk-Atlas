-- MS76-TC10: preserve incompatible retained data, including removed artifacts.
BEGIN;
DO $migration$
BEGIN
 IF EXISTS(SELECT 1 FROM kb_documents WHERE audience IN ('PUBLIC_CUSTOMER','VERIFIED_CUSTOMER'))
  OR EXISTS(SELECT 1 FROM kb_document_versions WHERE upload_intent->>'audience' IN ('PUBLIC_CUSTOMER','VERIFIED_CUSTOMER')
   OR system_verification->>'audience' IN ('PUBLIC_CUSTOMER','VERIFIED_CUSTOMER')
   OR document_review_identity->>'audience' IN ('PUBLIC_CUSTOMER','VERIFIED_CUSTOMER'))
  OR EXISTS(SELECT 1 FROM customer_access_challenges WHERE purpose='REWARDS_AND_ASSISTANT_ACCESS')
  OR EXISTS(SELECT 1 FROM customer_assistant_controls WHERE permit_until>clock_timestamp() AND NOT cancelled AND stage<>'complete')
 THEN RAISE EXCEPTION 'MS76_INCOMPATIBLE_DATA'; END IF;
END $migration$;
DROP FUNCTION customer_assistant_control(text,text,text,text,uuid,uuid,uuid,text);
DROP TABLE customer_assistant_controls;
DO $migration$
DECLARE f record; definition text; principal text;
BEGIN
 FOR f IN SELECT p.oid,p.proname,pg_get_function_identity_arguments(p.oid) args FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('customer_knowledge_availability','customer_search_knowledge','customer_search_hybrid','customer_read_source','customer_document_evidence')
 LOOP EXECUTE 'DROP FUNCTION public.'||f.proname||'('||f.args||')'; END LOOP;
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
  AND (p.proname LIKE 'kb_admin_command%' OR p.proname LIKE 'kb_worker_command%' OR p.proname='kb_try_auto_publish' OR p.proname LIKE 'assistant_%' OR p.proname='kb_search')
 LOOP
  definition:=pg_get_functiondef(f.oid);
  definition:=replace(definition,'((a.role=''ADMIN'' AND d.audience=''ADMIN_ONLY'') OR (a.role IN (''ADMIN'',''STAFF'') AND d.audience=''ADMIN_AND_STAFF''))',
   '(a.role=''ADMIN'' OR (a.role=''STAFF'' AND d.audience=''ADMIN_AND_STAFF''))');
  definition:=replace(definition,'''ADMIN_ONLY'',''ADMIN_AND_STAFF'',''PUBLIC_CUSTOMER'',''VERIFIED_CUSTOMER''','''ADMIN_ONLY'',''ADMIN_AND_STAFF''');
  FOREACH principal IN ARRAY ARRAY['v_role','role_name','actor_role'] LOOP
   definition:=replace(definition,'(('||principal||'=''ADMIN'' AND d.audience=''ADMIN_ONLY'') OR ('||principal||' IN (''ADMIN'',''STAFF'') AND d.audience=''ADMIN_AND_STAFF''))',
    '('||principal||'=''ADMIN'' OR d.audience=''ADMIN_AND_STAFF'')');
  END LOOP;
  EXECUTE definition;
 END LOOP;
END $migration$;
DROP FUNCTION kb_customer_version_valid(uuid,text);
ALTER TABLE kb_documents DROP CONSTRAINT kb_documents_audience_check;
ALTER TABLE kb_documents ADD CONSTRAINT kb_documents_audience_check CHECK(audience IN ('ADMIN_ONLY','ADMIN_AND_STAFF'));
ALTER TABLE customer_access_challenges DROP CONSTRAINT customer_access_challenges_purpose_check;
ALTER TABLE customer_access_challenges ADD CONSTRAINT customer_access_challenges_purpose_check CHECK(purpose='REWARDS_ACCESS');
COMMIT;
