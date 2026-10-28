-- PRD-F26 / SDD-C21,C23 / QAD-TC44-TC46: exact original-unit serving transport v2.
BEGIN;
CREATE OR REPLACE FUNCTION assistant_prepared_catalog(p_actor uuid,p_scope text,p_fingerprint text,p_compiler_fingerprint text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE role_name text; ep bigint; n integer; result jsonb;
BEGIN
 SELECT role::text INTO role_name FROM staff_profiles WHERE user_id=p_actor AND is_active;
 IF role_name IS NULL OR role_name NOT IN ('ADMIN','STAFF') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT epoch INTO ep FROM kb_catalog WHERE scope_id=p_scope AND active_embedding_fingerprint=p_fingerprint;
 IF ep IS NULL THEN RAISE EXCEPTION 'FINGERPRINT_MISMATCH'; END IF;
 SELECT count(*) INTO n FROM kb_documents d JOIN kb_document_versions v ON v.id=d.active_version_id
  WHERE d.scope_id=p_scope AND d.deleted_at IS NULL AND v.status='PUBLISHED'
   AND ((role_name='ADMIN' AND d.audience='ADMIN_ONLY') OR d.audience='ADMIN_AND_STAFF');
 SELECT coalesce(jsonb_agg(jsonb_build_object('document_id',d.id,'version_id',v.id,'title',d.title,
  'artifact_sha256',a.artifact_sha256,'source_binding',a.artifact_text::jsonb->>'source_binding',
  'groups',a.artifact_text::jsonb->'groups') ORDER BY d.id),'[]') INTO result
  FROM kb_documents d JOIN kb_document_versions v ON v.id=d.active_version_id JOIN kb_support_artifacts a
   ON a.version_id=v.id AND a.generation=v.generation AND a.source_manifest=v.manifest_sha256
    AND a.structure_manifest IS NOT DISTINCT FROM v.structure_manifest_sha256 AND a.embedding_fingerprint=p_fingerprint
  WHERE d.scope_id=p_scope AND d.deleted_at IS NULL AND v.status='PUBLISHED'
   AND ((role_name='ADMIN' AND d.audience='ADMIN_ONLY') OR d.audience='ADMIN_AND_STAFF')
   AND (p_compiler_fingerprint IS NULL OR a.stats->>'compiler_fingerprint'=p_compiler_fingerprint)
   AND a.artifact_sha256=encode(digest(convert_to(a.artifact_text,'UTF8'),'sha256'),'hex');
 RETURN jsonb_build_object('contract','ragfix-prepared-v1','epoch',ep,'complete',n>0 AND n=jsonb_array_length(result),'documents',result);
END $$;

CREATE OR REPLACE FUNCTION assistant_prepared_evidence(p_actor uuid,p_scope text,p_fingerprint text,p_selections jsonb,p_compiler_fingerprint text DEFAULT NULL)
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
COMMIT;
