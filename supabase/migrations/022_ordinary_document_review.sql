-- MS53-TC08/10/11/13 / ERD-E25/E26: source-bound document approval.
BEGIN;
ALTER TABLE public.kb_document_versions ADD COLUMN document_review_identity jsonb;
CREATE FUNCTION public.kb_prepare_document_review(p_version uuid,p_binding jsonb,p_audience text,p_exceptions jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE v kb_document_versions; node record; supplied jsonb; proposal jsonb; reviews jsonb:='[]'; total integer; needs_review boolean;
BEGIN
 SELECT * INTO v FROM kb_document_versions WHERE id=p_version FOR UPDATE;
 IF v.status IS DISTINCT FROM 'READY' OR p_binding IS NULL
  OR p_binding->>'source_sha256' IS DISTINCT FROM v.source_sha256
  OR p_binding->>'content_sha256' IS DISTINCT FROM v.content_sha256
  OR p_binding->>'structure_manifest_sha256' IS DISTINCT FROM v.structure_manifest_sha256
  OR p_binding->>'generation' IS DISTINCT FROM v.generation::text
  OR p_binding->>'audience' IS DISTINCT FROM p_audience
  OR jsonb_typeof(p_exceptions) IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
 SELECT count(DISTINCT section_context->>'section_id') INTO total FROM kb_chunks WHERE version_id=v.id AND generation=v.generation;
 IF total<1 OR total>1000 OR (SELECT count(DISTINCT value->>'section_id') FROM jsonb_array_elements(p_exceptions))<>jsonb_array_length(p_exceptions)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_exceptions) r WHERE NOT EXISTS(SELECT 1 FROM kb_chunks WHERE version_id=v.id AND generation=v.generation AND section_context->>'section_id'=r->>'section_id'))
 THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM kb_chunks WHERE version_id=v.id AND generation=v.generation GROUP BY section_context->>'section_id' HAVING count(DISTINCT section_context::text)>1)
  OR v.warning_codes ?| ARRAY['WORD_EMBEDDED_CONTENT','TRACKED_CHANGES'] THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
 FOR node IN SELECT section_context->>'section_id' sid,min(section_context::text)::jsonb ctx,string_agg(content,E'\n' ORDER BY ordinal) body,bool_or(extraction_method<>'TEXT') ocr
  FROM kb_chunks WHERE version_id=v.id AND generation=v.generation GROUP BY section_context->>'section_id' LOOP
  -- Match prepareKnowledgeReview exactly. Never infer ambiguous policy scope.
  needs_review:=NOT coalesce((node.ctx->>'structure_known')::boolean,false)
   OR coalesce((node.ctx->>'unresolved_references')::boolean,false) OR node.ocr
   OR (total>1 AND node.sid<>'s0' AND node.body ~* '\m(only|unless|except|never|must|cannot|not|required|always|every|all|before|after|if|when|without|allowed|prohibited|authorize|approve|fee|payment|balance|restriction|policy|shall|should|huwag|maliban|dapat|hindi)\M');
  SELECT value INTO supplied FROM jsonb_array_elements(p_exceptions) WHERE value->>'section_id'=node.sid;
  IF supplied IS NOT NULL THEN proposal:=supplied;
  ELSIF needs_review THEN RAISE EXCEPTION 'REVIEW_REQUIRED';
  ELSE proposal:=jsonb_build_object('section_id',node.sid,'scope',CASE WHEN total=1 OR node.sid='s0' THEN 'DOCUMENT' ELSE 'LOCAL' END,'dependencies','[]'::jsonb,'acknowledge_references',false);
  END IF;
  -- New generations cannot publish unresolved completeness as verified.
  IF proposal->>'scope' IS NULL OR proposal->>'scope' NOT IN ('LOCAL','DOCUMENT') THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
  reviews:=reviews||jsonb_build_array(proposal);
 END LOOP;
 RETURN reviews;
END $$;
REVOKE ALL ON FUNCTION public.kb_prepare_document_review(uuid,jsonb,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
-- The effective admin function below retains every existing lifecycle guard.
CREATE OR REPLACE FUNCTION public.kb_admin_command(p_scope text,p_actor uuid,p_operation text,p_id uuid DEFAULT NULL,p_data jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE d kb_documents; v kb_document_versions; j kb_jobs; old_id uuid; result jsonb; n integer; ep bigint;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM staff_profiles WHERE user_id=p_actor AND is_active AND role='ADMIN') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT metadata->'result' INTO result FROM audit_logs WHERE actor_user_id=p_actor AND action='KB_'||upper(p_operation) AND metadata->>'request_id'=p_data->>'request_id' AND metadata->>'scope_id'=p_scope;
 IF FOUND THEN RETURN result; END IF;
 IF p_operation='upload' THEN
  SELECT * INTO v FROM kb_document_versions WHERE request_id=(p_data->>'request_id')::uuid;
  IF FOUND THEN
   IF v.uploaded_by<>p_actor OR NOT EXISTS(SELECT 1 FROM kb_documents WHERE id=v.document_id AND scope_id=p_scope AND deleted_at IS NULL) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
   RETURN jsonb_build_object('id',v.id,'document_id',v.document_id,'status',v.status);
  END IF;
  IF p_data->>'audience' NOT IN ('ADMIN_ONLY','ADMIN_AND_STAFF') THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF p_data->>'replace_document_id' IS NULL THEN
   INSERT INTO kb_documents(scope_id,title,audience,created_by,updated_by)
    VALUES(p_scope,p_data->>'title',p_data->>'audience',p_actor,p_actor) RETURNING * INTO d;
  ELSE
   SELECT * INTO d FROM kb_documents WHERE id=(p_data->>'replace_document_id')::uuid AND scope_id=p_scope FOR UPDATE;
   IF NOT FOUND OR d.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
   IF d.revision<>(p_data->>'expected_revision')::bigint THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
  END IF;
  SELECT coalesce(max(version_number),0)+1 INTO n FROM kb_document_versions WHERE document_id=d.id;
  INSERT INTO kb_document_versions(document_id,version_number,request_id,expected_revision,original_filename,detected_type,uploaded_by)
   VALUES(d.id,n,(p_data->>'request_id')::uuid,d.revision,p_data->>'filename',p_data->>'declared_type',p_actor) RETURNING * INTO v;
  UPDATE kb_document_versions SET source_object_key=d.id::text||'/'||v.id::text||'/source' WHERE id=v.id RETURNING * INTO v;
  result:=jsonb_build_object('id',v.id,'document_id',v.document_id,'status',v.status);
 ELSE
  IF p_operation IN ('remove_document','audience') THEN
   SELECT * INTO d FROM kb_documents WHERE id=p_id AND scope_id=p_scope FOR UPDATE;
  ELSE
   SELECT * INTO d FROM kb_documents WHERE id=(SELECT document_id FROM kb_document_versions WHERE id=p_id) AND scope_id=p_scope FOR UPDATE;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  SELECT metadata->'result' INTO result FROM audit_logs WHERE actor_user_id=p_actor AND action='KB_'||upper(p_operation) AND metadata->>'request_id'=p_data->>'request_id' AND metadata->>'scope_id'=p_scope;
  IF FOUND THEN RETURN result; END IF;
  SELECT * INTO v FROM kb_document_versions WHERE id=p_id AND document_id=d.id FOR UPDATE;
  IF p_operation='finalize' THEN
   IF v.uploaded_by<>p_actor OR v.request_id<>(p_data->>'request_id')::uuid THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
   IF d.deleted_at IS NOT NULL OR v.status='REMOVED' THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
   IF v.status='UPLOADING' THEN
    IF p_data->>'source_sha256' IS NULL OR (p_data->>'source_bytes')::bigint<=0 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    UPDATE kb_document_versions SET status='QUEUED',source_sha256=p_data->>'source_sha256',source_bytes=(p_data->>'source_bytes')::bigint WHERE id=v.id;
    INSERT INTO kb_jobs(version_id,document_id,kind,idempotency_key,generation) VALUES(v.id,d.id,'INGEST','ingest:'||v.id||':'||v.generation,v.generation);
   END IF;
   SELECT * INTO j FROM kb_jobs WHERE idempotency_key='ingest:'||v.id||':1';
   result:=jsonb_build_object('document_id',d.id,'version_id',v.id,'job_id',j.id,'status','QUEUED');
  ELSE
   IF d.revision IS DISTINCT FROM (p_data->>'expected_revision')::bigint THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
   IF d.deleted_at IS NOT NULL AND p_operation<>'retry_cleanup' THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
   IF p_operation='publish' THEN
    IF v.status='PUBLISHED' AND d.active_version_id=v.id THEN RETURN jsonb_build_object('active_version_id',v.id,'revision',d.revision); END IF;
    IF v.status<>'READY' OR v.expected_revision<>d.revision THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
    IF v.parser_fingerprint LIKE 'kb-parser-v5:%' THEN
     p_data:=jsonb_set(p_data,'{structure_review}',kb_prepare_document_review(v.id,p_data->'document_review',p_data->>'audience',coalesce(p_data->'structure_review','[]'::jsonb)));
    END IF;
    IF v.structure_manifest_sha256 IS NOT NULL AND NOT coalesce((p_data->>'acknowledge_structure')::boolean,false) THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
    IF p_data->>'audience' NOT IN ('ADMIN_ONLY','ADMIN_AND_STAFF') OR (jsonb_array_length(v.warning_codes)>0 AND NOT coalesce((p_data->>'acknowledge_warnings')::boolean,false)) THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
    IF EXISTS(SELECT 1 FROM kb_chunks WHERE version_id=v.id AND generation=v.generation AND section_context->>'version'='2') THEN
     PERFORM kb_apply_structure_review(v.id,p_data->'structure_review');
    END IF;
    PERFORM 1 FROM kb_catalog WHERE scope_id=p_scope AND active_embedding_fingerprint=v.embedding_fingerprint FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'FINGERPRINT_MISMATCH'; END IF;
    SELECT count(*) INTO n FROM kb_chunks WHERE version_id=v.id AND generation=v.generation AND embedding_fingerprint=v.embedding_fingerprint;
    IF n<>v.expected_chunk_count OR n<1 THEN RAISE EXCEPTION 'MANIFEST_INVALID'; END IF;
    old_id:=d.active_version_id;
    UPDATE kb_document_versions SET status='SUPERSEDED' WHERE id=old_id;
    UPDATE kb_document_versions SET status='PUBLISHED',structure_reviewed=(v.structure_manifest_sha256 IS NOT NULL),review_acknowledged=true,document_review_identity=p_data->'document_review',reviewed_by=p_actor,reviewed_at=now(),published_by=p_actor,published_at=now() WHERE id=v.id;
    UPDATE kb_documents SET active_version_id=v.id,audience=p_data->>'audience',revision=revision+1,updated_by=p_actor,updated_at=now() WHERE id=d.id RETURNING * INTO d;
   ELSIF p_operation='audience' THEN
    IF p_data->>'audience' NOT IN ('ADMIN_ONLY','ADMIN_AND_STAFF') THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    UPDATE kb_documents SET audience=p_data->>'audience',revision=revision+1,updated_by=p_actor,updated_at=now() WHERE id=d.id RETURNING * INTO d;
   ELSIF p_operation IN ('remove_document','remove_version') THEN
    IF p_operation='remove_version' AND (v.id IS NULL OR v.id=d.active_version_id) THEN RAISE EXCEPTION 'ACTIVE_VERSION'; END IF;
    UPDATE kb_document_versions SET status='REMOVED',removed_at=now(),generation=generation+1 WHERE document_id=d.id AND (p_operation='remove_document' OR id=v.id) AND status<>'REMOVED';
    UPDATE kb_jobs SET status='CANCELLED',lease_token=NULL,lease_until=NULL WHERE document_id=d.id AND kind='INGEST' AND (p_operation='remove_document' OR version_id=v.id) AND status IN ('QUEUED','RUNNING','RETRY');
    INSERT INTO kb_jobs(version_id,document_id,kind,idempotency_key,generation)
     SELECT id,document_id,'PURGE','purge:'||id,generation FROM kb_document_versions WHERE document_id=d.id AND status='REMOVED' AND (p_operation='remove_document' OR id=v.id) ON CONFLICT(idempotency_key) DO NOTHING;
    IF p_operation='remove_document' THEN
     UPDATE kb_documents SET deleted_at=now(),active_version_id=NULL,revision=revision+1,updated_by=p_actor,updated_at=now() WHERE id=d.id RETURNING * INTO d;
    END IF;
   ELSIF p_operation='retry_cleanup' THEN
    UPDATE kb_jobs SET status='QUEUED',attempts=0,next_attempt_at=now(),lease_token=NULL,lease_until=NULL,completed_at=NULL WHERE document_id=d.id AND kind='PURGE' AND status='FAILED';
   ELSIF p_operation='retry' THEN
    IF v.status<>'FAILED' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    UPDATE kb_document_versions SET status='QUEUED',generation=generation+1,expected_revision=d.revision,review_acknowledged=false WHERE id=v.id RETURNING * INTO v;
    INSERT INTO kb_jobs(version_id,document_id,kind,idempotency_key,generation) VALUES(v.id,d.id,'INGEST','ingest:'||v.id||':'||v.generation,v.generation);
   ELSE RAISE EXCEPTION 'INVALID_OPERATION'; END IF;
   IF p_operation IN ('publish','audience','remove_document') THEN
    UPDATE kb_catalog SET epoch=epoch+1,updated_at=now() WHERE scope_id=p_scope RETURNING epoch INTO ep;
   END IF;
   result:=jsonb_build_object('document_id',d.id,'active_version_id',d.active_version_id,'revision',d.revision,'epoch',ep);
  END IF;
 END IF;
 INSERT INTO audit_logs(actor_user_id,actor_role,action,entity_type,entity_id,metadata)
 VALUES(p_actor,'ADMIN','KB_'||upper(p_operation),'kb_document',d.id,jsonb_build_object('version_id',v.id,'revision',d.revision,'request_id',p_data->>'request_id','scope_id',p_scope,'result',result));
 RETURN result;
EXCEPTION WHEN unique_violation THEN
 -- Concurrent upload/finalize delivery returns the committed original receipt.
 SELECT metadata->'result' INTO result FROM audit_logs WHERE actor_user_id=p_actor AND action='KB_'||upper(p_operation) AND metadata->>'request_id'=p_data->>'request_id' AND metadata->>'scope_id'=p_scope;
 IF FOUND THEN RETURN result; END IF;
 RAISE EXCEPTION 'VERSION_CONFLICT';
END $$;
COMMIT;
