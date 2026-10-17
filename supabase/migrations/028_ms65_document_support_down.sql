-- MS65 rollback refuses to expose new-contract artifacts through old readers.
BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM kb_document_versions WHERE support_contract='ms65-v1' AND status='PUBLISHED')
  OR EXISTS(SELECT 1 FROM kb_document_versions WHERE repair_of IS NOT NULL AND status IN ('UPLOADING','QUEUED','PROCESSING'))
 THEN RAISE EXCEPTION 'ACTIVE_SUPPORT_CONTRACT: retain compatible readers until new artifacts are withdrawn or replaced'; END IF;
END $$;
DROP FUNCTION kb_evidence_repairs(text,uuid,uuid),kb_begin_evidence_repair(text,uuid,uuid,bigint,uuid),kb_finalize_evidence_repair(text,uuid,uuid,text,bigint),assistant_document_evidence(uuid,text,text,uuid[]);
DROP FUNCTION kb_worker_command(text,text,uuid,jsonb),assistant_expand_evidence(uuid,text,text,uuid[]),assistant_expand_evidence_v3(uuid,text,text,uuid[]);
ALTER FUNCTION kb_worker_command_ms64(text,text,uuid,jsonb) RENAME TO kb_worker_command;
ALTER FUNCTION assistant_expand_evidence_ms64(uuid,text,text,uuid[]) RENAME TO assistant_expand_evidence;
ALTER FUNCTION assistant_expand_evidence_v3_ms64(uuid,text,text,uuid[]) RENAME TO assistant_expand_evidence_v3;
GRANT EXECUTE ON FUNCTION kb_worker_command(text,text,uuid,jsonb),assistant_expand_evidence(uuid,text,text,uuid[]),assistant_expand_evidence_v3(uuid,text,text,uuid[]) TO service_role;
-- Keep additive provenance/repair columns for historical audit and recovery.
COMMIT;
