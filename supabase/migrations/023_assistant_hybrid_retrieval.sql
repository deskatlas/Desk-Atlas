-- MS55-TC05/06/09; SDD-C20/C21, ERD-E24..29. No publication changes.
BEGIN;
ALTER TABLE public.kb_chunks
 ADD COLUMN lexical_simple tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig,heading_path||' '||content)) STORED,
 ADD COLUMN lexical_english tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig,heading_path||' '||content)) STORED;
CREATE INDEX kb_chunks_lexical_simple ON public.kb_chunks USING gin(lexical_simple);
CREATE INDEX kb_chunks_lexical_english ON public.kb_chunks USING gin(lexical_english);

-- An OR query admits partial natural-language matches; it does not assert
-- support. English stemming and language-neutral tokens compete by rank.
CREATE FUNCTION public.assistant_lexical_query(p_query text,p_config regconfig)
RETURNS tsquery LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT coalesce(string_agg(quote_literal(word),' | '),'')::tsquery
 FROM unnest(tsvector_to_array(to_tsvector(p_config,p_query))) word
$$;

CREATE FUNCTION public.assistant_search_hybrid(p_actor uuid,p_scope text,p_fingerprint text,p_vectors jsonb,p_queries text[],p_min_similarity double precision)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE actor_role text; result jsonb; value jsonb; query_vector extensions.vector(1024);
BEGIN
 SELECT role::text INTO actor_role FROM staff_profiles WHERE user_id=p_actor AND is_active;
 IF actor_role IS NULL OR actor_role NOT IN ('ADMIN','STAFF') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_vectors IS NULL OR jsonb_typeof(p_vectors)<>'array' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 IF coalesce(cardinality(p_queries),0) NOT BETWEEN 1 AND 4 OR jsonb_array_length(p_vectors)<>cardinality(p_queries)
  OR p_min_similarity IS NULL OR p_min_similarity NOT BETWEEN -1 AND 1
  OR EXISTS(SELECT 1 FROM unnest(p_queries) q WHERE q IS NULL OR length(trim(q)) NOT BETWEEN 1 AND 3000) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 FOR value IN SELECT * FROM jsonb_array_elements(p_vectors) LOOP
  IF jsonb_typeof(value)<>'array' OR jsonb_array_length(value)<>1024 THEN RAISE EXCEPTION 'INVALID_VECTOR'; END IF;
  query_vector:=value::text::extensions.vector;
  IF vector_dims(query_vector)<>1024 OR abs(vector_norm(query_vector)-1)>0.001 THEN RAISE EXCEPTION 'INVALID_VECTOR'; END IF;
 END LOOP;
 WITH versions AS MATERIALIZED (
  SELECT v.*,d.title,d.id did,k.epoch FROM kb_documents d
  JOIN kb_document_versions v ON v.id=d.active_version_id AND v.document_id=d.id
  JOIN kb_catalog k ON k.scope_id=d.scope_id
  WHERE d.scope_id=p_scope AND d.deleted_at IS NULL AND v.status='PUBLISHED' AND v.removed_at IS NULL
   AND (actor_role='ADMIN' OR d.audience='ADMIN_AND_STAFF')
   AND k.active_embedding_fingerprint=p_fingerprint AND v.embedding_fingerprint=p_fingerprint
   AND v.expected_chunk_count>0 AND v.chunk_count=v.expected_chunk_count AND v.parser_fingerprint IS NOT NULL AND v.content_sha256 IS NOT NULL
   AND (SELECT count(*)=v.expected_chunk_count AND min(c.ordinal)=0 AND max(c.ordinal)=v.expected_chunk_count-1
     AND bool_and(c.embedding_fingerprint=p_fingerprint AND c.content_sha256=encode(digest(convert_to(c.content,'UTF8'),'sha256'),'hex'))
     AND v.manifest_sha256=encode(digest(convert_to(string_agg(c.content_sha256,'' ORDER BY c.ordinal),'UTF8'),'sha256'),'hex')
     FROM kb_chunks c WHERE c.version_id=v.id AND c.generation=v.generation)
 ), eligible AS MATERIALIZED (
  SELECT c.id,c.embedding,c.lexical_simple||to_tsvector('simple',v.title) simple_text,
   c.lexical_english||to_tsvector('english',v.title) english_text,
   jsonb_build_object('document_id',v.did,'version_id',v.id,'chunk_id',c.id,'title',v.title,'heading_path',c.heading_path,
    'source_page',c.page_start,'epoch',v.epoch,'extraction_method',c.extraction_method,'content_hash',c.content_sha256,'content',c.content) item
  FROM versions v JOIN kb_chunks c ON c.version_id=v.id AND c.generation=v.generation AND c.embedding_fingerprint=p_fingerprint
 ), queries AS (
  SELECT q.ordinality pos,(p_vectors->(q.ordinality::integer-1))::text::extensions.vector vec,
   assistant_lexical_query(q.text,'simple') simple_query,assistant_lexical_query(q.text,'english') english_query
  FROM unnest(p_queries) WITH ORDINALITY q(text,ordinality)
 ), branches AS (
  SELECT q.pos,
   (SELECT coalesce(jsonb_agg(s.item ORDER BY s.distance,s.id),'[]') FROM
    (SELECT e.item,e.id,e.embedding <=> q.vec distance FROM eligible e
     WHERE 1-(e.embedding <=> q.vec)>=p_min_similarity ORDER BY distance,e.id LIMIT 12) s) semantic,
   (SELECT coalesce(jsonb_agg(l.item ORDER BY l.score DESC,l.id),'[]') FROM
    (SELECT e.item,e.id,greatest(ts_rank_cd(e.simple_text,q.simple_query),ts_rank_cd(e.english_text,q.english_query)) score
     FROM eligible e WHERE e.simple_text@@q.simple_query OR e.english_text@@q.english_query
     ORDER BY score DESC,e.id LIMIT 12) l) lexical
  FROM queries q
 ) SELECT jsonb_build_object('semantic',jsonb_agg(semantic ORDER BY pos),'lexical',jsonb_agg(lexical ORDER BY pos)) INTO result FROM branches;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.assistant_lexical_query(text,regconfig),public.assistant_search_hybrid(uuid,text,text,jsonb,text[],double precision) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.assistant_search_hybrid(uuid,text,text,jsonb,text[],double precision) TO service_role;
COMMIT;
