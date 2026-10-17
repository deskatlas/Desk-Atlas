-- MS59: never strand an active successor. Withdraw/transition through review first.
BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM kb_document_versions v JOIN kb_documents d ON d.active_version_id=v.id WHERE v.evidence_roles IS NOT NULL AND d.deleted_at IS NULL) THEN RAISE EXCEPTION 'ACTIVE_EVIDENCE_CONTRACT'; END IF;
END $$;
DROP FUNCTION public.assistant_evidence_costs(uuid,text,text,uuid[]);
DROP FUNCTION public.assistant_expand_evidence_v3(uuid,text,text,uuid[]);
DROP FUNCTION public.assistant_project_evidence(uuid,text,text,uuid[]);
DROP FUNCTION public.assistant_evidence_graph_ms59(uuid,text,text,uuid[]);
DROP FUNCTION public.kb_admin_command(text,uuid,text,uuid,jsonb);
ALTER FUNCTION public.kb_admin_command_ms58(text,uuid,text,uuid,jsonb) RENAME TO kb_admin_command;
GRANT EXECUTE ON FUNCTION public.kb_admin_command(text,uuid,text,uuid,jsonb) TO service_role;
ALTER TABLE public.kb_document_versions DROP COLUMN evidence_roles;
ALTER TABLE public.kb_document_versions DROP COLUMN evidence_binding;
COMMIT;
