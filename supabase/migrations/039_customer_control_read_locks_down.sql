BEGIN;
DO $migration$
DECLARE f record; args text; original text;
BEGIN
 FOR f IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('customer_assistant_control_io_baseline','customer_assistant_control_ms76_io_baseline')
 LOOP
  args:=pg_get_function_identity_arguments(f.oid); original:=replace(f.proname,'_io_baseline','');
  EXECUTE 'DROP FUNCTION public.'||original||'('||args||')';
  EXECUTE 'ALTER FUNCTION public.'||f.proname||'('||args||') RENAME TO '||original;
  IF original='customer_assistant_control' THEN
   EXECUTE 'GRANT EXECUTE ON FUNCTION public.'||original||'('||args||') TO service_role'; END IF;
 END LOOP;
END $migration$;
COMMIT;
