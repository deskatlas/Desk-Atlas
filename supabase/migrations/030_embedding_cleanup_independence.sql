-- PRD-F26/F27 / SDD-C21/C23/C24 / QAD-TC45:
-- Cleanup of revoked files must not block active-corpus embedding migration.
-- Keep ingestion/version guards, table locks and complete corpus/epoch checks.
BEGIN;
DO $$
DECLARE definition text; old_clause text; new_clause text;
BEGIN
 old_clause := 'WHERE d.scope_id=p_scope
     AND j.status IN (''QUEUED'',''RUNNING'',''RETRY''))';
 new_clause := 'WHERE d.scope_id=p_scope
     AND j.kind=''INGEST'' AND j.status IN (''QUEUED'',''RUNNING'',''RETRY''))';
 definition := pg_get_functiondef('public.kb_embedding_maintenance(text,text,uuid,jsonb)'::regprocedure);
 IF (length(definition)-length(replace(definition,old_clause,'')))/length(old_clause) <> 2 THEN
  RAISE EXCEPTION 'UNEXPECTED_EMBEDDING_MAINTENANCE_DEFINITION';
 END IF;
 EXECUTE replace(definition,old_clause,new_clause);
END $$;
COMMIT;
