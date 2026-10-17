-- MS-48 / ERD-E25/E26, SDD-C21/C23/C24: additive reviewed section graph.
BEGIN;
ALTER TABLE public.kb_chunks ADD COLUMN section_context jsonb, ADD COLUMN structure_sha256 text;
ALTER TABLE public.kb_document_versions ADD COLUMN structure_manifest_sha256 text, ADD COLUMN structure_reviewed boolean NOT NULL DEFAULT false;
CREATE FUNCTION public.kb_structure_hash(c jsonb) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path=public,extensions,pg_temp AS $$
 SELECT encode(digest(convert_to('1|'||(c->>'section_id')||'|'||
 coalesce((SELECT string_agg(value,',' ORDER BY ordinal) FROM jsonb_array_elements_text(c->'dependencies') WITH ORDINALITY a(value,ordinal)),'')||'|'||(c->>'unresolved'),'UTF8'),'sha256'),'hex')
$$;
REVOKE ALL ON FUNCTION public.kb_structure_hash(jsonb) FROM PUBLIC,anon,authenticated;
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
    IF v.structure_manifest_sha256 IS NOT NULL AND NOT coalesce((p_data->>'acknowledge_structure')::boolean,false) THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
    IF p_data->>'audience' NOT IN ('ADMIN_ONLY','ADMIN_AND_STAFF') OR (jsonb_array_length(v.warning_codes)>0 AND NOT coalesce((p_data->>'acknowledge_warnings')::boolean,false)) THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
    PERFORM 1 FROM kb_catalog WHERE scope_id=p_scope AND active_embedding_fingerprint=v.embedding_fingerprint FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'FINGERPRINT_MISMATCH'; END IF;
    SELECT count(*) INTO n FROM kb_chunks WHERE version_id=v.id AND generation=v.generation AND embedding_fingerprint=v.embedding_fingerprint;
    IF n<>v.expected_chunk_count OR n<1 THEN RAISE EXCEPTION 'MANIFEST_INVALID'; END IF;
    old_id:=d.active_version_id;
    UPDATE kb_document_versions SET status='SUPERSEDED' WHERE id=old_id;
    UPDATE kb_document_versions SET status='PUBLISHED',structure_reviewed=(v.structure_manifest_sha256 IS NOT NULL),review_acknowledged=true,reviewed_by=p_actor,reviewed_at=now(),published_by=p_actor,published_at=now() WHERE id=v.id;
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

CREATE OR REPLACE FUNCTION public.kb_worker_command(p_scope text,p_operation text,p_id uuid DEFAULT NULL,p_data jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE d kb_documents; v kb_document_versions; j kb_jobs; c jsonb; n integer; fingerprint text; failure text; notice text; delay_seconds integer; exhausted_claim boolean:=false;
BEGIN
 IF p_operation='claim' THEN
  -- Lock the document first. SKIP LOCKED avoids contention with publication/removal.
  SELECT doc.* INTO d FROM kb_documents doc WHERE doc.scope_id=p_scope AND EXISTS(
   SELECT 1 FROM kb_jobs job WHERE job.document_id=doc.id AND ((job.status IN ('QUEUED','RETRY') AND job.next_attempt_at<=now()) OR (job.status='RUNNING' AND job.lease_until<now()))
  ) ORDER BY doc.created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO j FROM kb_jobs WHERE document_id=d.id AND ((status IN ('QUEUED','RETRY') AND next_attempt_at<=now()) OR (status='RUNNING' AND lease_until<now())) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  SELECT * INTO v FROM kb_document_versions WHERE id=j.version_id FOR UPDATE;
  IF j.kind='INGEST' AND d.deleted_at IS NULL AND v.status<>'REMOVED' AND d.revision<>v.expected_revision THEN
   UPDATE kb_jobs SET status='CANCELLED',last_error_code='VERSION_CONFLICT',lease_token=NULL,lease_until=NULL WHERE id=j.id;
   UPDATE kb_document_versions SET status='FAILED' WHERE id=v.id;
   INSERT INTO kb_notifications(recipient_user_id,document_id,version_id,job_id,kind,event_key,error_code) VALUES(v.uploaded_by,d.id,v.id,j.id,'PROCESSING_FAILED',j.id||':'||j.generation||':conflict:'||v.uploaded_by,'VERSION_CONFLICT') ON CONFLICT(event_key) DO NOTHING;
   RETURN NULL;
  END IF;
  IF j.kind='INGEST' AND (d.deleted_at IS NOT NULL OR v.status='REMOVED' OR j.generation<>v.generation) THEN
   UPDATE kb_jobs SET status='CANCELLED',lease_token=NULL WHERE id=j.id; RETURN NULL;
  END IF;
  UPDATE kb_jobs SET status='RUNNING',lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',heartbeat_at=now(),attempts=attempts+1 WHERE id=j.id RETURNING * INTO j;
  IF j.kind='INGEST' THEN UPDATE kb_document_versions SET status='PROCESSING' WHERE id=v.id; END IF;
  IF j.attempts>5 THEN
   exhausted_claim:=true; p_operation:='complete'; p_id:=j.id; p_data:=jsonb_build_object('lease_token',j.lease_token,'generation',j.generation,'error_code','RESOURCE_LIMIT','retryable',false);
  ELSE RETURN jsonb_build_object('job',to_jsonb(j),'version',to_jsonb(v)); END IF;
 END IF;
 SELECT doc.* INTO d FROM kb_documents doc JOIN kb_jobs job ON job.document_id=doc.id WHERE job.id=p_id AND doc.scope_id=p_scope FOR UPDATE OF doc;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 SELECT * INTO j FROM kb_jobs WHERE id=p_id FOR UPDATE;
 SELECT * INTO v FROM kb_document_versions WHERE id=j.version_id FOR UPDATE;
 IF j.status<>'RUNNING' OR j.lease_token IS DISTINCT FROM (p_data->>'lease_token')::uuid OR j.lease_until<=now() OR j.generation IS DISTINCT FROM (p_data->>'generation')::integer OR (j.kind='INGEST' AND (d.deleted_at IS NOT NULL OR v.status='REMOVED' OR v.generation<>j.generation OR d.revision<>v.expected_revision)) THEN RAISE EXCEPTION 'LEASE_LOST'; END IF;
 IF p_operation='purge_targets' AND j.kind='PURGE' THEN
  RETURN jsonb_build_object('source_object_key',v.source_object_key,'preview_object_key',v.preview_object_key);
 ELSIF p_operation='heartbeat' THEN
  UPDATE kb_jobs SET lease_until=now()+interval '2 minutes',heartbeat_at=now() WHERE id=j.id;
 ELSIF p_operation='checkpoint' THEN
  IF j.kind<>'INGEST' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  SELECT active_embedding_fingerprint INTO fingerprint FROM kb_catalog WHERE scope_id=p_scope;
  FOR c IN SELECT value FROM jsonb_array_elements(coalesce(p_data->'chunks','[]')) LOOP
   IF encode(digest(convert_to(c->>'content','UTF8'),'sha256'),'hex')<>c->>'content_sha256' THEN RAISE EXCEPTION 'MANIFEST_INVALID'; END IF;
   INSERT INTO kb_chunks(version_id,generation,ordinal,heading_path,page_start,page_end,content,content_sha256,token_count,extraction_method,embedding,embedding_fingerprint,section_context,structure_sha256)
   VALUES(v.id,j.generation,(c->>'ordinal')::integer,c->>'heading_path',(c->>'page_start')::integer,(c->>'page_end')::integer,c->>'content',c->>'content_sha256',(c->>'token_count')::integer,c->>'extraction_method',(c->'embedding')::text::extensions.vector,fingerprint,c->'section_context',c->>'structure_sha256')
   ON CONFLICT(version_id,generation,ordinal) DO UPDATE SET content=excluded.content,content_sha256=excluded.content_sha256,embedding=excluded.embedding,token_count=excluded.token_count,heading_path=excluded.heading_path,page_start=excluded.page_start,page_end=excluded.page_end,extraction_method=excluded.extraction_method,embedding_fingerprint=excluded.embedding_fingerprint,section_context=excluded.section_context,structure_sha256=excluded.structure_sha256;
  END LOOP;
  UPDATE kb_jobs SET stage=p_data->>'stage',checkpoint=jsonb_build_object('generation',j.generation,'chunk_count',(SELECT count(*) FROM kb_chunks WHERE version_id=v.id AND generation=j.generation)) WHERE id=j.id;
 ELSIF p_operation='complete' THEN
  failure:=p_data->>'error_code';
  IF failure IS NULL AND j.kind='INGEST' THEN
   SELECT active_embedding_fingerprint INTO fingerprint FROM kb_catalog WHERE scope_id=p_scope;
   SELECT count(*) INTO n FROM kb_chunks WHERE version_id=v.id AND generation=j.generation AND embedding_fingerprint=fingerprint;
   IF n<1 OR n IS DISTINCT FROM (p_data->>'expected_chunk_count')::integer OR fingerprint IS DISTINCT FROM p_data->>'embedding_fingerprint'
    OR (SELECT min(ordinal)<>0 OR max(ordinal)<>n-1 FROM kb_chunks WHERE version_id=v.id AND generation=j.generation)
    OR encode(digest(convert_to((SELECT string_agg(content_sha256,'' ORDER BY ordinal) FROM kb_chunks WHERE version_id=v.id AND generation=j.generation),'UTF8'),'sha256'),'hex') IS DISTINCT FROM p_data->>'manifest_sha256'
    OR p_data->>'content_sha256' IS NULL OR p_data->>'parser_fingerprint' IS NULL THEN RAISE EXCEPTION 'MANIFEST_INVALID'; END IF;
   UPDATE kb_document_versions SET status='READY',chunk_count=n,expected_chunk_count=n,content_sha256=p_data->>'content_sha256',manifest_sha256=p_data->>'manifest_sha256',parser_fingerprint=p_data->>'parser_fingerprint',embedding_fingerprint=fingerprint,warning_codes=p_data->'warning_codes',extraction_manifest=p_data->'extraction_manifest' WHERE id=v.id;
   IF p_data->>'structure_manifest_sha256' IS NOT NULL THEN
    IF EXISTS(SELECT 1 FROM kb_chunks WHERE version_id=v.id AND generation=j.generation AND (section_context IS NULL OR structure_sha256 IS NULL OR kb_structure_hash(section_context) IS NULL OR structure_sha256 IS DISTINCT FROM kb_structure_hash(section_context)))
     OR p_data->>'structure_manifest_sha256' IS DISTINCT FROM (SELECT encode(digest(convert_to(string_agg(content_sha256||structure_sha256,'' ORDER BY ordinal),'UTF8'),'sha256'),'hex') FROM kb_chunks WHERE version_id=v.id AND generation=j.generation)
     THEN RAISE EXCEPTION 'MANIFEST_INVALID'; END IF;
   END IF;
   UPDATE kb_document_versions SET structure_reviewed=false,structure_manifest_sha256=p_data->>'structure_manifest_sha256' WHERE id=v.id;
   notice:='READY_FOR_REVIEW';
  ELSIF failure IS NULL AND j.kind='PURGE' THEN
   IF v.upload_authorized_until IS NOT NULL AND now()<v.upload_authorized_until THEN
    UPDATE kb_jobs SET status='RETRY',attempts=0,next_attempt_at=v.upload_authorized_until,lease_token=NULL,lease_until=NULL WHERE id=j.id;
    RETURN jsonb_build_object('status','RETRY');
   END IF;
   IF NOT coalesce((p_data->>'storage_verified')::boolean,false) THEN RAISE EXCEPTION 'STORAGE_NOT_VERIFIED'; END IF;
   DELETE FROM kb_chunks WHERE version_id=v.id;
   UPDATE kb_document_versions SET source_object_key=NULL,preview_object_key=NULL,extraction_manifest='[]',warning_codes='[]',content_sha256=NULL,source_sha256=NULL,original_filename='Removed',parser_fingerprint=NULL,embedding_fingerprint=NULL WHERE id=v.id;
  ELSIF coalesce((p_data->>'retryable')::boolean,false) AND j.attempts<5 THEN
   delay_seconds:=(ARRAY[30,120,600,1800])[least(j.attempts,4)];
   UPDATE kb_jobs SET status='RETRY',next_attempt_at=now()+make_interval(secs=>delay_seconds*(0.9+random()*0.2)),last_error_code=failure,lease_token=NULL,lease_until=NULL WHERE id=j.id;
   RETURN jsonb_build_object('status','RETRY');
  ELSE
   IF j.kind='INGEST' THEN UPDATE kb_document_versions SET status='FAILED' WHERE id=v.id; END IF;
   notice:=CASE WHEN j.kind='INGEST' THEN 'PROCESSING_FAILED' ELSE 'PURGE_FAILED' END;
  END IF;
  UPDATE kb_jobs SET status=CASE WHEN failure IS NULL THEN 'SUCCEEDED' ELSE 'FAILED' END,completed_at=now(),last_error_code=failure,lease_token=NULL,lease_until=NULL WHERE id=j.id;
  IF notice IS NOT NULL THEN
   INSERT INTO kb_notifications(recipient_user_id,document_id,version_id,job_id,kind,event_key,error_code)
   VALUES(v.uploaded_by,d.id,v.id,j.id,notice,j.id||':'||j.generation||':'||notice||':'||v.uploaded_by,failure) ON CONFLICT(event_key) DO NOTHING;
  END IF;
  INSERT INTO audit_logs(actor_role,action,entity_type,entity_id,metadata) VALUES('SYSTEM','KB_JOB_COMPLETED','kb_document',d.id,jsonb_build_object('job_id',j.id,'generation',j.generation,'failed',failure IS NOT NULL));
 ELSE RAISE EXCEPTION 'INVALID_OPERATION'; END IF;
 IF exhausted_claim THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('job_id',j.id,'accepted',true);
END $$;

REVOKE ALL ON FUNCTION public.kb_worker_command(text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kb_worker_command(text,text,uuid,jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.assistant_search_knowledge(p_actor uuid,p_scope text,p_fingerprint text,p_vector extensions.vector(1024),p_min_similarity double precision)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE v_role text; v_result jsonb;
BEGIN
  SELECT role::text INTO v_role FROM public.staff_profiles WHERE user_id=p_actor AND is_active;
  IF v_role IS NULL OR v_role NOT IN ('ADMIN','STAFF') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF abs(extensions.vector_norm(p_vector)-1)>0.001 OR p_min_similarity NOT BETWEEN -1 AND 1 THEN RAISE EXCEPTION 'INVALID_VECTOR'; END IF;
  SELECT coalesce(jsonb_agg(item ORDER BY distance, tie_id),'[]') INTO v_result FROM (
    SELECT jsonb_build_object('document_id',d.id,'version_id',v.id,'chunk_id',c.id,'title',d.title,'heading_path',c.heading_path,'source_page',c.page_start,'epoch',k.epoch,'extraction_method',c.extraction_method,'content_hash',c.content_sha256,'content',c.content) item,
      c.embedding <=> p_vector distance,c.id tie_id
    FROM public.kb_documents d JOIN public.kb_document_versions v ON v.id=d.active_version_id AND v.document_id=d.id
    JOIN public.kb_chunks c ON c.version_id=v.id AND c.generation=v.generation
    JOIN public.kb_catalog k ON k.scope_id=d.scope_id
    WHERE d.scope_id=p_scope AND d.deleted_at IS NULL AND v.status='PUBLISHED' AND v.removed_at IS NULL
      AND (v_role='ADMIN' OR d.audience='ADMIN_AND_STAFF')
      AND k.active_embedding_fingerprint=p_fingerprint AND v.embedding_fingerprint=p_fingerprint AND c.embedding_fingerprint=p_fingerprint
      AND 1-(c.embedding <=> p_vector)>=p_min_similarity
    ORDER BY distance,c.id LIMIT 12
  ) candidates;
  RETURN v_result;
END $$;

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
 IF EXISTS(SELECT 1 FROM kb_document_versions WHERE id=ANY(ids) AND structure_manifest_sha256 IS NOT NULL AND NOT structure_reviewed) THEN RETURN jsonb_build_object('complete',false,'reason','UNRESOLVED_CONTEXT','sources','[]'::jsonb); END IF;
 IF legacy THEN RETURN jsonb_build_object('complete',false,'reason','REPROCESS_REQUIRED','sources','[]'::jsonb); END IF;
 IF EXISTS(SELECT 1 FROM kb_document_versions v WHERE v.id=ANY(ids) AND (
  v.structure_manifest_sha256 IS DISTINCT FROM (SELECT encode(digest(convert_to(string_agg(c.content_sha256||c.structure_sha256,'' ORDER BY c.ordinal),'UTF8'),'sha256'),'hex') FROM kb_chunks c WHERE c.version_id=v.id AND c.generation=v.generation)
  OR EXISTS(SELECT 1 FROM kb_chunks c WHERE c.version_id=v.id AND c.generation=v.generation AND
   (c.section_context IS NULL OR c.section_context->>'version' IS DISTINCT FROM '1' OR c.structure_sha256 IS NULL OR kb_structure_hash(c.section_context) IS NULL OR c.structure_sha256 IS DISTINCT FROM kb_structure_hash(c.section_context)))
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
REVOKE ALL ON FUNCTION public.assistant_expand_evidence(uuid,text,text,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.assistant_expand_evidence(uuid,text,text,uuid[]) TO service_role;
COMMIT;
