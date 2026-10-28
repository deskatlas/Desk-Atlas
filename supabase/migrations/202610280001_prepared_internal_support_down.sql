-- PRD-F26,F27 / ERD-E25,E27: canonical sources/publication are unchanged.
BEGIN;
DROP TRIGGER kb_queue_support_preparation ON kb_document_versions;
DROP FUNCTION kb_queue_support_preparation();
DROP FUNCTION assistant_prepared_evidence(uuid,text,text,jsonb,text),assistant_prepared_catalog(uuid,text,text,text),kb_support_command(text,text,uuid,jsonb);
DROP TABLE kb_support_artifacts,kb_support_jobs;
COMMIT;
