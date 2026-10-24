-- Restore exact installed search implementations; no document changes.
BEGIN;
DROP FUNCTION public.assistant_knowledge_status(uuid,text,text);
DROP FUNCTION IF EXISTS public.customer_knowledge_status(uuid,text,text,text);
DO $migration$
DECLARE f record; args text; original text;
BEGIN
 FOR f IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('assistant_search_hybrid_io_baseline','customer_search_hybrid_io_baseline')
 LOOP
  args:=pg_get_function_identity_arguments(f.oid); original:=replace(f.proname,'_io_baseline','');
  EXECUTE 'DROP FUNCTION public.'||original||'('||args||')';
  EXECUTE 'ALTER FUNCTION public.'||f.proname||'('||args||') RENAME TO '||original;
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.'||original||'('||args||') TO service_role';
 END LOOP;
END $migration$;
COMMIT;
