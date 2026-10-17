-- MS65 / PRD-F26,F27 / SDD-C20-C24 / ERD-E25,E27 / QAD-TC44-TC46.
BEGIN;
ALTER TABLE kb_document_versions ADD COLUMN support_contract text CHECK(support_contract IS NULL OR support_contract='ms65-v1');
ALTER TABLE kb_document_versions ADD COLUMN repair_of uuid REFERENCES kb_document_versions(id);

ALTER FUNCTION kb_worker_command(text,text,uuid,jsonb) RENAME TO kb_worker_command_ms64;
REVOKE ALL ON FUNCTION kb_worker_command_ms64(text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION kb_worker_command(p_scope text,p_operation text,p_id uuid DEFAULT NULL,p_data jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE result jsonb; v kb_document_versions; ctx jsonb; deps jsonb;
BEGIN
 IF p_operation='complete' AND NOT (p_data ? 'error_code') THEN
  SELECT ver.* INTO v FROM kb_document_versions ver JOIN kb_jobs j ON j.version_id=ver.id WHERE j.id=p_id;
  IF v.upload_intent IS NOT NULL AND p_data->>'support_contract' IS DISTINCT FROM 'ms65-v1' THEN
   RETURN kb_worker_command_ms64(p_scope,p_operation,p_id,p_data||jsonb_build_object('error_code','MANIFEST_INVALID','retryable',false));
  END IF;
 END IF;
 result:=kb_worker_command_ms64(p_scope,p_operation,p_id,p_data);
 IF p_operation<>'complete' OR p_data ? 'error_code' THEN RETURN result; END IF;
 SELECT ver.* INTO v FROM kb_document_versions ver JOIN kb_jobs j ON j.version_id=ver.id WHERE j.id=p_id FOR UPDATE OF ver;
 IF v.status<>'PUBLISHED' OR v.support_contract='ms65-v1' THEN RETURN result; END IF;
 -- Scope uncertainty is a mandatory full-document inspection obligation.
 -- Edges retain only original ancestors/references; no policy locality inference.
 FOR ctx IN SELECT DISTINCT section_context FROM kb_chunks WHERE version_id=v.id AND generation=v.generation LOOP
  SELECT coalesce(jsonb_agg(value ORDER BY value),'[]') INTO deps FROM (
   SELECT DISTINCT value FROM jsonb_array_elements_text(coalesce(ctx->'ancestors','[]')||coalesce(ctx->'references','[]'))
   WHERE value<>ctx->>'section_id'
  ) edges;
  ctx:=ctx||jsonb_build_object('scope','DOCUMENT','dependencies',deps);
  UPDATE kb_chunks SET section_context=ctx,structure_sha256=kb_structure_hash(ctx)
   WHERE version_id=v.id AND generation=v.generation AND section_context->>'section_id'=ctx->>'section_id';
 END LOOP;
 UPDATE kb_document_versions SET support_contract='ms65-v1',structure_manifest_sha256=(
  SELECT encode(digest(convert_to(string_agg(content_sha256||structure_sha256,'' ORDER BY ordinal),'UTF8'),'sha256'),'hex')
  FROM kb_chunks WHERE version_id=v.id AND generation=v.generation) WHERE id=v.id RETURNING * INTO v;
 UPDATE kb_document_versions SET system_verification=system_verification||jsonb_build_object(
  'support_contract','ms65-v1','structure_manifest_sha256',v.structure_manifest_sha256,'repair_of',v.repair_of) WHERE id=v.id;
 INSERT INTO audit_logs(actor_role,action,entity_type,entity_id,metadata) VALUES('SYSTEM','KB_SUPPORT_PREPARED','kb_document_version',v.id,
  jsonb_build_object('support_contract','ms65-v1','repair_of',v.repair_of,'generation',v.generation,'scope_id',p_scope));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION kb_worker_command(text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION kb_worker_command(text,text,uuid,jsonb) TO service_role;

-- Legacy readers may not mistake a document inspection obligation for LOCAL.
ALTER FUNCTION assistant_expand_evidence(uuid,text,text,uuid[]) RENAME TO assistant_expand_evidence_ms64;
ALTER FUNCTION assistant_expand_evidence_v3(uuid,text,text,uuid[]) RENAME TO assistant_expand_evidence_v3_ms64;
REVOKE ALL ON FUNCTION assistant_expand_evidence_ms64(uuid,text,text,uuid[]),assistant_expand_evidence_v3_ms64(uuid,text,text,uuid[]) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION assistant_expand_evidence(p_actor uuid,p_scope text,p_fingerprint text,p_chunks uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM kb_chunks c JOIN kb_document_versions v ON v.id=c.version_id WHERE c.id=ANY(p_chunks) AND v.support_contract IS NOT NULL) THEN
  RETURN jsonb_build_object('complete',false,'reason','REPROCESS_REQUIRED','sources','[]'::jsonb);
 END IF;
 RETURN assistant_expand_evidence_ms64(p_actor,p_scope,p_fingerprint,p_chunks);
END $$;
CREATE FUNCTION assistant_expand_evidence_v3(p_actor uuid,p_scope text,p_fingerprint text,p_chunks uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM kb_chunks c JOIN kb_document_versions v ON v.id=c.version_id WHERE c.id=ANY(p_chunks) AND v.support_contract IS NOT NULL) THEN
  RETURN jsonb_build_object('complete',false,'reason','REPROCESS_REQUIRED','sources','[]'::jsonb);
 END IF;
 RETURN assistant_expand_evidence_v3_ms64(p_actor,p_scope,p_fingerprint,p_chunks);
END $$;
REVOKE ALL ON FUNCTION assistant_expand_evidence(uuid,text,text,uuid[]),assistant_expand_evidence_v3(uuid,text,text,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION assistant_expand_evidence(uuid,text,text,uuid[]),assistant_expand_evidence_v3(uuid,text,text,uuid[]) TO service_role;

CREATE FUNCTION assistant_document_evidence(p_actor uuid,p_scope text,p_fingerprint text,p_chunks uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE c record; v kb_document_versions; ids uuid[]; item jsonb; result jsonb:='[]'; ep bigint; n integer; bytes bigint; role_name text;
BEGIN
 SELECT role::text INTO role_name FROM staff_profiles WHERE user_id=p_actor AND is_active;
 IF role_name IS NULL OR role_name NOT IN ('ADMIN','STAFF') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT epoch INTO ep FROM kb_catalog WHERE scope_id=p_scope AND active_embedding_fingerprint=p_fingerprint;
 IF ep IS NULL THEN RAISE EXCEPTION 'FINGERPRINT_MISMATCH'; END IF;
 IF cardinality(p_chunks)<1 OR cardinality(p_chunks)>12 OR cardinality(p_chunks)<>(SELECT count(DISTINCT x) FROM unnest(p_chunks) x) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 FOR c IN SELECT id,version_id FROM kb_chunks WHERE id=ANY(p_chunks) LOOP
  item:=assistant_read_source(p_actor,p_scope,p_fingerprint,c.version_id,c.id);
  IF item IS NULL THEN RAISE EXCEPTION 'KNOWLEDGE_CHANGED'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM kb_chunks WHERE id=ANY(p_chunks))<>cardinality(p_chunks) THEN RAISE EXCEPTION 'KNOWLEDGE_CHANGED'; END IF;
 SELECT array_agg(DISTINCT version_id) INTO ids FROM kb_chunks WHERE id=ANY(p_chunks);
 FOR v IN SELECT * FROM kb_document_versions WHERE id=ANY(ids) LOOP
  IF v.support_contract IS NOT NULL AND v.support_contract<>'ms65-v1' THEN RAISE EXCEPTION 'UNRESOLVED_CONTEXT'; END IF;
  IF NOT ((v.review_acknowledged AND v.reviewed_by IS NOT NULL AND v.reviewed_at IS NOT NULL)
   OR coalesce(v.system_verification->>'policy'='kb-auto-v1'
    AND v.system_verification->>'generation'=v.generation::text
    AND v.system_verification->>'source_sha256'=v.source_sha256
    AND v.system_verification->>'content_sha256'=v.content_sha256
    AND v.system_verification->>'manifest_sha256'=v.manifest_sha256
    AND v.system_verification->>'parser_fingerprint'=v.parser_fingerprint
    AND v.system_verification->>'structure_manifest_sha256'=v.structure_manifest_sha256
    AND v.system_verification->>'embedding_fingerprint'=v.embedding_fingerprint
    AND (v.support_contract IS NULL OR v.system_verification->>'support_contract'=v.support_contract),false))
  THEN RAISE EXCEPTION 'UNRESOLVED_CONTEXT'; END IF;
  -- Compatible legacy adapter inspects the whole original generation, never a
  -- sparse graph or an unverified human-review label.
  IF v.manifest_sha256 IS DISTINCT FROM (SELECT encode(digest(convert_to(string_agg(content_sha256,'' ORDER BY ordinal),'UTF8'),'sha256'),'hex') FROM kb_chunks WHERE version_id=v.id AND generation=v.generation)
   OR v.expected_chunk_count IS DISTINCT FROM (SELECT count(*)::integer FROM kb_chunks WHERE version_id=v.id AND generation=v.generation)
   OR (v.structure_manifest_sha256 IS NOT NULL AND v.structure_manifest_sha256 IS DISTINCT FROM (SELECT encode(digest(convert_to(string_agg(content_sha256||structure_sha256,'' ORDER BY ordinal),'UTF8'),'sha256'),'hex') FROM kb_chunks WHERE version_id=v.id AND generation=v.generation))
   OR EXISTS(SELECT 1 FROM kb_chunks WHERE version_id=v.id AND generation=v.generation AND (structure_sha256 IS DISTINCT FROM kb_structure_hash(section_context) OR coalesce((section_context->>'unresolved')::boolean,true)))
  THEN RAISE EXCEPTION 'UNRESOLVED_CONTEXT'; END IF;
 END LOOP;
 SELECT count(*),sum(octet_length(ch.content)) INTO n,bytes FROM kb_chunks ch JOIN kb_document_versions ver ON ver.id=ch.version_id WHERE ver.id=ANY(ids) AND ch.generation=ver.generation;
 IF n>1000 OR bytes>240000 THEN RAISE EXCEPTION 'CONTEXT_BUDGET_EXCEEDED'; END IF;
 FOR c IN SELECT ch.id,ch.version_id FROM kb_chunks ch JOIN kb_document_versions ver ON ver.id=ch.version_id WHERE ver.id=ANY(ids) AND ch.generation=ver.generation ORDER BY ch.version_id,ch.ordinal LOOP
  item:=assistant_read_source(p_actor,p_scope,p_fingerprint,c.version_id,c.id);
  IF item IS NULL THEN RAISE EXCEPTION 'KNOWLEDGE_CHANGED'; END IF;
  result:=result||jsonb_build_array(item);
 END LOOP;
 RETURN jsonb_build_object('contract','ms65-v1','epoch',ep,'sources',result);
END $$;
REVOKE ALL ON FUNCTION assistant_document_evidence(uuid,text,text,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION assistant_document_evidence(uuid,text,text,uuid[]) TO service_role;

-- Discover by artifact properties, independently of titles, IDs or parser tag.
CREATE FUNCTION kb_evidence_repairs(p_scope text,p_actor uuid,p_after uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM staff_profiles WHERE user_id=p_actor AND role='ADMIN' AND is_active) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM (
  SELECT d.id,d.revision,v.id version_id,v.chunk_count FROM kb_documents d JOIN kb_document_versions v ON v.id=d.active_version_id
  WHERE d.scope_id=p_scope AND d.deleted_at IS NULL AND v.status='PUBLISHED' AND v.support_contract IS DISTINCT FROM 'ms65-v1'
   AND (p_after IS NULL OR d.id>p_after) ORDER BY d.id LIMIT 21) r);
END $$;
REVOKE ALL ON FUNCTION kb_evidence_repairs(text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION kb_evidence_repairs(text,uuid,uuid) TO service_role;

CREATE FUNCTION kb_begin_evidence_repair(p_scope text,p_actor uuid,p_document uuid,p_revision bigint,p_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d kb_documents; old kb_document_versions; v kb_document_versions; receipt jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM staff_profiles WHERE user_id=p_actor AND role='ADMIN' AND is_active) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT * INTO d FROM kb_documents WHERE id=p_document AND scope_id=p_scope FOR UPDATE;
 IF NOT FOUND OR d.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 SELECT * INTO v FROM kb_document_versions WHERE request_id=p_request;
 IF FOUND THEN
  IF v.document_id<>d.id OR v.uploaded_by<>p_actor OR v.repair_of IS NULL OR v.expected_revision<>p_revision THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
 ELSE
  IF d.revision<>p_revision THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
  SELECT * INTO old FROM kb_document_versions WHERE id=d.active_version_id AND status='PUBLISHED';
  IF NOT FOUND OR old.source_object_key IS NULL OR old.source_sha256 IS NULL OR old.support_contract='ms65-v1' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  IF EXISTS(SELECT 1 FROM kb_document_versions WHERE document_id=d.id AND status IN ('UPLOADING','QUEUED','PROCESSING')) THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
  receipt:=kb_admin_command(p_scope,p_actor,'upload_auto',NULL,jsonb_build_object('request_id',p_request,'replace_document_id',d.id,'expected_revision',d.revision,
   'title',d.title,'audience',d.audience,'filename',old.original_filename,'declared_type',old.detected_type));
  UPDATE kb_document_versions SET repair_of=old.id WHERE id=(receipt->>'id')::uuid RETURNING * INTO v;
 END IF;
 SELECT * INTO old FROM kb_document_versions WHERE id=v.repair_of;
 RETURN jsonb_build_object('id',v.id,'status',v.status,'source_object_key',old.source_object_key,'target_object_key',v.source_object_key,
  'source_sha256',old.source_sha256,'source_bytes',old.source_bytes,'request_id',v.request_id);
END $$;
REVOKE ALL ON FUNCTION kb_begin_evidence_repair(text,uuid,uuid,bigint,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION kb_begin_evidence_repair(text,uuid,uuid,bigint,uuid) TO service_role;

CREATE FUNCTION kb_finalize_evidence_repair(p_scope text,p_actor uuid,p_version uuid,p_hash text,p_bytes bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v kb_document_versions; old kb_document_versions; d kb_documents;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM staff_profiles WHERE user_id=p_actor AND role='ADMIN' AND is_active) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT doc.* INTO d FROM kb_documents doc JOIN kb_document_versions ver ON ver.document_id=doc.id WHERE ver.id=p_version AND doc.scope_id=p_scope FOR UPDATE OF doc;
 IF NOT FOUND OR d.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 SELECT * INTO v FROM kb_document_versions WHERE id=p_version FOR UPDATE;
 IF v.uploaded_by IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT * INTO old FROM kb_document_versions WHERE id=v.repair_of;
 IF old.id IS NULL OR p_hash IS DISTINCT FROM old.source_sha256 OR p_bytes IS DISTINCT FROM old.source_bytes THEN RAISE EXCEPTION 'MANIFEST_INVALID'; END IF;
 IF v.expected_revision<>d.revision OR d.active_version_id<>old.id THEN
  IF v.status='PUBLISHED' AND d.active_version_id=v.id THEN RETURN jsonb_build_object('version_id',v.id,'status',v.status); END IF;
  RAISE EXCEPTION 'VERSION_CONFLICT';
 END IF;
 RETURN kb_admin_command(p_scope,p_actor,'finalize',v.id,jsonb_build_object('request_id',v.request_id,'source_sha256',p_hash,'source_bytes',p_bytes));
END $$;
REVOKE ALL ON FUNCTION kb_finalize_evidence_repair(text,uuid,uuid,text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION kb_finalize_evidence_repair(text,uuid,uuid,text,bigint) TO service_role;
COMMIT;
