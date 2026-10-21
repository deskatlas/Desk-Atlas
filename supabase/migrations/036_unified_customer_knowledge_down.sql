-- Disable customer entry points and drain workers before rollback.
BEGIN;
DO $migration$
DECLARE f record; definition text;
BEGIN
 IF EXISTS(SELECT 1 FROM kb_documents WHERE audience='CUSTOMER')
  OR EXISTS(SELECT 1 FROM kb_document_versions WHERE upload_intent->>'audience'='CUSTOMER'
   OR system_verification->>'audience'='CUSTOMER' OR document_review_identity->>'audience'='CUSTOMER')
 THEN RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_REQUIRES_EXPLICIT_RECLASSIFICATION'; END IF;
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND (p.proname LIKE 'kb_admin_command%' OR p.proname LIKE 'kb_worker_command%'
   OR p.proname='kb_try_auto_publish' OR p.proname IN ('customer_knowledge_availability','customer_search_knowledge',
    'customer_search_hybrid','customer_read_source','customer_document_evidence'))
 LOOP
  definition:=pg_get_functiondef(f.oid);
  definition:=replace(definition,'''ADMIN_ONLY'',''ADMIN_AND_STAFF'',''CUSTOMER''',
    '''ADMIN_ONLY'',''ADMIN_AND_STAFF'',''PUBLIC_CUSTOMER'',''VERIFIED_CUSTOMER''');
  definition:=replace(definition,'''CUSTOMER''','''PUBLIC_CUSTOMER''');
  EXECUTE definition;
 END LOOP;
 UPDATE public.kb_catalog SET epoch=epoch+1,updated_at=now();
END $migration$;
ALTER TABLE public.kb_documents DROP CONSTRAINT kb_documents_audience_check;
ALTER TABLE public.kb_documents ADD CONSTRAINT kb_documents_audience_check
 CHECK(audience IN ('ADMIN_ONLY','ADMIN_AND_STAFF','PUBLIC_CUSTOMER','VERIFIED_CUSTOMER'));
COMMIT;
