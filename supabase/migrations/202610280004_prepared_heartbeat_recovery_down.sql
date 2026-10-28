-- PRD-F27 / SDD-C24 / QAD-TC44-TC46: recover abandoned preparation after three missed heartbeats.
BEGIN;
DROP TRIGGER IF EXISTS kb_resume_internal_support ON kb_documents;
DROP FUNCTION IF EXISTS kb_resume_internal_support();
CREATE OR REPLACE FUNCTION kb_support_command(p_scope text,p_operation text,p_id uuid DEFAULT NULL,p_data jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE j kb_support_jobs; v kb_document_versions; d kb_documents; actor uuid; seed uuid; evidence jsonb; artifact jsonb; sha text;
BEGIN
 IF p_operation='retry' THEN
  IF coalesce(p_data->>'compiler_fingerprint','') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'MANIFEST_INVALID'; END IF;
  SELECT * INTO j FROM kb_support_jobs WHERE id=p_id AND scope_id=p_scope FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF j.status<>'FAILED' OR j.attempts>=3 OR j.compiler_fingerprint IS DISTINCT FROM p_data->>'compiler_fingerprint'
   OR NOT EXISTS(SELECT 1 FROM kb_documents doc JOIN kb_document_versions ver ON ver.id=doc.active_version_id
    WHERE ver.id=j.version_id AND ver.generation=j.generation AND ver.status='PUBLISHED'
     AND doc.deleted_at IS NULL AND doc.audience IN ('ADMIN_ONLY','ADMIN_AND_STAFF'))
   THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  UPDATE kb_support_jobs SET status='QUEUED',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=j.id;
  INSERT INTO audit_logs(actor_role,action,entity_type,entity_id,metadata) VALUES('SYSTEM','KB_SUPPORT_INDEX_RETRY',
   'kb_document_version',j.version_id,jsonb_build_object('scope_id',p_scope,'attempts',j.attempts,'compiler_fingerprint',j.compiler_fingerprint));
  RETURN jsonb_build_object('accepted',true,'status','QUEUED');
 END IF;
 IF p_operation='claim' THEN
  IF coalesce(p_data->>'compiler_fingerprint','') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'MANIFEST_INVALID'; END IF;
  -- A failed unchanged compiler never loops through paid retries. A new
  -- explicitly deployed compiler may retry while retaining any prior artifact.
  UPDATE kb_support_jobs SET status='QUEUED',attempts=0,updated_at=now() WHERE scope_id=p_scope
   AND status IN ('FAILED','DONE') AND compiler_fingerprint IS DISTINCT FROM p_data->>'compiler_fingerprint';
  UPDATE kb_support_jobs SET status=CASE WHEN attempts<3 THEN 'QUEUED' ELSE 'FAILED' END,
   lease_token=NULL,lease_until=NULL,updated_at=now(),error_code='LEASE_EXPIRED'
   WHERE scope_id=p_scope AND status='RUNNING' AND lease_until<now();
  UPDATE kb_support_jobs job SET status='CANCELLED',updated_at=now() WHERE job.scope_id=p_scope
   AND job.status='QUEUED' AND NOT EXISTS(SELECT 1 FROM kb_documents doc JOIN kb_document_versions ver
    ON ver.id=doc.active_version_id WHERE ver.id=job.version_id AND ver.generation=job.generation
    AND ver.status='PUBLISHED' AND doc.deleted_at IS NULL AND doc.audience IN ('ADMIN_ONLY','ADMIN_AND_STAFF'));
  SELECT * INTO j FROM kb_support_jobs WHERE scope_id=p_scope AND status='QUEUED' AND attempts<3
   ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v FROM kb_document_versions WHERE id=j.version_id FOR SHARE;
  UPDATE kb_support_jobs SET status='RUNNING',attempts=attempts+1,lease_token=gen_random_uuid(),
   lease_until=now()+interval '15 minutes',source_manifest=v.manifest_sha256,
   structure_manifest=v.structure_manifest_sha256,compiler_fingerprint=p_data->>'compiler_fingerprint',
   updated_at=now(),error_code=NULL WHERE id=j.id RETURNING * INTO j;
 ELSE
  SELECT * INTO j FROM kb_support_jobs WHERE id=p_id AND scope_id=p_scope FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF j.lease_token::text IS DISTINCT FROM p_data->>'lease_token' OR j.generation::text IS DISTINCT FROM p_data->>'generation'
   THEN RAISE EXCEPTION 'LEASE_LOST'; END IF;
  IF j.status='DONE' AND p_operation IN ('complete','read') THEN
   SELECT artifact_sha256 INTO sha FROM kb_support_artifacts WHERE version_id=j.version_id AND generation=j.generation;
   IF p_operation='complete' AND sha IS DISTINCT FROM encode(digest(convert_to(p_data->>'artifact_text','UTF8'),'sha256'),'hex')
    THEN RAISE EXCEPTION 'MANIFEST_INVALID'; END IF;
   RETURN jsonb_build_object('accepted',true,'status','DONE','artifact_sha256',sha);
  END IF;
  IF j.status<>'RUNNING' OR j.lease_until<now() THEN RAISE EXCEPTION 'LEASE_LOST'; END IF;
  SELECT * INTO v FROM kb_document_versions WHERE id=j.version_id FOR SHARE;
 END IF;
 SELECT * INTO d FROM kb_documents WHERE id=v.document_id AND scope_id=p_scope FOR SHARE;
 IF d.deleted_at IS NOT NULL OR d.active_version_id IS DISTINCT FROM v.id OR v.status<>'PUBLISHED'
  OR v.generation<>j.generation OR v.manifest_sha256 IS DISTINCT FROM j.source_manifest
  OR v.structure_manifest_sha256 IS DISTINCT FROM j.structure_manifest THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
 IF p_operation='heartbeat' THEN
  UPDATE kb_support_jobs SET lease_until=now()+interval '15 minutes',updated_at=now() WHERE id=j.id;
  RETURN jsonb_build_object('accepted',true);
 ELSIF p_operation='fail' THEN
  IF p_data->>'error_code' NOT IN ('PREPARATION_CAPACITY','PREPARATION_INVALID','PREPARATION_INCOMPLETE',
   'PREPARATION_UNVERIFIED','PREPARATION_MODEL_FAILURE','MANIFEST_INVALID') THEN RAISE EXCEPTION 'MANIFEST_INVALID'; END IF;
  UPDATE kb_support_jobs SET status='FAILED',error_code=p_data->>'error_code',updated_at=now() WHERE id=j.id;
  RETURN jsonb_build_object('accepted',true,'status','FAILED');
 ELSIF p_operation='complete' THEN
  IF p_data->>'compiler_fingerprint' IS DISTINCT FROM j.compiler_fingerprint THEN RAISE EXCEPTION 'LEASE_LOST'; END IF;
  IF octet_length(p_data->>'artifact_text')>400000 OR p_data->>'artifact_text' IS NULL THEN RAISE EXCEPTION 'MANIFEST_INVALID'; END IF;
  artifact:=(p_data->>'artifact_text')::jsonb;
  IF jsonb_typeof(artifact) IS DISTINCT FROM 'object' OR jsonb_typeof(artifact->'units') IS DISTINCT FROM 'array'
   OR jsonb_typeof(artifact->'groups') IS DISTINCT FROM 'array' OR artifact->>'source_binding' IS NULL
   OR p_data->>'model' IS NULL THEN RAISE EXCEPTION 'MANIFEST_INVALID'; END IF;
  IF artifact->>'contract' IS DISTINCT FROM 'ragfix-prepared-v1'
   OR artifact->>'source_binding' !~ '^[a-f0-9]{64}$' OR jsonb_array_length(artifact->'units') NOT BETWEEN 1 AND 1000
   OR jsonb_array_length(artifact->'groups') NOT BETWEEN 1 AND 64 OR coalesce((p_data->>'calls')::integer,0) NOT BETWEEN 4 AND 47
   OR p_data->>'model' NOT IN ('Qwen/Qwen3-32B','Qwen/Qwen3-235B-A22B-Instruct-2507','Qwen/Qwen3.6-35B-A3B')
   THEN RAISE EXCEPTION 'MANIFEST_INVALID'; END IF;
  sha:=encode(digest(convert_to(p_data->>'artifact_text','UTF8'),'sha256'),'hex');
  INSERT INTO kb_support_artifacts(version_id,generation,contract,source_manifest,structure_manifest,embedding_fingerprint,
   artifact_text,artifact_sha256,model,stats) VALUES(v.id,v.generation,'ragfix-prepared-v1',v.manifest_sha256,
   v.structure_manifest_sha256,v.embedding_fingerprint,p_data->>'artifact_text',sha,p_data->>'model',p_data-'artifact_text'-'lease_token')
   ON CONFLICT(version_id,generation) DO UPDATE SET artifact_text=excluded.artifact_text,
    artifact_sha256=excluded.artifact_sha256,model=excluded.model,stats=excluded.stats,created_at=now();
  UPDATE kb_support_jobs SET status='DONE',updated_at=now() WHERE id=j.id;
  UPDATE kb_catalog SET epoch=epoch+1,updated_at=now() WHERE scope_id=p_scope;
  INSERT INTO audit_logs(actor_role,action,entity_type,entity_id,metadata) VALUES('SYSTEM','KB_SUPPORT_INDEX_PREPARED',
   'kb_document_version',v.id,jsonb_build_object('scope_id',p_scope,'generation',v.generation,'model',p_data->>'model','artifact_sha256',sha));
  RETURN jsonb_build_object('accepted',true,'status','DONE','artifact_sha256',sha);
 ELSIF p_operation NOT IN ('claim','read') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 SELECT user_id INTO actor FROM staff_profiles WHERE is_active AND role='ADMIN' ORDER BY user_id LIMIT 1;
 IF actor IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT id INTO seed FROM kb_chunks WHERE version_id=v.id AND generation=v.generation ORDER BY ordinal LIMIT 1;
 BEGIN
  evidence:=assistant_document_evidence(actor,p_scope,v.embedding_fingerprint,ARRAY[seed]);
 EXCEPTION WHEN OTHERS THEN
  IF p_operation<>'claim' THEN RAISE; END IF;
  UPDATE kb_support_jobs SET status='FAILED',error_code='MANIFEST_INVALID',updated_at=now() WHERE id=j.id;
  RETURN NULL;
 END;
 RETURN jsonb_build_object('job',jsonb_build_object('id',j.id,'version_id',v.id,'generation',v.generation,'lease_token',j.lease_token,'compiler_fingerprint',j.compiler_fingerprint),
  'sources',evidence->'sources');
END $$;
COMMIT;
