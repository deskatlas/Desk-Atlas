-- PRD-F26/F27 / SDD-C21/C23/C24 / QAD-TC44/45: vector-only shadow generations.
BEGIN;
CREATE TABLE public.kb_embedding_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), scope_id text NOT NULL REFERENCES public.kb_catalog,
 old_fingerprint text NOT NULL, new_fingerprint text NOT NULL CHECK(new_fingerprint ~ '^[a-f0-9]{64}$'),
 old_epoch bigint NOT NULL, committed_epoch bigint, status text NOT NULL DEFAULT 'PREPARING'
 CHECK(status IN ('PREPARING','COMMITTED','ROLLED_BACK')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.kb_embedding_shadows (
 run_id uuid NOT NULL REFERENCES public.kb_embedding_runs, chunk_id uuid NOT NULL,
 version_id uuid NOT NULL, document_id uuid NOT NULL, document_revision bigint NOT NULL,
 row_hash text NOT NULL, version_hash text NOT NULL, old_verification jsonb,
 old_vector extensions.vector(1024) NOT NULL,
 new_vector extensions.vector(1024), PRIMARY KEY(run_id,chunk_id),
 CHECK(new_vector IS NULL OR abs(extensions.vector_norm(new_vector)-1)<0.001)
);
ALTER TABLE public.kb_embedding_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kb_embedding_shadows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kb_embedding_runs,public.kb_embedding_shadows FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.kb_embedding_maintenance(p_operation text,p_scope text,p_run uuid DEFAULT NULL,p_data jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE r kb_embedding_runs; cat kb_catalog; result jsonb; n bigint; item jsonb;
BEGIN
 IF p_operation='begin' THEN
  LOCK TABLE kb_documents,kb_document_versions,kb_chunks,kb_jobs IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO STRICT cat FROM kb_catalog WHERE scope_id=p_scope FOR UPDATE;
  IF EXISTS(SELECT 1 FROM kb_jobs j JOIN kb_documents d ON d.id=j.document_id WHERE d.scope_id=p_scope
     AND j.status IN ('QUEUED','RUNNING','RETRY')) OR EXISTS(SELECT 1 FROM kb_document_versions v JOIN kb_documents d ON d.id=v.document_id
     WHERE d.scope_id=p_scope AND v.status IN ('UPLOADING','QUEUED','PROCESSING','READY')) THEN
   RAISE EXCEPTION 'PENDING_JOBS_OR_VERSIONS'; END IF;
  IF cat.active_embedding_fingerprint=p_data->>'fingerprint' THEN RAISE EXCEPTION 'ALREADY_ACTIVE'; END IF;
  IF EXISTS(SELECT 1 FROM kb_documents d JOIN kb_document_versions v ON v.id=d.active_version_id
    WHERE d.scope_id=p_scope AND d.deleted_at IS NULL AND
     (v.status<>'PUBLISHED' OR v.embedding_fingerprint IS DISTINCT FROM cat.active_embedding_fingerprint
      OR (SELECT count(*) FROM kb_chunks c WHERE c.version_id=v.id AND c.generation=v.generation) IS DISTINCT FROM v.expected_chunk_count
      OR v.expected_chunk_count<1 OR EXISTS(SELECT 1 FROM kb_chunks c WHERE c.version_id=v.id AND c.generation=v.generation
       AND c.embedding_fingerprint IS DISTINCT FROM cat.active_embedding_fingerprint))) THEN RAISE EXCEPTION 'INVALID_LIVE_CORPUS'; END IF;
  INSERT INTO kb_embedding_runs(scope_id,old_fingerprint,new_fingerprint,old_epoch)
   VALUES(p_scope,cat.active_embedding_fingerprint,p_data->>'fingerprint',cat.epoch) RETURNING * INTO r;
  INSERT INTO kb_embedding_shadows(run_id,chunk_id,version_id,document_id,document_revision,row_hash,version_hash,old_verification,old_vector)
   SELECT r.id,c.id,v.id,d.id,d.revision,encode(digest((to_jsonb(c)-'embedding'-'embedding_fingerprint')::text,'sha256'),'hex'),
    encode(digest((to_jsonb(v)-'embedding_fingerprint'-'system_verification')::text,'sha256'),'hex'),v.system_verification,c.embedding
   FROM kb_documents d JOIN kb_document_versions v ON v.id=d.active_version_id
   JOIN kb_chunks c ON c.version_id=v.id AND c.generation=v.generation
   WHERE d.scope_id=p_scope AND d.deleted_at IS NULL AND v.status='PUBLISHED';
  INSERT INTO audit_logs(actor_role,action,entity_type,entity_id,metadata)
   VALUES('SYSTEM','KB_EMBEDDING_BEGIN','kb_embedding_run',r.id,jsonb_build_object('scope_id',p_scope));
  RETURN jsonb_build_object('run_id',r.id);
 END IF;
 SELECT * INTO STRICT r FROM kb_embedding_runs WHERE id=p_run AND scope_id=p_scope FOR UPDATE;
 IF p_operation='read' THEN
  SELECT coalesce(jsonb_agg(x),'[]') INTO result FROM (
   SELECT s.chunk_id,c.content FROM kb_embedding_shadows s JOIN kb_chunks c ON c.id=s.chunk_id
   WHERE s.run_id=r.id AND s.new_vector IS NULL ORDER BY s.chunk_id LIMIT 4) x;
  RETURN jsonb_build_object('chunks',result,'status',r.status);
 ELSIF p_operation='stage' THEN
  IF r.status<>'PREPARING' OR jsonb_array_length(p_data->'vectors') NOT BETWEEN 1 AND 4 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(p_data->'vectors') LOOP
   UPDATE kb_embedding_shadows SET new_vector=(item->'vector')::text::extensions.vector(1024)
    WHERE run_id=r.id AND chunk_id=(item->>'chunk_id')::uuid AND new_vector IS NULL;
   IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_CHUNK'; END IF;
  END LOOP;
  RETURN jsonb_build_object('staged',true);
 ELSIF p_operation IN ('commit','rollback') THEN
  -- Serialize against publication/removal/checkpoint/claims, then catalog.
  LOCK TABLE kb_documents,kb_document_versions,kb_chunks,kb_jobs IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO STRICT cat FROM kb_catalog WHERE scope_id=p_scope FOR UPDATE;
  IF (p_operation='commit' AND (r.status<>'PREPARING' OR cat.active_embedding_fingerprint<>r.old_fingerprint OR cat.epoch<>r.old_epoch))
   OR (p_operation='rollback' AND (r.status<>'COMMITTED' OR cat.active_embedding_fingerprint<>r.new_fingerprint OR cat.epoch IS DISTINCT FROM r.committed_epoch)) THEN
   RAISE EXCEPTION 'CATALOG_CHANGED'; END IF;
  IF EXISTS(SELECT 1 FROM kb_jobs j JOIN kb_documents d ON d.id=j.document_id WHERE d.scope_id=p_scope
     AND j.status IN ('QUEUED','RUNNING','RETRY')) OR EXISTS(SELECT 1 FROM kb_document_versions v JOIN kb_documents d ON d.id=v.document_id
     WHERE d.scope_id=p_scope AND v.status IN ('UPLOADING','QUEUED','PROCESSING','READY')) THEN RAISE EXCEPTION 'PENDING_JOBS_OR_VERSIONS'; END IF;
  SELECT count(*) INTO n FROM kb_documents d JOIN kb_document_versions v ON v.id=d.active_version_id
   JOIN kb_chunks c ON c.version_id=v.id AND c.generation=v.generation
   WHERE d.scope_id=p_scope AND d.deleted_at IS NULL AND v.status='PUBLISHED';
  IF n<>(SELECT count(*) FROM kb_embedding_shadows WHERE run_id=r.id) OR EXISTS(
   SELECT 1 FROM kb_embedding_shadows s LEFT JOIN kb_documents d ON d.id=s.document_id
   LEFT JOIN kb_document_versions v ON v.id=s.version_id LEFT JOIN kb_chunks c ON c.id=s.chunk_id
   WHERE s.run_id=r.id AND (c.id IS NULL OR d.deleted_at IS NOT NULL OR d.active_version_id IS DISTINCT FROM s.version_id
    OR d.revision IS DISTINCT FROM s.document_revision OR v.status IS DISTINCT FROM 'PUBLISHED' OR c.generation<>v.generation
    OR s.new_vector IS NULL OR s.row_hash IS DISTINCT FROM encode(digest((to_jsonb(c)-'embedding'-'embedding_fingerprint')::text,'sha256'),'hex')
    OR s.version_hash IS DISTINCT FROM encode(digest((to_jsonb(v)-'embedding_fingerprint'-'system_verification')::text,'sha256'),'hex')
    OR v.system_verification IS DISTINCT FROM CASE WHEN p_operation='commit' THEN s.old_verification
     WHEN s.old_verification ? 'embedding_fingerprint' THEN jsonb_set(s.old_verification,'{embedding_fingerprint}',to_jsonb(r.new_fingerprint)) ELSE s.old_verification END
    OR c.embedding_fingerprint IS DISTINCT FROM CASE WHEN p_operation='commit' THEN r.old_fingerprint ELSE r.new_fingerprint END
    OR (p_operation='rollback' AND c.embedding IS DISTINCT FROM s.new_vector))) THEN RAISE EXCEPTION 'CORPUS_CHANGED_OR_INCOMPLETE'; END IF;
  UPDATE kb_chunks c SET embedding=CASE WHEN p_operation='commit' THEN s.new_vector ELSE s.old_vector END,
   embedding_fingerprint=CASE WHEN p_operation='commit' THEN r.new_fingerprint ELSE r.old_fingerprint END
   FROM kb_embedding_shadows s WHERE s.run_id=r.id AND c.id=s.chunk_id;
  UPDATE kb_document_versions v SET embedding_fingerprint=CASE WHEN p_operation='commit' THEN r.new_fingerprint ELSE r.old_fingerprint END,
   system_verification=CASE WHEN p_operation='rollback' THEN s.old_verification
    WHEN s.old_verification ? 'embedding_fingerprint' THEN jsonb_set(s.old_verification,'{embedding_fingerprint}',to_jsonb(r.new_fingerprint)) ELSE s.old_verification END
   FROM (SELECT DISTINCT version_id,old_verification FROM kb_embedding_shadows WHERE run_id=r.id) s WHERE v.id=s.version_id;
  UPDATE kb_catalog SET active_embedding_fingerprint=CASE WHEN p_operation='commit' THEN r.new_fingerprint ELSE r.old_fingerprint END,
   epoch=epoch+1,updated_at=now() WHERE scope_id=p_scope;
  UPDATE kb_embedding_runs SET status=CASE WHEN p_operation='commit' THEN 'COMMITTED' ELSE 'ROLLED_BACK' END,
   committed_epoch=CASE WHEN p_operation='commit' THEN (SELECT epoch FROM kb_catalog WHERE scope_id=p_scope) ELSE committed_epoch END WHERE id=r.id;
  INSERT INTO audit_logs(actor_role,action,entity_type,entity_id,metadata)
   VALUES('SYSTEM','KB_EMBEDDING_'||upper(p_operation),'kb_embedding_run',r.id,jsonb_build_object('scope_id',p_scope,'chunks',n));
  RETURN jsonb_build_object('changed',true,'chunks',n);
 END IF;
 RAISE EXCEPTION 'INVALID_OPERATION';
END $$;
REVOKE ALL ON FUNCTION public.kb_embedding_maintenance(text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kb_embedding_maintenance(text,text,uuid,jsonb) TO service_role;
COMMIT;
