-- PRD-F26,F27 / SDD-C20-C24 / ERD-E25,E27 / QAD-TC44-TC46.
-- Derived internal discovery artifacts never replace canonical policy text.
BEGIN;
CREATE TABLE kb_support_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), scope_id text NOT NULL,
 version_id uuid NOT NULL REFERENCES kb_document_versions(id) ON DELETE CASCADE,
 generation integer NOT NULL CHECK(generation>0),
 status text NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED','RUNNING','DONE','FAILED','CANCELLED')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 lease_token uuid, lease_until timestamptz, source_manifest text, structure_manifest text,
 error_code text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 compiler_fingerprint text CHECK(compiler_fingerprint IS NULL OR compiler_fingerprint ~ '^[a-f0-9]{64}$'),
 UNIQUE(version_id,generation)
);
CREATE TABLE kb_support_artifacts (
 version_id uuid NOT NULL REFERENCES kb_document_versions(id) ON DELETE CASCADE,
 generation integer NOT NULL, contract text NOT NULL CHECK(contract='ragfix-prepared-v1'),
 source_manifest text NOT NULL, structure_manifest text, embedding_fingerprint text NOT NULL,
 artifact_text text NOT NULL CHECK(octet_length(artifact_text)<=400000),
 artifact_sha256 text NOT NULL CHECK(artifact_sha256 ~ '^[a-f0-9]{64}$'),
 model text NOT NULL, stats jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(version_id,generation)
);
ALTER TABLE kb_support_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_support_artifacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON kb_support_jobs,kb_support_artifacts FROM PUBLIC,anon,authenticated;
GRANT ALL ON kb_support_jobs,kb_support_artifacts TO service_role;
CREATE INDEX kb_support_jobs_claim ON kb_support_jobs(scope_id,status,created_at);

CREATE FUNCTION kb_queue_support_preparation() RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.status='PUBLISHED' THEN
  INSERT INTO kb_support_jobs(scope_id,version_id,generation)
   SELECT d.scope_id,NEW.id,NEW.generation FROM kb_documents d WHERE d.id=NEW.document_id AND d.deleted_at IS NULL
   ON CONFLICT(version_id,generation) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION kb_queue_support_preparation() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER kb_queue_support_preparation AFTER INSERT OR UPDATE OF status,generation ON kb_document_versions
 FOR EACH ROW EXECUTE FUNCTION kb_queue_support_preparation();
INSERT INTO kb_support_jobs(scope_id,version_id,generation)
 SELECT d.scope_id,v.id,v.generation FROM kb_documents d JOIN kb_document_versions v ON v.id=d.active_version_id
 WHERE d.deleted_at IS NULL AND v.status='PUBLISHED' ON CONFLICT DO NOTHING;

CREATE FUNCTION kb_support_command(p_scope text,p_operation text,p_id uuid DEFAULT NULL,p_data jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE j kb_support_jobs; v kb_document_versions; d kb_documents; actor uuid; seed uuid; evidence jsonb; artifact jsonb; sha text;
BEGIN
 IF p_operation='claim' THEN
  IF coalesce(p_data->>'compiler_fingerprint','') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'MANIFEST_INVALID'; END IF;
  -- A failed unchanged compiler never loops through paid retries. A new
  -- explicitly deployed compiler may retry while retaining any prior artifact.
  UPDATE kb_support_jobs SET status='QUEUED',attempts=0,updated_at=now() WHERE scope_id=p_scope
   AND status='FAILED' AND compiler_fingerprint IS DISTINCT FROM p_data->>'compiler_fingerprint';
  UPDATE kb_support_jobs SET status=CASE WHEN attempts<3 THEN 'QUEUED' ELSE 'FAILED' END,
   lease_token=NULL,lease_until=NULL,updated_at=now(),error_code='LEASE_EXPIRED'
   WHERE scope_id=p_scope AND status='RUNNING' AND lease_until<now();
  UPDATE kb_support_jobs job SET status='CANCELLED',updated_at=now() WHERE job.scope_id=p_scope
   AND job.status='QUEUED' AND NOT EXISTS(SELECT 1 FROM kb_documents doc JOIN kb_document_versions ver
    ON ver.id=doc.active_version_id WHERE ver.id=job.version_id AND ver.generation=job.generation
    AND ver.status='PUBLISHED' AND doc.deleted_at IS NULL);
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
REVOKE ALL ON FUNCTION kb_support_command(text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION kb_support_command(text,text,uuid,jsonb) TO service_role;

CREATE FUNCTION assistant_prepared_catalog(p_actor uuid,p_scope text,p_fingerprint text,p_compiler_fingerprint text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE role_name text; ep bigint; n integer; result jsonb;
BEGIN
 SELECT role::text INTO role_name FROM staff_profiles WHERE user_id=p_actor AND is_active;
 IF role_name IS NULL OR role_name NOT IN ('ADMIN','STAFF') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT epoch INTO ep FROM kb_catalog WHERE scope_id=p_scope AND active_embedding_fingerprint=p_fingerprint;
 IF ep IS NULL THEN RAISE EXCEPTION 'FINGERPRINT_MISMATCH'; END IF;
 SELECT count(*) INTO n FROM kb_documents d JOIN kb_document_versions v ON v.id=d.active_version_id
  WHERE d.scope_id=p_scope AND d.deleted_at IS NULL AND v.status='PUBLISHED'
   AND (role_name='ADMIN' OR d.audience='ADMIN_AND_STAFF');
 SELECT coalesce(jsonb_agg(jsonb_build_object('document_id',d.id,'version_id',v.id,'title',d.title,
  'artifact_sha256',a.artifact_sha256,'source_binding',a.artifact_text::jsonb->>'source_binding',
  'groups',a.artifact_text::jsonb->'groups') ORDER BY d.id),'[]') INTO result
  FROM kb_documents d JOIN kb_document_versions v ON v.id=d.active_version_id JOIN kb_support_artifacts a
   ON a.version_id=v.id AND a.generation=v.generation AND a.source_manifest=v.manifest_sha256
    AND a.structure_manifest IS NOT DISTINCT FROM v.structure_manifest_sha256 AND a.embedding_fingerprint=p_fingerprint
  WHERE d.scope_id=p_scope AND d.deleted_at IS NULL AND v.status='PUBLISHED'
   AND (role_name='ADMIN' OR d.audience='ADMIN_AND_STAFF')
   AND (p_compiler_fingerprint IS NULL OR a.stats->>'compiler_fingerprint'=p_compiler_fingerprint)
   AND a.artifact_sha256=encode(digest(convert_to(a.artifact_text,'UTF8'),'sha256'),'hex');
 RETURN jsonb_build_object('contract','ragfix-prepared-v1','epoch',ep,'complete',n>0 AND n=jsonb_array_length(result),'documents',result);
END $$;
REVOKE ALL ON FUNCTION assistant_prepared_catalog(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION assistant_prepared_catalog(uuid,text,text,text) TO service_role;

CREATE FUNCTION assistant_prepared_evidence(p_actor uuid,p_scope text,p_fingerprint text,p_selections jsonb,p_compiler_fingerprint text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE catalog jsonb; selection jsonb; item jsonb; artifact jsonb; indexes jsonb:='[]'; result jsonb:='[]'; ids uuid[]:='{}'; chunks uuid[]; cid uuid; group_ids integer[];
BEGIN
 catalog:=assistant_prepared_catalog(p_actor,p_scope,p_fingerprint,p_compiler_fingerprint);
 IF NOT (catalog->>'complete')::boolean OR jsonb_array_length(p_selections) NOT BETWEEN 1 AND 12 THEN RAISE EXCEPTION 'UNRESOLVED_CONTEXT'; END IF;
 IF (SELECT count(DISTINCT value->>'version_id') FROM jsonb_array_elements(p_selections))<>jsonb_array_length(p_selections)
  THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 FOR selection IN SELECT value FROM jsonb_array_elements(p_selections) LOOP
  SELECT value INTO item FROM jsonb_array_elements(catalog->'documents')
   WHERE value->>'version_id'=selection->>'version_id' AND value->>'artifact_sha256'=selection->>'artifact_sha256';
  IF item IS NULL THEN RAISE EXCEPTION 'KNOWLEDGE_CHANGED'; END IF;
  SELECT artifact_text::jsonb INTO artifact FROM kb_support_artifacts WHERE version_id=(item->>'version_id')::uuid
   AND artifact_sha256=item->>'artifact_sha256';
  IF jsonb_array_length(selection->'groups') NOT BETWEEN 1 AND 64 OR EXISTS(
   SELECT 1 FROM jsonb_array_elements_text(selection->'groups') wanted WHERE NOT EXISTS(
    SELECT 1 FROM jsonb_array_elements(artifact->'groups') g WHERE g->>'id'=wanted)) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  WITH RECURSIVE required(id) AS (
   SELECT (g->>'id')::integer FROM jsonb_array_elements(artifact->'groups') g
    WHERE (selection->'groups') @> jsonb_build_array((g->>'id')::integer) OR g->>'scope'='GLOBAL'
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(artifact->'groups') uncertain WHERE uncertain->>'scope'='DOCUMENT')
   UNION
   SELECT dep::integer FROM required r JOIN LATERAL jsonb_array_elements(artifact->'groups') g ON (g->>'id')::integer=r.id
    CROSS JOIN LATERAL jsonb_array_elements_text(g->'requires') dep
  ) SELECT array_agg(id) INTO group_ids FROM required;
  SELECT array_agg(DISTINCT (u->>'chunk_id')::uuid) INTO chunks FROM jsonb_array_elements(artifact->'units') u
   WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(artifact->'groups') g CROSS JOIN LATERAL jsonb_array_elements(g->'ranges') span
    WHERE (g->>'id')::integer=ANY(group_ids) AND (u->>'i')::integer BETWEEN (span->>0)::integer AND (span->>1)::integer);
  ids:=ids||chunks;
  indexes:=indexes||jsonb_build_array(item||jsonb_build_object('selected_groups',to_jsonb(group_ids)));
 END LOOP;
 IF cardinality(ids)>1000 THEN RAISE EXCEPTION 'CONTEXT_BUDGET_EXCEEDED'; END IF;
 FOR cid IN SELECT ch.id FROM kb_chunks ch WHERE ch.id=ANY(ids) ORDER BY ch.version_id,ch.ordinal LOOP
  item:=assistant_read_source(p_actor,p_scope,p_fingerprint,(SELECT version_id FROM kb_chunks WHERE id=cid),cid);
  IF item IS NULL THEN RAISE EXCEPTION 'KNOWLEDGE_CHANGED'; END IF;
  result:=result||jsonb_build_array(item);
 END LOOP;
 IF jsonb_array_length(result)<>(SELECT count(DISTINCT x) FROM unnest(ids) x) THEN RAISE EXCEPTION 'KNOWLEDGE_CHANGED'; END IF;
 RETURN jsonb_build_object('contract','ragfix-prepared-v1','epoch',catalog->'epoch','indexes',indexes,'sources',result);
END $$;
REVOKE ALL ON FUNCTION assistant_prepared_evidence(uuid,text,text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION assistant_prepared_evidence(uuid,text,text,jsonb,text) TO service_role;
COMMIT;
