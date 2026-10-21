-- Maintainer amendment, October 21: PRD-F26/F27, SDD-C20-C24, ERD-E24-E29.
-- Shared general knowledge is CUSTOMER; private booking authority is unchanged.
BEGIN;
ALTER TABLE public.kb_documents DROP CONSTRAINT kb_documents_audience_check;
UPDATE public.kb_documents SET audience='CUSTOMER', revision=revision+1, updated_at=now()
 WHERE audience IN ('PUBLIC_CUSTOMER','VERIFIED_CUSTOMER');
UPDATE public.kb_document_versions SET
 upload_intent=CASE WHEN upload_intent->>'audience' IN ('PUBLIC_CUSTOMER','VERIFIED_CUSTOMER') THEN jsonb_set(upload_intent,'{audience}','"CUSTOMER"') ELSE upload_intent END,
 system_verification=CASE WHEN system_verification->>'audience' IN ('PUBLIC_CUSTOMER','VERIFIED_CUSTOMER') THEN jsonb_set(system_verification,'{audience}','"CUSTOMER"') ELSE system_verification END,
 document_review_identity=CASE WHEN document_review_identity->>'audience' IN ('PUBLIC_CUSTOMER','VERIFIED_CUSTOMER') THEN jsonb_set(document_review_identity,'{audience}','"CUSTOMER"') ELSE document_review_identity END
 WHERE upload_intent->>'audience' IN ('PUBLIC_CUSTOMER','VERIFIED_CUSTOMER')
 OR system_verification->>'audience' IN ('PUBLIC_CUSTOMER','VERIFIED_CUSTOMER')
 OR document_review_identity->>'audience' IN ('PUBLIC_CUSTOMER','VERIFIED_CUSTOMER');
ALTER TABLE public.kb_documents ADD CONSTRAINT kb_documents_audience_check
 CHECK(audience IN ('ADMIN_ONLY','ADMIN_AND_STAFF','CUSTOMER'));
DO $migration$
DECLARE f record; definition text;
BEGIN
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND (p.proname LIKE 'kb_admin_command%' OR p.proname LIKE 'kb_worker_command%'
   OR p.proname='kb_try_auto_publish' OR p.proname IN ('customer_knowledge_availability','customer_search_knowledge',
     'customer_search_hybrid','customer_read_source','customer_document_evidence'))
 LOOP
  definition:=pg_get_functiondef(f.oid);
  definition:=replace(definition,'''ADMIN_ONLY'',''ADMIN_AND_STAFF'',''PUBLIC_CUSTOMER'',''VERIFIED_CUSTOMER''',
    '''ADMIN_ONLY'',''ADMIN_AND_STAFF'',''CUSTOMER''');
  definition:=replace(definition,'''PUBLIC_CUSTOMER''','''CUSTOMER''');
  EXECUTE definition;
 END LOOP;
 -- Existing triggers invalidate document and version changes; also fence empty catalogs.
 UPDATE public.kb_catalog SET epoch=epoch+1,updated_at=now();
END $migration$;
COMMIT;
