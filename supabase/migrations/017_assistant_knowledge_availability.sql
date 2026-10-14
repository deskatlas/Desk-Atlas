-- MS-45 / PRD-F26, SDD-C20/C24, ERD-E24/E25/E26/E29, QAD-TC44/45.
BEGIN;
CREATE FUNCTION public.assistant_knowledge_availability(p_actor uuid,p_scope text,p_fingerprint text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE v_role text; v_epoch bigint; v_enabled boolean;
BEGIN
 SELECT role::text INTO v_role FROM staff_profiles WHERE user_id=p_actor AND is_active;
 IF v_role IS NULL OR v_role NOT IN ('ADMIN','STAFF') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT epoch INTO v_epoch FROM kb_catalog WHERE scope_id=p_scope AND active_embedding_fingerprint=p_fingerprint;
 IF v_epoch IS NULL THEN RAISE EXCEPTION 'FINGERPRINT_MISMATCH'; END IF;
 SELECT EXISTS (
  SELECT 1 FROM kb_documents d JOIN kb_document_versions v ON v.id=d.active_version_id AND v.document_id=d.id
  WHERE d.scope_id=p_scope AND d.deleted_at IS NULL AND (v_role='ADMIN' OR d.audience='ADMIN_AND_STAFF')
   AND v.status='PUBLISHED' AND v.removed_at IS NULL AND v.embedding_fingerprint=p_fingerprint
   AND v.review_acknowledged AND v.reviewed_by IS NOT NULL AND v.published_at IS NOT NULL
   AND v.chunk_count>0 AND v.chunk_count=v.expected_chunk_count AND v.manifest_sha256 IS NOT NULL
   AND (SELECT count(*) FROM kb_chunks c WHERE c.version_id=v.id AND c.generation=v.generation)=v.expected_chunk_count
   AND NOT EXISTS (SELECT 1 FROM kb_chunks c WHERE c.version_id=v.id AND c.generation=v.generation
    AND (c.embedding_fingerprint<>p_fingerprint OR c.content_sha256<>encode(digest(convert_to(c.content,'UTF8'),'sha256'),'hex')))
   AND (SELECT encode(digest(convert_to(string_agg(c.content_sha256,'' ORDER BY c.ordinal),'UTF8'),'sha256'),'hex')
    FROM kb_chunks c WHERE c.version_id=v.id AND c.generation=v.generation)=v.manifest_sha256
 ) INTO v_enabled;
 RETURN jsonb_build_object('enabled',v_enabled,'knowledge_epoch',v_epoch);
END $$;
REVOKE ALL ON FUNCTION public.assistant_knowledge_availability(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.assistant_knowledge_availability(uuid,text,text) TO service_role;
COMMIT;
