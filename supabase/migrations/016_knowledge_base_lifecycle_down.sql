-- Disable KB gateways and workers first. Export required metadata before rollback.
-- Does not delete shared extensions, booking data, or storage objects.
BEGIN;
DROP FUNCTION IF EXISTS public.kb_search(text,uuid,extensions.vector,integer,uuid);
DROP FUNCTION IF EXISTS public.kb_worker_command(text,text,uuid,jsonb);
DROP FUNCTION IF EXISTS public.kb_admin_command(text,uuid,text,uuid,jsonb);
DROP FUNCTION IF EXISTS public.kb_initialize_catalog(text,text);
DROP FUNCTION IF EXISTS public.kb_reconcile_uploads(text,integer);
DROP TABLE public.kb_notifications,public.kb_jobs;
DROP INDEX IF EXISTS public.kb_admin_request;
DROP INDEX IF EXISTS public.kb_upload_request;
DROP INDEX IF EXISTS public.kb_one_published;
ALTER TABLE public.kb_document_versions DROP COLUMN request_id,DROP COLUMN expected_revision;
-- Purge objects through the Storage API before removing the private bucket.
DELETE FROM storage.buckets WHERE id='knowledge-base' AND NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='knowledge-base');
COMMIT;
