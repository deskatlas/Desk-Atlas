BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.kb_embedding_runs WHERE status='COMMITTED') THEN
  RAISE EXCEPTION 'ROLLBACK_ACTIVE_EMBEDDING_RUN_FIRST'; END IF;
END $$;
DROP FUNCTION public.kb_embedding_maintenance(text,text,uuid,jsonb);
DROP TABLE public.kb_embedding_shadows;
DROP TABLE public.kb_embedding_runs;
COMMIT;
