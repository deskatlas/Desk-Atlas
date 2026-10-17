-- MS-52 / PRD-F27 / SDD-C24 / QAD-TC45/46: safe eligibility and independent lanes.
BEGIN;
CREATE FUNCTION public.kb_schedule_purge() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE deadline timestamptz;
BEGIN
 IF NEW.kind='PURGE' AND NEW.status IN ('QUEUED','RETRY') THEN
  SELECT upload_authorized_until INTO deadline FROM kb_document_versions WHERE id=NEW.version_id;
  IF deadline>now() THEN
   NEW.next_attempt_at:=greatest(NEW.next_attempt_at,deadline);
   NEW.stage:='WAITING_UPLOAD';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER kb_schedule_purge BEFORE INSERT OR UPDATE ON public.kb_jobs FOR EACH ROW EXECUTE FUNCTION public.kb_schedule_purge();
REVOKE ALL ON FUNCTION public.kb_schedule_purge() FROM PUBLIC,anon,authenticated;
UPDATE public.kb_jobs SET next_attempt_at=next_attempt_at WHERE kind='PURGE' AND status IN ('QUEUED','RETRY');
CREATE OR REPLACE FUNCTION public.kb_worker_command(p_scope text,p_operation text,p_id uuid DEFAULT NULL,p_data jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE d kb_documents; v kb_document_versions; j kb_jobs; c jsonb; n integer; fingerprint text; failure text; notice text; delay_seconds integer; exhausted_claim boolean:=false; claim_kind text:=p_data->>'kind';
BEGIN
 IF p_operation='claim' THEN
  IF claim_kind IS NOT NULL AND claim_kind NOT IN ('INGEST','PURGE') THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  -- Lock the document first. SKIP LOCKED avoids contention with publication/removal.
  SELECT doc.* INTO d FROM kb_documents doc WHERE doc.scope_id=p_scope AND EXISTS(
   SELECT 1 FROM kb_jobs job WHERE job.document_id=doc.id AND (claim_kind IS NULL OR job.kind=claim_kind)
    AND (job.kind<>'PURGE' OR EXISTS(SELECT 1 FROM kb_document_versions pv WHERE pv.id=job.version_id AND pv.status='REMOVED' AND (pv.upload_authorized_until IS NULL OR pv.upload_authorized_until<=now()))) AND ((job.status IN ('QUEUED','RETRY') AND job.next_attempt_at<=now()) OR (job.status='RUNNING' AND job.lease_until<now()))
  ) ORDER BY doc.created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO j FROM kb_jobs WHERE document_id=d.id AND (claim_kind IS NULL OR kind=claim_kind)
   AND (kind<>'PURGE' OR EXISTS(SELECT 1 FROM kb_document_versions pv WHERE pv.id=version_id AND pv.status='REMOVED' AND (pv.upload_authorized_until IS NULL OR pv.upload_authorized_until<=now()))) AND ((status IN ('QUEUED','RETRY') AND next_attempt_at<=now()) OR (status='RUNNING' AND lease_until<now())) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1;
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
  UPDATE kb_jobs SET status='RUNNING',lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',heartbeat_at=now(),attempts=attempts+1,checkpoint=CASE WHEN kind='PURGE' THEN checkpoint||jsonb_build_object('eligible_at',next_attempt_at,'claimed_at',clock_timestamp()) ELSE checkpoint END,stage=CASE WHEN kind='PURGE' THEN 'PURGING' ELSE stage END WHERE id=j.id RETURNING * INTO j;
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
 IF j.kind='PURGE' AND (v.status<>'REMOVED' OR v.generation<>j.generation OR d.active_version_id=v.id) THEN RAISE EXCEPTION 'LEASE_LOST'; END IF;
 IF p_operation='purge_targets' AND j.kind='PURGE' THEN
  IF v.upload_authorized_until>clock_timestamp() THEN
   UPDATE kb_jobs SET status='RETRY',attempts=0,next_attempt_at=v.upload_authorized_until,stage='WAITING_UPLOAD',lease_token=NULL,lease_until=NULL WHERE id=j.id;
   RETURN jsonb_build_object('deferred',true,'status','WAITING_UPLOAD');
  END IF;
  -- Validate the exact private version namespace before allowing storage effects.
  IF (v.source_object_key IS NOT NULL AND v.source_object_key<>d.id::text||'/'||v.id::text||'/source')
   OR (v.preview_object_key IS NOT NULL AND (v.preview_object_key NOT LIKE d.id::text||'/'||v.id::text||'/%' OR v.preview_object_key ~ '(^|/)\.\.?(/|$)' OR position(chr(92) in v.preview_object_key)>0)) THEN RAISE EXCEPTION 'MANIFEST_INVALID'; END IF;
  DELETE FROM kb_chunks WHERE id IN (SELECT id FROM kb_chunks WHERE version_id=v.id ORDER BY generation,ordinal LIMIT 1000);
  IF EXISTS(SELECT 1 FROM kb_chunks WHERE version_id=v.id) THEN
   UPDATE kb_jobs SET status='RETRY',attempts=0,next_attempt_at=clock_timestamp()+interval '1 second',stage='CLEANING_CHUNKS',lease_token=NULL,lease_until=NULL WHERE id=j.id;
   RETURN jsonb_build_object('deferred',true,'status','CLEANING_CHUNKS');
  END IF;
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
   IF EXISTS(SELECT 1 FROM kb_chunks WHERE version_id=v.id) THEN RAISE EXCEPTION 'CHUNKS_NOT_CLEANED'; END IF;
   UPDATE kb_document_versions SET source_object_key=NULL,preview_object_key=NULL,extraction_manifest='[]',warning_codes='[]',content_sha256=NULL,source_sha256=NULL,original_filename='Removed',parser_fingerprint=NULL,embedding_fingerprint=NULL WHERE id=v.id;
  ELSIF coalesce((p_data->>'retryable')::boolean,false) AND j.attempts<5 THEN
   delay_seconds:=(ARRAY[30,120,600,1800])[least(j.attempts,4)];
   UPDATE kb_jobs SET status='RETRY',next_attempt_at=now()+make_interval(secs=>delay_seconds*(0.9+random()*0.2)),last_error_code=failure,lease_token=NULL,lease_until=NULL WHERE id=j.id;
   RETURN jsonb_build_object('status','RETRY');
  ELSE
   IF j.kind='INGEST' THEN UPDATE kb_document_versions SET status='FAILED' WHERE id=v.id; END IF;
   notice:=CASE WHEN j.kind='INGEST' THEN 'PROCESSING_FAILED' ELSE 'PURGE_FAILED' END;
  END IF;
  UPDATE kb_jobs SET checkpoint=CASE WHEN kind='PURGE' AND failure IS NULL THEN checkpoint||jsonb_build_object('storage_ms',p_data->'cleanup_storage_ms','object_count',p_data->'cleanup_object_count','verified_at',clock_timestamp()) ELSE checkpoint END,status=CASE WHEN failure IS NULL THEN 'SUCCEEDED' ELSE 'FAILED' END,completed_at=now(),last_error_code=failure,lease_token=NULL,lease_until=NULL WHERE id=j.id;
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

COMMIT;
