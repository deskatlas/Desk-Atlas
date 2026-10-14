-- SPEC-5: PRD-F27, SDD-C23/C24, ERD-E24..29, QAD-TC45.
-- Additive forward migration. Never run the consolidated reset on an existing DB.
BEGIN;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.kb_catalog (
 scope_id text PRIMARY KEY, epoch bigint NOT NULL DEFAULT 1 CHECK(epoch > 0),
 active_embedding_fingerprint text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.kb_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), scope_id text NOT NULL REFERENCES public.kb_catalog,
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 200),
 audience text NOT NULL DEFAULT 'ADMIN_ONLY' CHECK(audience IN ('ADMIN_ONLY','ADMIN_AND_STAFF')),
 active_version_id uuid, revision bigint NOT NULL DEFAULT 1 CHECK(revision > 0),
 created_by uuid NOT NULL REFERENCES public.staff_profiles(user_id), updated_by uuid NOT NULL REFERENCES public.staff_profiles(user_id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.kb_document_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), document_id uuid NOT NULL REFERENCES public.kb_documents,
 version_number integer NOT NULL CHECK(version_number > 0), generation integer NOT NULL DEFAULT 1 CHECK(generation > 0),
 status text NOT NULL DEFAULT 'UPLOADING' CHECK(status IN ('UPLOADING','QUEUED','PROCESSING','READY','PUBLISHED','SUPERSEDED','FAILED','REMOVED')),
 request_id uuid NOT NULL UNIQUE, expected_revision bigint NOT NULL,
 original_filename text NOT NULL, detected_type text NOT NULL CHECK(detected_type IN ('MD','DOC','DOCX','PDF')),
 source_object_key text UNIQUE, preview_object_key text,
 source_sha256 text, content_sha256 text, source_bytes bigint, page_count integer, chunk_count integer,
 extraction_manifest jsonb NOT NULL DEFAULT '[]', warning_codes jsonb NOT NULL DEFAULT '[]',
 parser_fingerprint text, embedding_fingerprint text, expected_chunk_count integer, manifest_sha256 text,
 review_acknowledged boolean NOT NULL DEFAULT false, reviewed_by uuid REFERENCES public.staff_profiles(user_id), reviewed_at timestamptz,
 uploaded_by uuid NOT NULL REFERENCES public.staff_profiles(user_id), published_by uuid REFERENCES public.staff_profiles(user_id),
 created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz, removed_at timestamptz,
 UNIQUE(document_id,version_number), UNIQUE(document_id,id)
);
-- Extends the SPEC-4 retrieval foundations (015) without recreating existing entities.
ALTER TABLE public.kb_document_versions ADD COLUMN IF NOT EXISTS request_id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.kb_document_versions ADD COLUMN IF NOT EXISTS expected_revision bigint;
UPDATE public.kb_document_versions v SET expected_revision=d.revision FROM public.kb_documents d WHERE v.document_id=d.id AND v.expected_revision IS NULL;
ALTER TABLE public.kb_document_versions ALTER COLUMN request_id SET NOT NULL;
ALTER TABLE public.kb_document_versions ALTER COLUMN expected_revision SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS kb_upload_request ON public.kb_document_versions(request_id);
CREATE UNIQUE INDEX IF NOT EXISTS kb_one_published ON public.kb_document_versions(document_id) WHERE status='PUBLISHED';
CREATE INDEX IF NOT EXISTS kb_document_scope ON public.kb_documents(scope_id,audience,deleted_at);
CREATE TABLE IF NOT EXISTS public.kb_chunks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version_id uuid NOT NULL REFERENCES public.kb_document_versions,
 generation integer NOT NULL, ordinal integer NOT NULL CHECK(ordinal >= 0), heading_path text NOT NULL,
 page_start integer, page_end integer, content text NOT NULL CHECK(length(content)>0), content_sha256 text NOT NULL,
 token_count integer NOT NULL CHECK(token_count BETWEEN 1 AND 800), extraction_method text NOT NULL CHECK(extraction_method IN ('TEXT','OCR','MIXED')),
 embedding extensions.vector(1024) NOT NULL, embedding_fingerprint text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(version_id,generation,ordinal),
 CHECK(abs(extensions.vector_norm(embedding)-1) < 0.001)
);
CREATE TABLE public.kb_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version_id uuid NOT NULL REFERENCES public.kb_document_versions,
 document_id uuid NOT NULL REFERENCES public.kb_documents, kind text NOT NULL CHECK(kind IN ('INGEST','PURGE')),
 idempotency_key text NOT NULL UNIQUE, status text NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED','RUNNING','RETRY','SUCCEEDED','FAILED','CANCELLED')),
 stage text, generation integer NOT NULL, lease_token uuid, attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz, heartbeat_at timestamptz,
 checkpoint jsonb NOT NULL DEFAULT '{}', last_error_code text, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE INDEX kb_jobs_eligible ON public.kb_jobs(status,next_attempt_at);
CREATE INDEX kb_jobs_expired ON public.kb_jobs(lease_until) WHERE status='RUNNING';
CREATE TABLE public.kb_notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recipient_user_id uuid NOT NULL REFERENCES public.staff_profiles(user_id),
 document_id uuid NOT NULL REFERENCES public.kb_documents, version_id uuid NOT NULL REFERENCES public.kb_document_versions,
 job_id uuid NOT NULL REFERENCES public.kb_jobs, kind text NOT NULL CHECK(kind IN ('READY_FOR_REVIEW','PROCESSING_FAILED','PURGE_FAILED')),
 event_key text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), read_at timestamptz, error_code text
);
CREATE INDEX kb_notices_recipient ON public.kb_notifications(recipient_user_id,created_at DESC);
CREATE UNIQUE INDEX kb_admin_request ON public.audit_logs(actor_user_id,action,(metadata->>'request_id')) WHERE action LIKE 'KB_%' AND metadata ? 'request_id';

-- All browser access is denied. Only verified server gateways execute these RPCs.
ALTER TABLE public.kb_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kb_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kb_document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kb_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kb_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kb_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kb_catalog,public.kb_documents,public.kb_document_versions,public.kb_chunks,public.kb_jobs,public.kb_notifications FROM anon,authenticated;
GRANT ALL ON public.kb_catalog,public.kb_documents,public.kb_document_versions,public.kb_chunks,public.kb_jobs,public.kb_notifications TO service_role;
INSERT INTO storage.buckets(id,name,public) VALUES('knowledge-base','knowledge-base',false) ON CONFLICT(id) DO UPDATE SET public=false;

-- One transaction per mutation; lock document before catalog/job/version consistently.
CREATE FUNCTION public.kb_initialize_catalog(p_scope text,p_fingerprint text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF length(btrim(p_scope))=0 OR p_fingerprint !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 INSERT INTO kb_catalog(scope_id,active_embedding_fingerprint) VALUES(p_scope,p_fingerprint) ON CONFLICT(scope_id) DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM kb_catalog WHERE scope_id=p_scope AND active_embedding_fingerprint=p_fingerprint) THEN RAISE EXCEPTION 'FINGERPRINT_MISMATCH'; END IF;
END $$;
CREATE FUNCTION public.kb_admin_command(p_scope text,p_actor uuid,p_operation text,p_id uuid DEFAULT NULL,p_data jsonb DEFAULT '{}')
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
    IF p_data->>'audience' NOT IN ('ADMIN_ONLY','ADMIN_AND_STAFF') OR (jsonb_array_length(v.warning_codes)>0 AND NOT coalesce((p_data->>'acknowledge_warnings')::boolean,false)) THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
    PERFORM 1 FROM kb_catalog WHERE scope_id=p_scope AND active_embedding_fingerprint=v.embedding_fingerprint FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'FINGERPRINT_MISMATCH'; END IF;
    SELECT count(*) INTO n FROM kb_chunks WHERE version_id=v.id AND generation=v.generation AND embedding_fingerprint=v.embedding_fingerprint;
    IF n<>v.expected_chunk_count OR n<1 THEN RAISE EXCEPTION 'MANIFEST_INVALID'; END IF;
    old_id:=d.active_version_id;
    UPDATE kb_document_versions SET status='SUPERSEDED' WHERE id=old_id;
    UPDATE kb_document_versions SET status='PUBLISHED',review_acknowledged=true,reviewed_by=p_actor,reviewed_at=now(),published_by=p_actor,published_at=now() WHERE id=v.id;
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

CREATE FUNCTION public.kb_reconcile_uploads(p_scope text,p_expiry_seconds integer) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d kb_documents; v kb_document_versions; n integer:=0;
BEGIN
 IF p_expiry_seconds<7200 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 FOR d IN SELECT doc.* FROM kb_documents doc WHERE doc.scope_id=p_scope AND doc.deleted_at IS NULL AND EXISTS(SELECT 1 FROM kb_document_versions ver WHERE ver.document_id=doc.id AND ver.status='UPLOADING' AND ver.created_at<now()-make_interval(secs=>p_expiry_seconds)) ORDER BY doc.id FOR UPDATE SKIP LOCKED LIMIT 20 LOOP
  FOR v IN UPDATE kb_document_versions SET status='REMOVED',removed_at=now(),generation=generation+1 WHERE document_id=d.id AND status='UPLOADING' AND created_at<now()-make_interval(secs=>p_expiry_seconds) RETURNING * LOOP
   INSERT INTO kb_jobs(version_id,document_id,kind,idempotency_key,generation) VALUES(v.id,d.id,'PURGE','purge:'||v.id,v.generation) ON CONFLICT(idempotency_key) DO NOTHING;
   INSERT INTO audit_logs(actor_role,action,entity_type,entity_id,metadata) VALUES('SYSTEM','KB_ABANDONED_UPLOAD','kb_document',d.id,jsonb_build_object('version_id',v.id));
   n:=n+1;
  END LOOP;
 END LOOP;
 RETURN n;
END $$;

CREATE FUNCTION public.kb_worker_command(p_scope text,p_operation text,p_id uuid DEFAULT NULL,p_data jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE d kb_documents; v kb_document_versions; j kb_jobs; c jsonb; n integer; fingerprint text; failure text; notice text; delay_seconds integer;
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
   p_operation:='complete'; p_id:=j.id; p_data:=jsonb_build_object('lease_token',j.lease_token,'generation',j.generation,'error_code','RESOURCE_LIMIT','retryable',false);
  ELSE RETURN jsonb_build_object('job',to_jsonb(j),'version',to_jsonb(v)); END IF;
 END IF;
 SELECT doc.* INTO d FROM kb_documents doc JOIN kb_jobs job ON job.document_id=doc.id WHERE job.id=p_id AND doc.scope_id=p_scope FOR UPDATE OF doc;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 SELECT * INTO j FROM kb_jobs WHERE id=p_id FOR UPDATE;
 SELECT * INTO v FROM kb_document_versions WHERE id=j.version_id FOR UPDATE;
 IF j.status<>'RUNNING' OR j.lease_token IS DISTINCT FROM (p_data->>'lease_token')::uuid OR j.lease_until<=now() OR j.generation IS DISTINCT FROM (p_data->>'generation')::integer OR (j.kind='INGEST' AND (d.deleted_at IS NOT NULL OR v.status='REMOVED' OR v.generation<>j.generation OR d.revision<>v.expected_revision)) THEN RAISE EXCEPTION 'LEASE_LOST'; END IF;
 IF p_operation='heartbeat' THEN
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
 RETURN jsonb_build_object('job_id',j.id,'accepted',true);
END $$;

-- Exact search and citation projection share current publication/role/fingerprint checks.
CREATE FUNCTION public.kb_search(p_scope text,p_actor uuid,p_query extensions.vector(1024),p_limit integer DEFAULT 6,p_chunk uuid DEFAULT NULL)
RETURNS TABLE(id uuid,content text,heading_path text,page_start integer,page_end integer,document_id uuid,version_id uuid,epoch bigint,distance double precision)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
 SELECT c.id,c.content,c.heading_path,c.page_start,c.page_end,d.id,v.id,k.epoch,c.embedding OPERATOR(extensions.<=>) p_query
 FROM kb_catalog k JOIN kb_documents d ON d.scope_id=k.scope_id JOIN kb_document_versions v ON v.id=d.active_version_id AND v.document_id=d.id
 JOIN kb_chunks c ON c.version_id=v.id AND c.generation=v.generation
 JOIN staff_profiles a ON a.user_id=p_actor AND a.is_active
 WHERE k.scope_id=p_scope AND d.deleted_at IS NULL AND v.status='PUBLISHED'
 AND c.embedding_fingerprint=k.active_embedding_fingerprint AND v.embedding_fingerprint=k.active_embedding_fingerprint
 AND (a.role='ADMIN' OR (a.role='STAFF' AND d.audience='ADMIN_AND_STAFF')) AND (p_chunk IS NULL OR c.id=p_chunk)
 ORDER BY c.embedding OPERATOR(extensions.<=>) p_query LIMIT greatest(1,least(p_limit,20))
$$;
REVOKE ALL ON FUNCTION public.kb_admin_command(text,uuid,text,uuid,jsonb),public.kb_worker_command(text,text,uuid,jsonb),public.kb_search(text,uuid,extensions.vector,integer,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kb_admin_command(text,uuid,text,uuid,jsonb),public.kb_worker_command(text,text,uuid,jsonb),public.kb_search(text,uuid,extensions.vector,integer,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.kb_initialize_catalog(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kb_initialize_catalog(text,text) TO service_role;
REVOKE ALL ON FUNCTION public.kb_reconcile_uploads(text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kb_reconcile_uploads(text,integer) TO service_role;
COMMIT;
