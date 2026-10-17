-- PRD-F27 / SDD-C23,C24 / DSD-UI17 / ERD-E24,E25 / QAD-TC45.
-- Document ingestion is independent of per-answer context budgets.
BEGIN;
CREATE OR REPLACE FUNCTION kb_admin_command(p_scope text,p_actor uuid,p_operation text,p_id uuid DEFAULT NULL,p_data jsonb DEFAULT '{}')
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
    OR (v.upload_intent ? 'title' AND v.upload_intent->>'title' IS DISTINCT FROM p_data->>'title')
    OR v.original_filename IS DISTINCT FROM p_data->>'filename' OR v.upload_intent->>'audience' IS DISTINCT FROM p_data->>'audience'
    OR v.document_id::text IS DISTINCT FROM coalesce(p_data->>'replace_document_id',v.document_id::text)
   THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
   RETURN jsonb_build_object('id',v.id,'document_id',v.document_id,'status',v.status);
  END IF;
  r:=kb_admin_command_ms63(p_scope,p_actor,'upload',NULL,p_data);
  SELECT * INTO v FROM kb_document_versions WHERE id=(r->>'id')::uuid FOR UPDATE;
  UPDATE kb_document_versions SET upload_intent=jsonb_build_object('policy','kb-auto-v1','actor',p_actor,'scope_id',p_scope,
   'document_id',v.document_id,'version_id',v.id,'request_id',v.request_id,'revision',v.expected_revision,
   'title',p_data->>'title','audience',p_data->>'audience','generation',v.generation,'authorized_at',now()) WHERE id=v.id;
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
CREATE OR REPLACE FUNCTION kb_worker_command(p_scope text,p_operation text,p_id uuid DEFAULT NULL,p_data jsonb DEFAULT '{}')
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
 UPDATE kb_documents SET title=coalesce(v.upload_intent->>'title',title),active_version_id=v.id,audience=v.upload_intent->>'audience',revision=revision+1,updated_at=now(),updated_by=v.uploaded_by WHERE id=d.id;
 UPDATE kb_catalog SET epoch=epoch+1,updated_at=now() WHERE scope_id=p_scope;
 UPDATE kb_jobs SET checkpoint=checkpoint||jsonb_build_object('completed_lease',p_data->>'lease_token') WHERE id=j.id;
 DELETE FROM kb_notifications WHERE job_id=j.id AND kind='READY_FOR_REVIEW';
 INSERT INTO kb_notifications(recipient_user_id,document_id,version_id,job_id,kind,event_key)
 VALUES(v.uploaded_by,d.id,v.id,j.id,'AVAILABLE',j.id||':'||j.generation||':AVAILABLE:'||v.uploaded_by) ON CONFLICT(event_key) DO NOTHING;
 INSERT INTO audit_logs(actor_role,action,entity_type,entity_id,metadata) VALUES('SYSTEM','KB_AUTO_PUBLISHED','kb_document',d.id,
  jsonb_build_object('version_id',v.id,'job_id',j.id,'policy','kb-auto-v1','authorized_by',v.uploaded_by,'request_id',v.request_id,'scope_id',p_scope));
 RETURN r||jsonb_build_object('status','PUBLISHED');
END $$;
COMMIT;
