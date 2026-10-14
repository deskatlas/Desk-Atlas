-- SPEC-4 SDD-C21; SPEC-5 ERD-E24/E25/E26/E29 retrieval foundations only.
-- No document ingestion, upload, publication API, or automatic source import.
BEGIN;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
CREATE TABLE public.kb_catalog (
  scope_id text PRIMARY KEY, epoch bigint NOT NULL DEFAULT 0 CHECK(epoch >= 0),
  active_embedding_fingerprint text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.kb_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), scope_id text NOT NULL REFERENCES public.kb_catalog(scope_id),
  title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
  audience text NOT NULL DEFAULT 'ADMIN_ONLY' CHECK(audience IN ('ADMIN_ONLY','ADMIN_AND_STAFF')),
  active_version_id uuid, revision bigint NOT NULL DEFAULT 1 CHECK(revision > 0),
  created_by uuid NOT NULL REFERENCES public.staff_profiles(user_id), updated_by uuid NOT NULL REFERENCES public.staff_profiles(user_id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE TABLE public.kb_document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), document_id uuid NOT NULL REFERENCES public.kb_documents(id),
  version_number integer NOT NULL CHECK(version_number>0), status text NOT NULL DEFAULT 'UPLOADING' CHECK(status IN ('UPLOADING','QUEUED','PROCESSING','READY','PUBLISHED','SUPERSEDED','FAILED','REMOVING','REMOVED')),
  generation integer NOT NULL DEFAULT 1 CHECK(generation>0), original_filename text NOT NULL,
  detected_type text NOT NULL CHECK(detected_type IN ('MD','DOC','DOCX','PDF')),
  source_object_key text, preview_object_key text, source_sha256 text, content_sha256 text,
  source_bytes bigint, page_count integer, chunk_count integer, expected_chunk_count integer, manifest_sha256 text,
  extraction_manifest jsonb NOT NULL DEFAULT '{}', warning_codes jsonb NOT NULL DEFAULT '[]',
  parser_fingerprint text, embedding_fingerprint text, review_acknowledged boolean NOT NULL DEFAULT false,
  reviewed_by uuid REFERENCES public.staff_profiles(user_id), reviewed_at timestamptz,
  uploaded_by uuid NOT NULL REFERENCES public.staff_profiles(user_id), published_by uuid REFERENCES public.staff_profiles(user_id),
  created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz, removed_at timestamptz,
  UNIQUE(document_id,version_number), UNIQUE(document_id,id),
  CHECK(status <> 'PUBLISHED' OR (review_acknowledged AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND published_by IS NOT NULL AND published_at IS NOT NULL AND chunk_count=expected_chunk_count AND chunk_count>0 AND manifest_sha256 IS NOT NULL))
);
ALTER TABLE public.kb_documents ADD CONSTRAINT kb_document_active_version_fk FOREIGN KEY(id,active_version_id) REFERENCES public.kb_document_versions(document_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX kb_one_published_version ON public.kb_document_versions(document_id) WHERE status='PUBLISHED';
CREATE INDEX kb_document_scope ON public.kb_documents(scope_id,audience,deleted_at);
CREATE TABLE public.kb_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version_id uuid NOT NULL REFERENCES public.kb_document_versions(id),
  generation integer NOT NULL CHECK(generation>0), ordinal integer NOT NULL CHECK(ordinal>=0),
  heading_path text NOT NULL DEFAULT '', page_start integer, page_end integer,
  content text NOT NULL CHECK(length(content) BETWEEN 1 AND 16000), content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
  token_count integer NOT NULL CHECK(token_count BETWEEN 1 AND 800), extraction_method text NOT NULL CHECK(extraction_method IN ('TEXT','OCR','MIXED')),
  embedding extensions.vector(1024) NOT NULL, embedding_fingerprint text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(version_id,generation,ordinal), CHECK(abs(extensions.vector_norm(embedding)-1)<0.001)
);
ALTER TABLE public.kb_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kb_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kb_document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kb_chunks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kb_catalog, public.kb_documents, public.kb_document_versions, public.kb_chunks FROM anon, authenticated;
GRANT ALL ON public.kb_catalog, public.kb_documents, public.kb_document_versions, public.kb_chunks TO service_role;

CREATE FUNCTION public.assistant_knowledge_epoch() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_scope text;
BEGIN
  IF TG_TABLE_NAME='kb_documents' THEN
    IF TG_OP='INSERT' AND NEW.active_version_id IS NULL THEN RETURN NULL; END IF;
    IF TG_OP='DELETE' AND OLD.active_version_id IS NULL THEN RETURN NULL; END IF;
    IF TG_OP='UPDATE' AND NEW.active_version_id IS NOT DISTINCT FROM OLD.active_version_id AND NEW.audience IS NOT DISTINCT FROM OLD.audience AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at AND NEW.title IS NOT DISTINCT FROM OLD.title AND NEW.scope_id IS NOT DISTINCT FROM OLD.scope_id THEN RETURN NULL; END IF;
    IF TG_OP='UPDATE' AND NEW.scope_id IS DISTINCT FROM OLD.scope_id THEN UPDATE public.kb_catalog SET epoch=epoch+1,updated_at=now() WHERE scope_id=OLD.scope_id; END IF;
    v_scope:=coalesce(NEW.scope_id,OLD.scope_id);
  ELSIF TG_TABLE_NAME='kb_document_versions' THEN
    IF TG_OP='INSERT' AND NEW.status <> 'PUBLISHED' THEN RETURN NULL; END IF;
    IF TG_OP='DELETE' AND OLD.status <> 'PUBLISHED' THEN RETURN NULL; END IF;
    IF TG_OP='UPDATE' AND NEW.status <> 'PUBLISHED' AND OLD.status <> 'PUBLISHED' THEN RETURN NULL; END IF;
    SELECT scope_id INTO v_scope FROM public.kb_documents WHERE id=coalesce(NEW.document_id,OLD.document_id);
  ELSE
    SELECT d.scope_id INTO v_scope FROM public.kb_documents d JOIN public.kb_document_versions v ON v.document_id=d.id
      WHERE v.id=coalesce(NEW.version_id,OLD.version_id) AND v.status='PUBLISHED' AND d.active_version_id=v.id;
    IF v_scope IS NULL THEN RETURN NULL; END IF;
  END IF;
  UPDATE public.kb_catalog SET epoch=epoch+1,updated_at=now() WHERE scope_id=v_scope;
  RETURN NULL;
END $$;
CREATE TRIGGER assistant_document_epoch AFTER INSERT OR UPDATE OR DELETE ON public.kb_documents FOR EACH ROW EXECUTE FUNCTION public.assistant_knowledge_epoch();
CREATE TRIGGER assistant_version_epoch AFTER INSERT OR UPDATE OR DELETE ON public.kb_document_versions FOR EACH ROW EXECUTE FUNCTION public.assistant_knowledge_epoch();
CREATE TRIGGER assistant_chunk_epoch AFTER INSERT OR UPDATE OR DELETE ON public.kb_chunks FOR EACH ROW EXECUTE FUNCTION public.assistant_knowledge_epoch();

CREATE FUNCTION public.assistant_search_knowledge(p_actor uuid,p_scope text,p_fingerprint text,p_vector extensions.vector(1024),p_min_similarity double precision)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE v_role text; v_result jsonb;
BEGIN
  SELECT role::text INTO v_role FROM public.staff_profiles WHERE user_id=p_actor AND is_active;
  IF v_role IS NULL OR v_role NOT IN ('ADMIN','STAFF') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF abs(extensions.vector_norm(p_vector)-1)>0.001 OR p_min_similarity NOT BETWEEN -1 AND 1 THEN RAISE EXCEPTION 'INVALID_VECTOR'; END IF;
  SELECT coalesce(jsonb_agg(item ORDER BY distance),'[]') INTO v_result FROM (
    SELECT jsonb_build_object('document_id',d.id,'version_id',v.id,'chunk_id',c.id,'title',d.title,'heading_path',c.heading_path,'source_page',c.page_start,'epoch',k.epoch,'extraction_method',c.extraction_method,'content_hash',c.content_sha256,'content',c.content) item,
      c.embedding <=> p_vector distance
    FROM public.kb_documents d JOIN public.kb_document_versions v ON v.id=d.active_version_id AND v.document_id=d.id
    JOIN public.kb_chunks c ON c.version_id=v.id AND c.generation=v.generation
    JOIN public.kb_catalog k ON k.scope_id=d.scope_id
    WHERE d.scope_id=p_scope AND d.deleted_at IS NULL AND v.status='PUBLISHED' AND v.removed_at IS NULL
      AND (v_role='ADMIN' OR d.audience='ADMIN_AND_STAFF')
      AND k.active_embedding_fingerprint=p_fingerprint AND v.embedding_fingerprint=p_fingerprint AND c.embedding_fingerprint=p_fingerprint
      AND 1-(c.embedding <=> p_vector)>=p_min_similarity
    ORDER BY distance LIMIT 12
  ) candidates;
  RETURN v_result;
END $$;
CREATE FUNCTION public.assistant_read_source(p_actor uuid,p_scope text,p_fingerprint text,p_version uuid,p_chunk uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_role text; v_result jsonb;
BEGIN
  SELECT role::text INTO v_role FROM public.staff_profiles WHERE user_id=p_actor AND is_active;
  IF v_role IS NULL OR v_role NOT IN ('ADMIN','STAFF') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT jsonb_build_object('document_id',d.id,'version_id',v.id,'chunk_id',c.id,'title',d.title,'heading_path',c.heading_path,'source_page',c.page_start,'epoch',k.epoch,'extraction_method',c.extraction_method,'content_hash',c.content_sha256,'content',c.content) INTO v_result
  FROM public.kb_documents d JOIN public.kb_document_versions v ON v.id=d.active_version_id AND v.document_id=d.id
  JOIN public.kb_chunks c ON c.version_id=v.id AND c.generation=v.generation JOIN public.kb_catalog k ON k.scope_id=d.scope_id
  WHERE d.scope_id=p_scope AND v.id=p_version AND c.id=p_chunk AND d.deleted_at IS NULL AND v.status='PUBLISHED' AND v.removed_at IS NULL
    AND (v_role='ADMIN' OR d.audience='ADMIN_AND_STAFF') AND k.active_embedding_fingerprint=p_fingerprint AND v.embedding_fingerprint=p_fingerprint AND c.embedding_fingerprint=p_fingerprint;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.assistant_knowledge_epoch() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.assistant_search_knowledge(uuid,text,text,extensions.vector,double precision), public.assistant_read_source(uuid,text,text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.assistant_search_knowledge(uuid,text,text,extensions.vector,double precision), public.assistant_read_source(uuid,text,text,uuid,uuid) TO service_role;
COMMIT;
