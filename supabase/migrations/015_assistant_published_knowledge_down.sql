BEGIN;
DROP FUNCTION IF EXISTS public.assistant_search_knowledge(uuid,text,text,extensions.vector,double precision);
DROP FUNCTION IF EXISTS public.assistant_read_source(uuid,text,text,uuid,uuid);
ALTER TABLE public.kb_documents DROP CONSTRAINT IF EXISTS kb_document_active_version_fk;
DROP TABLE IF EXISTS public.kb_chunks, public.kb_document_versions, public.kb_documents, public.kb_catalog;
DROP FUNCTION IF EXISTS public.assistant_knowledge_epoch();
-- The shared vector extension is deliberately retained.
COMMIT;
