-- MS-64 / PRD-F27 / SDD-C23,C24 / ERD-E25,E28 / QAD-TC45.
BEGIN;
ALTER TABLE kb_document_versions ADD COLUMN upload_intent jsonb, ADD COLUMN system_verification jsonb;
ALTER TABLE kb_notifications DROP CONSTRAINT kb_notifications_kind_check;
ALTER TABLE kb_notifications ADD CONSTRAINT kb_notifications_kind_check CHECK(kind IN ('AVAILABLE','READY_FOR_REVIEW','PROCESSING_FAILED','PURGE_FAILED'));
-- Replace the legacy publication constraint without rewriting human history.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='kb_document_versions'::regclass AND contype='c'
 AND pg_get_constraintdef(oid) LIKE '%review_acknowledged%' LOOP
  EXECUTE format('ALTER TABLE kb_document_versions DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
ALTER TABLE kb_document_versions ADD CONSTRAINT kb_publication_provenance CHECK(status<>'PUBLISHED' OR (
 published_by IS NOT NULL AND published_at IS NOT NULL AND chunk_count=expected_chunk_count AND chunk_count>0 AND manifest_sha256 IS NOT NULL
 AND ((review_acknowledged AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
 OR (system_verification IS NOT NULL AND system_verification->>'policy'='kb-auto-v1' AND upload_intent IS NOT NULL
 AND NOT review_acknowledged AND reviewed_by IS NULL AND reviewed_at IS NULL))));
ALTER FUNCTION kb_admin_command(text,uuid,text,uuid,jsonb) RENAME TO kb_admin_command_ms63;
REVOKE ALL ON FUNCTION kb_admin_command_ms63(text,uuid,text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION kb_admin_command(p_scope text,p_actor uuid,p_operation text,p_id uuid DEFAULT NULL,p_data jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE r jsonb; v kb_document_versions; d kb_documents;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM staff_profiles WHERE user_id=p_actor AND is_active AND role='ADMIN') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 -- Serialize duplicate request IDs, including uploads before a document exists.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_scope||coalesce(p_data->>'request_id',''),64));
 IF p_operation='upload_auto' THEN
  SELECT * INTO v FROM kb_document_versions WHERE request_id=(p_data->>'request_id')::uuid;
  IF FOUND THEN
   IF v.uploaded_by<>p_actor OR v.upload_intent IS NULL OR v.upload_intent->>'scope_id' IS DISTINCT FROM p_scope
    OR v.original_filename IS DISTINCT FROM p_data->>'filename' OR v.upload_intent->>'audience' IS DISTINCT FROM p_data->>'audience'
    OR v.document_id::text IS DISTINCT FROM coalesce(p_data->>'replace_document_id',v.document_id::text)
   THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
   RETURN jsonb_build_object('id',v.id,'document_id',v.document_id,'status',v.status);
  END IF;
  r:=kb_admin_command_ms63(p_scope,p_actor,'upload',NULL,p_data);
  SELECT * INTO v FROM kb_document_versions WHERE id=(r->>'id')::uuid FOR UPDATE;
  UPDATE kb_document_versions SET upload_intent=jsonb_build_object('policy','kb-auto-v1','actor',p_actor,'scope_id',p_scope,
   'document_id',v.document_id,'version_id',v.id,'request_id',v.request_id,'revision',v.expected_revision,
   'audience',p_data->>'audience','generation',v.generation,'authorized_at',now()) WHERE id=v.id;
  RETURN r;
 END IF;
 IF p_operation='retry' THEN
  SELECT * INTO d FROM kb_documents WHERE id=(SELECT document_id FROM kb_document_versions WHERE id=p_id) AND scope_id=p_scope FOR UPDATE;
  SELECT * INTO v FROM kb_document_versions WHERE id=p_id FOR UPDATE;
  -- Stale intents and historical READY/failed work require a fresh file upload.
  IF v.upload_intent IS NOT NULL AND (v.upload_intent->>'revision')::bigint IS DISTINCT FROM d.revision THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
 END IF;
 r:=kb_admin_command_ms63(p_scope,p_actor,p_operation,p_id,p_data);
 IF p_operation='finalize' THEN
  UPDATE kb_document_versions SET upload_intent=upload_intent||jsonb_build_object('source_sha256',source_sha256,'source_bytes',source_bytes)
   WHERE id=p_id AND upload_intent IS NOT NULL AND NOT (upload_intent ? 'source_sha256');
 ELSIF p_operation='retry' THEN
  UPDATE kb_document_versions SET upload_intent=upload_intent||jsonb_build_object('generation',generation),system_verification=NULL
   WHERE id=p_id AND upload_intent IS NOT NULL;
 END IF;
 RETURN r;
END $$;
REVOKE ALL ON FUNCTION kb_admin_command(text,uuid,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION kb_admin_command(text,uuid,text,uuid,jsonb) TO service_role;
ALTER FUNCTION kb_worker_command(text,text,uuid,jsonb) RENAME TO kb_worker_command_ms63;
REVOKE ALL ON FUNCTION kb_worker_command_ms63(text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION kb_worker_command(p_scope text,p_operation text,p_id uuid DEFAULT NULL,p_data jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE r jsonb; j kb_jobs; v kb_document_versions; d kb_documents; failure text; ctx jsonb; deps jsonb; binding jsonb;
BEGIN
 IF p_operation<>'complete' THEN RETURN kb_worker_command_ms63(p_scope,p_operation,p_id,p_data); END IF;
 SELECT doc.* INTO d FROM kb_documents doc JOIN kb_jobs job ON job.document_id=doc.id WHERE job.id=p_id AND doc.scope_id=p_scope FOR UPDATE OF doc;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 SELECT * INTO j FROM kb_jobs WHERE id=p_id FOR UPDATE;
 SELECT * INTO v FROM kb_document_versions WHERE id=j.version_id FOR UPDATE;
 -- Lost completion responses reconcile only the exact already committed lease.
 IF j.status IN ('SUCCEEDED','FAILED') AND j.checkpoint->>'completed_lease' = p_data->>'lease_token'
  AND j.generation=(p_data->>'generation')::integer THEN RETURN jsonb_build_object('job_id',j.id,'accepted',true,'status',v.status); END IF;
 IF v.upload_intent IS NULL OR j.kind<>'INGEST' OR p_data ? 'error_code' THEN
  r:=kb_worker_command_ms63(p_scope,p_operation,p_id,p_data);
  UPDATE kb_jobs SET checkpoint=checkpoint||jsonb_build_object('completed_lease',p_data->>'lease_token') WHERE id=j.id AND status IN ('SUCCEEDED','FAILED');
  RETURN r;
 END IF;
 -- The original command validates leases, generation, chunks and both manifests.
 IF NOT EXISTS(SELECT 1 FROM staff_profiles WHERE user_id=(v.upload_intent->>'actor')::uuid AND is_active AND role='ADMIN' FOR SHARE) THEN failure:='FORBIDDEN';
 ELSIF v.upload_intent->>'scope_id' IS DISTINCT FROM p_scope OR v.upload_intent->>'document_id' IS DISTINCT FROM d.id::text
  OR v.upload_intent->>'version_id' IS DISTINCT FROM v.id::text OR v.upload_intent->>'request_id' IS DISTINCT FROM v.request_id::text
  OR v.upload_intent->>'actor' IS DISTINCT FROM v.uploaded_by::text
  OR v.upload_intent->>'revision' IS DISTINCT FROM d.revision::text OR v.upload_intent->>'generation' IS DISTINCT FROM v.generation::text
  OR v.upload_intent->>'source_sha256' IS DISTINCT FROM v.source_sha256
  OR v.upload_intent->>'source_bytes' IS DISTINCT FROM v.source_bytes::text
  OR v.upload_intent->>'audience' IS NULL OR v.upload_intent->>'audience' NOT IN ('ADMIN_ONLY','ADMIN_AND_STAFF') THEN failure:='VERSION_CONFLICT';
 ELSIF (p_data->>'expected_chunk_count')::integer>6 THEN failure:='CONTENT_LIMIT';
 ELSIF p_data->>'preparation_policy' IS DISTINCT FROM 'kb-auto-v1' OR p_data->>'parser_fingerprint' !~ '^kb-parser-v5:[a-f0-9]{64}$'
  OR p_data->>'structure_manifest_sha256' IS NULL OR jsonb_array_length(coalesce(p_data->'extraction_manifest','[]'))=0
  OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_data->'warning_codes') w WHERE w NOT IN ('SECTION_SCOPE_REVIEW','BLANK_PAGE_SKIPPED','LEGACY_CONVERSION','OCR_REVIEW','TABLE_REVIEW'))
  OR EXISTS(SELECT 1 FROM kb_chunks WHERE version_id=v.id AND generation=v.generation AND
   (section_context->>'version' IS DISTINCT FROM '2' OR section_context->>'structure_known' IS DISTINCT FROM 'true'
    OR section_context->>'unresolved_references' IS DISTINCT FROM 'false' OR section_context->>'unresolved' IS DISTINCT FROM 'false'))
 THEN failure:='MANIFEST_INVALID'; END IF;
 IF failure IS NOT NULL THEN
  r:=kb_worker_command_ms63(p_scope,p_operation,p_id,p_data||jsonb_build_object('error_code',failure,'retryable',false));
  UPDATE kb_jobs SET checkpoint=checkpoint||jsonb_build_object('completed_lease',p_data->>'lease_token') WHERE id=j.id AND status='FAILED';
  RETURN r;
 END IF;
 r:=kb_worker_command_ms63(p_scope,p_operation,p_id,p_data);
 SELECT * INTO v FROM kb_document_versions WHERE id=v.id;
 IF v.status<>'READY' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 -- Conservative complete-document context: never infer local policy applicability
 -- and never create an MS-59 passage-role overlay or human acknowledgment.
 FOR ctx IN SELECT DISTINCT section_context FROM kb_chunks WHERE version_id=v.id AND generation=v.generation LOOP
  SELECT coalesce(jsonb_agg(sid ORDER BY sid),'[]') INTO deps FROM
   (SELECT DISTINCT section_context->>'section_id' sid FROM kb_chunks WHERE version_id=v.id AND generation=v.generation) nodes
   WHERE sid<>ctx->>'section_id';
  ctx:=ctx||jsonb_build_object('scope','DOCUMENT','dependencies',deps);
  UPDATE kb_chunks SET section_context=ctx,structure_sha256=kb_structure_hash(ctx)
   WHERE version_id=v.id AND generation=v.generation AND section_context->>'section_id'=ctx->>'section_id';
 END LOOP;
 UPDATE kb_document_versions SET structure_manifest_sha256=(SELECT encode(digest(convert_to(string_agg(content_sha256||structure_sha256,'' ORDER BY ordinal),'UTF8'),'sha256'),'hex') FROM kb_chunks WHERE version_id=v.id AND generation=v.generation) WHERE id=v.id RETURNING * INTO v;
 binding:=jsonb_build_object('policy','kb-auto-v1','source_sha256',v.source_sha256,'content_sha256',v.content_sha256,
  'structure_manifest_sha256',v.structure_manifest_sha256,'manifest_sha256',v.manifest_sha256,'generation',v.generation,
  'parser_fingerprint',v.parser_fingerprint,'embedding_fingerprint',v.embedding_fingerprint,'audience',v.upload_intent->>'audience',
  'verified_at',now(),'job_id',j.id,'lease_token',p_data->>'lease_token');
 PERFORM 1 FROM kb_catalog WHERE scope_id=p_scope AND active_embedding_fingerprint=v.embedding_fingerprint FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FINGERPRINT_MISMATCH'; END IF;
 UPDATE kb_document_versions SET status='SUPERSEDED' WHERE id=d.active_version_id;
 UPDATE kb_document_versions SET status='PUBLISHED',system_verification=binding,structure_reviewed=false,
  published_by=v.uploaded_by,published_at=now() WHERE id=v.id;
 UPDATE kb_documents SET active_version_id=v.id,audience=v.upload_intent->>'audience',revision=revision+1,updated_at=now(),updated_by=v.uploaded_by WHERE id=d.id;
 UPDATE kb_catalog SET epoch=epoch+1,updated_at=now() WHERE scope_id=p_scope;
 UPDATE kb_jobs SET checkpoint=checkpoint||jsonb_build_object('completed_lease',p_data->>'lease_token') WHERE id=j.id;
 DELETE FROM kb_notifications WHERE job_id=j.id AND kind='READY_FOR_REVIEW';
 INSERT INTO kb_notifications(recipient_user_id,document_id,version_id,job_id,kind,event_key)
 VALUES(v.uploaded_by,d.id,v.id,j.id,'AVAILABLE',j.id||':'||j.generation||':AVAILABLE:'||v.uploaded_by) ON CONFLICT(event_key) DO NOTHING;
 INSERT INTO audit_logs(actor_role,action,entity_type,entity_id,metadata) VALUES('SYSTEM','KB_AUTO_PUBLISHED','kb_document',d.id,
  jsonb_build_object('version_id',v.id,'job_id',j.id,'policy','kb-auto-v1','authorized_by',v.uploaded_by,'request_id',v.request_id,'scope_id',p_scope));
 RETURN r||jsonb_build_object('status','PUBLISHED');
END $$;
REVOKE ALL ON FUNCTION kb_worker_command(text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION kb_worker_command(text,text,uuid,jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.assistant_knowledge_availability(p_actor uuid,p_scope text,p_fingerprint text)
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
   AND ((v.review_acknowledged AND v.reviewed_by IS NOT NULL) OR (v.system_verification->>'policy'='kb-auto-v1' AND v.system_verification->>'generation'=v.generation::text AND v.system_verification->>'source_sha256'=v.source_sha256 AND v.system_verification->>'content_sha256'=v.content_sha256 AND v.system_verification->>'structure_manifest_sha256'=v.structure_manifest_sha256 AND v.system_verification->>'embedding_fingerprint'=v.embedding_fingerprint)) AND v.published_at IS NOT NULL
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


-- Accept bound system verification without setting human structure review.
CREATE OR REPLACE FUNCTION public.assistant_expand_evidence(p_actor uuid,p_scope text,p_fingerprint text,p_chunks uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE role_name text; ids uuid[]; source_ids uuid[]; result jsonb:='[]'; item jsonb; chunk_id uuid; total integer; units jsonb; groups jsonb; bad boolean; legacy boolean;
BEGIN
 SELECT role::text INTO role_name FROM staff_profiles WHERE user_id=p_actor AND is_active;
 IF role_name IS NULL OR role_name NOT IN ('ADMIN','STAFF') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF cardinality(p_chunks)<1 OR cardinality(p_chunks)>12 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 SELECT array_agg(DISTINCT v.id),count(*) INTO ids,total FROM kb_chunks c
 JOIN kb_document_versions v ON v.id=c.version_id AND c.generation=v.generation
 JOIN kb_documents d ON d.id=v.document_id AND d.active_version_id=v.id
 JOIN kb_catalog k ON k.scope_id=d.scope_id
 WHERE c.id=ANY(p_chunks) AND d.scope_id=p_scope AND d.deleted_at IS NULL AND v.status='PUBLISHED' AND v.removed_at IS NULL
 AND (role_name='ADMIN' OR d.audience='ADMIN_AND_STAFF')
 AND k.active_embedding_fingerprint=p_fingerprint AND v.embedding_fingerprint=p_fingerprint AND c.embedding_fingerprint=p_fingerprint;
 IF total<>cardinality(p_chunks) THEN RAISE EXCEPTION 'KNOWLEDGE_CHANGED'; END IF;
 IF EXISTS(SELECT 1 FROM kb_document_versions v WHERE v.id=ANY(ids) AND (
  v.expected_chunk_count IS NULL OR v.expected_chunk_count<1 OR v.chunk_count<>v.expected_chunk_count OR v.parser_fingerprint IS NULL OR v.content_sha256 IS NULL
  OR (SELECT min(c.ordinal)<>0 OR max(c.ordinal)<>v.expected_chunk_count-1 FROM kb_chunks c WHERE c.version_id=v.id AND c.generation=v.generation)
  OR (SELECT count(*) FROM kb_chunks c WHERE c.version_id=v.id AND c.generation=v.generation AND c.embedding_fingerprint=p_fingerprint)<>v.expected_chunk_count
  OR v.manifest_sha256 IS DISTINCT FROM (SELECT encode(digest(convert_to(string_agg(c.content_sha256,'' ORDER BY c.ordinal),'UTF8'),'sha256'),'hex') FROM kb_chunks c WHERE c.version_id=v.id AND c.generation=v.generation)
  OR EXISTS(SELECT 1 FROM kb_chunks c WHERE c.version_id=v.id AND c.generation=v.generation AND c.content_sha256<>encode(digest(convert_to(c.content,'UTF8'),'sha256'),'hex'))
 )) THEN RAISE EXCEPTION 'MANIFEST_INVALID'; END IF;
 -- Validate the entire structural generation before selecting a subset.
 SELECT bool_or(v.structure_manifest_sha256 IS NULL) INTO legacy FROM kb_document_versions v WHERE v.id=ANY(ids);
 IF EXISTS(SELECT 1 FROM kb_document_versions WHERE id=ANY(ids) AND structure_manifest_sha256 IS NOT NULL AND NOT (structure_reviewed OR coalesce((system_verification->>'policy'='kb-auto-v1' AND system_verification->>'generation'=generation::text AND system_verification->>'source_sha256'=source_sha256 AND system_verification->>'content_sha256'=content_sha256 AND system_verification->>'structure_manifest_sha256'=structure_manifest_sha256 AND system_verification->>'embedding_fingerprint'=embedding_fingerprint),false))) THEN RETURN jsonb_build_object('complete',false,'reason','UNRESOLVED_CONTEXT','sources','[]'::jsonb); END IF;
 IF legacy THEN RETURN jsonb_build_object('complete',false,'reason','REPROCESS_REQUIRED','sources','[]'::jsonb); END IF;
 IF EXISTS(SELECT 1 FROM kb_document_versions v WHERE v.id=ANY(ids) AND (
  v.structure_manifest_sha256 IS DISTINCT FROM (SELECT encode(digest(convert_to(string_agg(c.content_sha256||c.structure_sha256,'' ORDER BY c.ordinal),'UTF8'),'sha256'),'hex') FROM kb_chunks c WHERE c.version_id=v.id AND c.generation=v.generation)
  OR EXISTS(SELECT 1 FROM kb_chunks c WHERE c.version_id=v.id AND c.generation=v.generation AND
   (c.section_context IS NULL OR c.section_context->>'version' NOT IN ('1','2') OR (c.section_context->>'version'='2' AND c.section_context->>'scope'='UNREVIEWED') OR c.structure_sha256 IS NULL OR kb_structure_hash(c.section_context) IS NULL OR c.structure_sha256 IS DISTINCT FROM kb_structure_hash(c.section_context)))
  OR EXISTS(SELECT 1 FROM kb_chunks c JOIN kb_chunks other ON other.version_id=c.version_id AND other.generation=c.generation AND other.section_context->>'section_id'=c.section_context->>'section_id'
   WHERE c.version_id=v.id AND c.generation=v.generation AND other.section_context IS DISTINCT FROM c.section_context)
 )) THEN RAISE EXCEPTION 'MANIFEST_INVALID'; END IF;
 -- UNION visits each section once, including cyclic references. No path explosion.
 WITH RECURSIVE nodes AS (
  SELECT DISTINCT c.version_id,c.section_context->>'section_id' sid,c.section_context ctx FROM kb_chunks c JOIN kb_document_versions v ON v.id=c.version_id
  WHERE v.id=ANY(ids) AND c.generation=v.generation
 ), walk AS (
  SELECT n.* FROM nodes n WHERE EXISTS(SELECT 1 FROM kb_chunks c WHERE c.id=ANY(p_chunks) AND c.version_id=n.version_id AND c.section_context->>'section_id'=n.sid)
  UNION
  SELECT n.* FROM walk w CROSS JOIN LATERAL jsonb_array_elements_text(w.ctx->'dependencies') dep
  JOIN nodes n ON n.version_id=w.version_id AND n.sid=dep.value
 ), selected AS (SELECT DISTINCT version_id,sid,ctx FROM walk)
 SELECT coalesce(jsonb_agg(jsonb_build_object('version_id',s.version_id,'sid',s.sid,'ctx',s.ctx)),'[]'),
  EXISTS(SELECT 1 FROM selected s WHERE (s.ctx->>'unresolved')::boolean
   OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(s.ctx->'dependencies') dep WHERE NOT EXISTS(SELECT 1 FROM nodes n WHERE n.version_id=s.version_id AND n.sid=dep.value)))
 INTO units,bad FROM selected s;
 IF bad OR jsonb_array_length(units)>1000 THEN RETURN jsonb_build_object('complete',false,'reason','UNRESOLVED_CONTEXT','sources','[]'::jsonb); END IF;
 SELECT array_agg(c.id ORDER BY c.version_id,c.ordinal),count(*) INTO source_ids,total FROM kb_chunks c JOIN kb_document_versions v ON v.id=c.version_id
 WHERE c.version_id=ANY(ids) AND c.generation=v.generation AND EXISTS(SELECT 1 FROM jsonb_array_elements(units) u WHERE u->>'version_id'=c.version_id::text AND u->>'sid'=c.section_context->>'section_id');
 IF total>6 THEN RETURN jsonb_build_object('complete',false,'reason','CONTEXT_BUDGET','sources','[]'::jsonb); END IF;
 FOREACH chunk_id IN ARRAY source_ids LOOP
  SELECT assistant_read_source(p_actor,p_scope,p_fingerprint,c.version_id,c.id) INTO item FROM kb_chunks c WHERE c.id=chunk_id;
  IF item IS NULL THEN RAISE EXCEPTION 'KNOWLEDGE_CHANGED'; END IF;
  result:=result||jsonb_build_array(item);
 END LOOP;
 SELECT jsonb_agg(jsonb_build_object('id',u->>'version_id'||':'||(u->>'sid'),
  'chunk_ids',(SELECT jsonb_agg(c.id ORDER BY c.ordinal) FROM kb_chunks c WHERE c.id=ANY(source_ids) AND c.version_id::text=u->>'version_id' AND c.section_context->>'section_id'=u->>'sid'),
  'requires',(SELECT coalesce(jsonb_agg(u->>'version_id'||':'||value),'[]') FROM jsonb_array_elements_text(u->'ctx'->'dependencies')))) INTO groups FROM jsonb_array_elements(units) u;
 RETURN jsonb_build_object('complete',true,'sources',result,'groups',groups);
END $$;

CREATE OR REPLACE FUNCTION public.assistant_evidence_graph_ms59(p_actor uuid,p_scope text,p_fingerprint text,p_chunks uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE role_name text; ids uuid[]; source_ids uuid[]; result jsonb:='[]'; item jsonb; chunk_id uuid; total integer; units jsonb; groups jsonb; bad boolean; legacy boolean;
BEGIN
 SELECT role::text INTO role_name FROM staff_profiles WHERE user_id=p_actor AND is_active;
 IF role_name IS NULL OR role_name NOT IN ('ADMIN','STAFF') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF cardinality(p_chunks)<1 OR cardinality(p_chunks)>12 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 SELECT array_agg(DISTINCT v.id),count(*) INTO ids,total FROM kb_chunks c
 JOIN kb_document_versions v ON v.id=c.version_id AND c.generation=v.generation
 JOIN kb_documents d ON d.id=v.document_id AND d.active_version_id=v.id
 JOIN kb_catalog k ON k.scope_id=d.scope_id
 WHERE c.id=ANY(p_chunks) AND d.scope_id=p_scope AND d.deleted_at IS NULL AND v.status='PUBLISHED' AND v.removed_at IS NULL
 AND (role_name='ADMIN' OR d.audience='ADMIN_AND_STAFF')
 AND k.active_embedding_fingerprint=p_fingerprint AND v.embedding_fingerprint=p_fingerprint AND c.embedding_fingerprint=p_fingerprint;
 IF total<>cardinality(p_chunks) THEN RAISE EXCEPTION 'KNOWLEDGE_CHANGED'; END IF;
 IF EXISTS(SELECT 1 FROM kb_document_versions v WHERE v.id=ANY(ids) AND (
  v.expected_chunk_count IS NULL OR v.expected_chunk_count<1 OR v.chunk_count<>v.expected_chunk_count OR v.parser_fingerprint IS NULL OR v.content_sha256 IS NULL
  OR (SELECT min(c.ordinal)<>0 OR max(c.ordinal)<>v.expected_chunk_count-1 FROM kb_chunks c WHERE c.version_id=v.id AND c.generation=v.generation)
  OR (SELECT count(*) FROM kb_chunks c WHERE c.version_id=v.id AND c.generation=v.generation AND c.embedding_fingerprint=p_fingerprint)<>v.expected_chunk_count
  OR v.manifest_sha256 IS DISTINCT FROM (SELECT encode(digest(convert_to(string_agg(c.content_sha256,'' ORDER BY c.ordinal),'UTF8'),'sha256'),'hex') FROM kb_chunks c WHERE c.version_id=v.id AND c.generation=v.generation)
  OR EXISTS(SELECT 1 FROM kb_chunks c WHERE c.version_id=v.id AND c.generation=v.generation AND c.content_sha256<>encode(digest(convert_to(c.content,'UTF8'),'sha256'),'hex'))
 )) THEN RAISE EXCEPTION 'MANIFEST_INVALID'; END IF;
 -- Validate the entire structural generation before selecting a subset.
 SELECT bool_or(v.structure_manifest_sha256 IS NULL) INTO legacy FROM kb_document_versions v WHERE v.id=ANY(ids);
 IF EXISTS(SELECT 1 FROM kb_document_versions WHERE id=ANY(ids) AND structure_manifest_sha256 IS NOT NULL AND NOT (structure_reviewed OR coalesce((system_verification->>'policy'='kb-auto-v1' AND system_verification->>'generation'=generation::text AND system_verification->>'source_sha256'=source_sha256 AND system_verification->>'content_sha256'=content_sha256 AND system_verification->>'structure_manifest_sha256'=structure_manifest_sha256 AND system_verification->>'embedding_fingerprint'=embedding_fingerprint),false))) THEN RETURN jsonb_build_object('complete',false,'reason','UNRESOLVED_CONTEXT','sources','[]'::jsonb); END IF;
 IF legacy THEN RETURN jsonb_build_object('complete',false,'reason','REPROCESS_REQUIRED','sources','[]'::jsonb); END IF;
 IF EXISTS(SELECT 1 FROM kb_document_versions v WHERE v.id=ANY(ids) AND (
  v.structure_manifest_sha256 IS DISTINCT FROM (SELECT encode(digest(convert_to(string_agg(c.content_sha256||c.structure_sha256,'' ORDER BY c.ordinal),'UTF8'),'sha256'),'hex') FROM kb_chunks c WHERE c.version_id=v.id AND c.generation=v.generation)
  OR EXISTS(SELECT 1 FROM kb_chunks c WHERE c.version_id=v.id AND c.generation=v.generation AND
   (c.section_context IS NULL OR c.section_context->>'version' NOT IN ('1','2') OR (c.section_context->>'version'='2' AND c.section_context->>'scope'='UNREVIEWED') OR c.structure_sha256 IS NULL OR kb_structure_hash(c.section_context) IS NULL OR c.structure_sha256 IS DISTINCT FROM kb_structure_hash(c.section_context)))
  OR EXISTS(SELECT 1 FROM kb_chunks c JOIN kb_chunks other ON other.version_id=c.version_id AND other.generation=c.generation AND other.section_context->>'section_id'=c.section_context->>'section_id'
   WHERE c.version_id=v.id AND c.generation=v.generation AND other.section_context IS DISTINCT FROM c.section_context)
 )) THEN RAISE EXCEPTION 'MANIFEST_INVALID'; END IF;
 -- UNION visits each section once, including cyclic references. No path explosion.
 WITH RECURSIVE nodes AS (
  SELECT DISTINCT c.version_id,c.section_context->>'section_id' sid,c.section_context ctx FROM kb_chunks c JOIN kb_document_versions v ON v.id=c.version_id
  WHERE v.id=ANY(ids) AND c.generation=v.generation
 ), walk AS (
  SELECT n.* FROM nodes n WHERE EXISTS(SELECT 1 FROM kb_chunks c WHERE c.id=ANY(p_chunks) AND c.version_id=n.version_id AND c.section_context->>'section_id'=n.sid)
  UNION
  SELECT n.* FROM walk w CROSS JOIN LATERAL jsonb_array_elements_text(w.ctx->'dependencies') dep
  JOIN nodes n ON n.version_id=w.version_id AND n.sid=dep.value
 ), selected AS (SELECT DISTINCT version_id,sid,ctx FROM walk)
 SELECT coalesce(jsonb_agg(jsonb_build_object('version_id',s.version_id,'sid',s.sid,'ctx',s.ctx)),'[]'),
  EXISTS(SELECT 1 FROM selected s WHERE (s.ctx->>'unresolved')::boolean
   OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(s.ctx->'dependencies') dep WHERE NOT EXISTS(SELECT 1 FROM nodes n WHERE n.version_id=s.version_id AND n.sid=dep.value)))
 INTO units,bad FROM selected s;
 IF bad OR jsonb_array_length(units)>1000 THEN RETURN jsonb_build_object('complete',false,'reason','UNRESOLVED_CONTEXT','sources','[]'::jsonb); END IF;
 SELECT array_agg(c.id ORDER BY c.version_id,c.ordinal),count(*) INTO source_ids,total FROM kb_chunks c JOIN kb_document_versions v ON v.id=c.version_id
 WHERE c.version_id=ANY(ids) AND c.generation=v.generation AND EXISTS(SELECT 1 FROM jsonb_array_elements(units) u WHERE u->>'version_id'=c.version_id::text AND u->>'sid'=c.section_context->>'section_id');
 IF total>1000 THEN RETURN jsonb_build_object('complete',false,'reason','CONTEXT_BUDGET','sources','[]'::jsonb); END IF;
 FOREACH chunk_id IN ARRAY source_ids LOOP
  SELECT assistant_read_source(p_actor,p_scope,p_fingerprint,c.version_id,c.id) INTO item FROM kb_chunks c WHERE c.id=chunk_id;
  IF item IS NULL THEN RAISE EXCEPTION 'KNOWLEDGE_CHANGED'; END IF;
  result:=result||jsonb_build_array(item);
 END LOOP;
 SELECT jsonb_agg(jsonb_build_object('id',u->>'version_id'||':'||(u->>'sid'),
  'chunk_ids',(SELECT jsonb_agg(c.id ORDER BY c.ordinal) FROM kb_chunks c WHERE c.id=ANY(source_ids) AND c.version_id::text=u->>'version_id' AND c.section_context->>'section_id'=u->>'sid'),
  'requires',(SELECT coalesce(jsonb_agg(u->>'version_id'||':'||value),'[]') FROM jsonb_array_elements_text(u->'ctx'->'dependencies')))) INTO groups FROM jsonb_array_elements(units) u;
 RETURN jsonb_build_object('complete',true,'sources',result,'groups',groups);
END $$;
COMMIT;
