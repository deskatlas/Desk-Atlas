-- MS-46 / ERD-E25/E27 / QAD-TC45: fence upload issuance and recover final purge.
BEGIN;
ALTER TABLE public.kb_document_versions ADD COLUMN upload_authorized_until timestamptz;
CREATE TABLE public.kb_upload_permits (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version_id uuid NOT NULL REFERENCES public.kb_document_versions(id),
 actor_id uuid NOT NULL, issue_before timestamptz NOT NULL, delivered boolean NOT NULL DEFAULT false
);
ALTER TABLE public.kb_upload_permits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kb_upload_permits FROM PUBLIC,anon,authenticated;

-- Reserve under the same document lock used by removal. A token is returned to
-- a caller only within this 30-second issuance window. Provider TTL is 7200s;
-- retain another 300 seconds for bounded clock skew. Failed issuers stay fenced.
CREATE FUNCTION public.kb_upload_permit(p_scope text,p_actor uuid,p_version uuid,p_expiry_seconds integer,p_permit uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d kb_documents; v kb_document_versions; permit kb_upload_permits;
BEGIN
 IF p_expiry_seconds<7200 OR NOT EXISTS(SELECT 1 FROM staff_profiles WHERE user_id=p_actor AND role='ADMIN' AND is_active) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT doc.* INTO d FROM kb_documents doc JOIN kb_document_versions ver ON ver.document_id=doc.id WHERE ver.id=p_version AND doc.scope_id=p_scope FOR UPDATE OF doc;
 IF NOT FOUND OR d.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 SELECT * INTO v FROM kb_document_versions WHERE id=p_version FOR UPDATE;
 IF v.uploaded_by<>p_actor OR v.status<>'UPLOADING' OR v.created_at+make_interval(secs=>p_expiry_seconds)<=clock_timestamp() THEN RAISE EXCEPTION 'UPLOAD_EXPIRED'; END IF;
 IF p_permit IS NULL THEN
  INSERT INTO kb_upload_permits(version_id,actor_id,issue_before) VALUES(v.id,p_actor,clock_timestamp()+interval '30 seconds') RETURNING * INTO permit;
  UPDATE kb_document_versions SET upload_authorized_until=greatest(upload_authorized_until,permit.issue_before+interval '7500 seconds') WHERE id=v.id;
 ELSE
  SELECT * INTO permit FROM kb_upload_permits WHERE id=p_permit AND version_id=v.id AND actor_id=p_actor FOR UPDATE;
  IF NOT FOUND OR permit.delivered OR permit.issue_before<=clock_timestamp() THEN RAISE EXCEPTION 'UPLOAD_EXPIRED'; END IF;
  UPDATE kb_upload_permits SET delivered=true WHERE id=permit.id;
 END IF;
 RETURN jsonb_build_object('permit_id',permit.id,'issue_before',permit.issue_before,'object_key',v.source_object_key);
END $$;
REVOKE ALL ON FUNCTION public.kb_upload_permit(text,uuid,uuid,integer,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kb_upload_permit(text,uuid,uuid,integer,uuid) TO service_role;

-- Conservatively cover authorizations created by the previous gateway version.
UPDATE public.kb_document_versions SET upload_authorized_until=now()+interval '7530 seconds'
 WHERE source_object_key IS NOT NULL;
-- A recently completed legacy purge may already have discarded its path while
-- an old upload token remains valid. Reconstruct only the deterministic source
-- path and requeue cleanup. Stop/drain legacy issuers before this migration.
UPDATE public.kb_document_versions SET source_object_key=document_id::text||'/'||id::text||'/source',upload_authorized_until=now()+interval '7530 seconds'
 WHERE status='REMOVED' AND source_object_key IS NULL AND removed_at>now()-interval '7530 seconds';
UPDATE public.kb_jobs j SET status='QUEUED',attempts=0,next_attempt_at=now(),lease_token=NULL,lease_until=NULL,completed_at=NULL
 FROM public.kb_document_versions v WHERE j.version_id=v.id AND j.kind='PURGE' AND j.status='SUCCEEDED' AND v.source_object_key IS NOT NULL AND v.status='REMOVED';
CREATE FUNCTION public.kb_fence_removed_upload() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.source_object_key IS NULL AND OLD.source_object_key IS NOT NULL THEN
  IF OLD.upload_authorized_until>clock_timestamp() THEN RAISE EXCEPTION 'UPLOAD_AUTHORIZATION_ACTIVE'; END IF;
  DELETE FROM kb_upload_permits WHERE version_id=OLD.id;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.kb_fence_removed_upload() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER kb_fence_removed_upload BEFORE UPDATE ON public.kb_document_versions FOR EACH ROW EXECUTE FUNCTION public.kb_fence_removed_upload();

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
   INSERT INTO kb_chunks(version_id,generation,ordinal,heading_path,page_start,page_end,content,content_sha256,token_count,extraction_method,embedding,embedding_fingerprint)
   VALUES(v.id,j.generation,(c->>'ordinal')::integer,c->>'heading_path',(c->>'page_start')::integer,(c->>'page_end')::integer,c->>'content',c->>'content_sha256',(c->>'token_count')::integer,c->>'extraction_method',(c->'embedding')::text::extensions.vector,fingerprint)
   ON CONFLICT(version_id,generation,ordinal) DO UPDATE SET content=excluded.content,content_sha256=excluded.content_sha256,embedding=excluded.embedding,token_count=excluded.token_count,heading_path=excluded.heading_path,page_start=excluded.page_start,page_end=excluded.page_end,extraction_method=excluded.extraction_method,embedding_fingerprint=excluded.embedding_fingerprint;
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
-- MS46-TC02/06: assemble complete published versions before selecting excerpts.
-- Refuse when supporting evidence cannot fit the six-source contract. Selection
-- may not silently discard another paragraph/chunk of a retrieved procedure.
CREATE FUNCTION public.assistant_expand_evidence(p_actor uuid,p_scope text,p_fingerprint text,p_chunks uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE role_name text; ids uuid[]; source_ids uuid[]; result jsonb:='[]'; item jsonb; chunk_id uuid; total integer;
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
 SELECT array_agg(c.id ORDER BY c.version_id,c.ordinal),count(*) INTO source_ids,total FROM kb_chunks c JOIN kb_document_versions v ON v.id=c.version_id WHERE v.id=ANY(ids) AND c.generation=v.generation;
 IF total>6 THEN RETURN jsonb_build_object('complete',false,'sources','[]'::jsonb); END IF;
 FOREACH chunk_id IN ARRAY source_ids LOOP
  SELECT assistant_read_source(p_actor,p_scope,p_fingerprint,c.version_id,c.id) INTO item FROM kb_chunks c WHERE c.id=chunk_id;
  IF item IS NULL THEN RAISE EXCEPTION 'KNOWLEDGE_CHANGED'; END IF;
  result:=result||jsonb_build_array(item);
 END LOOP;
 RETURN jsonb_build_object('complete',true,'sources',result);
END $$;
REVOKE ALL ON FUNCTION public.assistant_expand_evidence(uuid,text,text,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.assistant_expand_evidence(uuid,text,text,uuid[]) TO service_role;
COMMIT;
