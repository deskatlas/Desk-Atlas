-- MS59 / ERD-E25: reviewed v3 overlay; original chunks/graph remain immutable.
BEGIN;
ALTER TABLE public.kb_document_versions ADD COLUMN evidence_roles jsonb;
ALTER TABLE public.kb_document_versions ADD COLUMN evidence_binding text;
ALTER FUNCTION public.kb_admin_command(text,uuid,text,uuid,jsonb) RENAME TO kb_admin_command_ms58;
REVOKE ALL ON FUNCTION public.kb_admin_command_ms58(text,uuid,text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.kb_admin_command(p_scope text,p_actor uuid,p_operation text,p_id uuid DEFAULT NULL,p_data jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE v kb_document_versions; d kb_documents; roles jsonb; result jsonb; n integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM staff_profiles WHERE user_id=p_actor AND is_active AND role='ADMIN') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_operation='publish' AND p_data ? 'evidence_review' THEN
  SELECT * INTO d FROM kb_documents WHERE id=(SELECT document_id FROM kb_document_versions WHERE id=p_id) AND scope_id=p_scope FOR UPDATE;
  IF NOT FOUND OR d.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  SELECT * INTO v FROM kb_document_versions WHERE id=p_id FOR UPDATE;
  IF v.status='READY' THEN
   roles:=p_data->'evidence_review';
   IF jsonb_typeof(roles) IS DISTINCT FROM 'object' OR NOT coalesce((p_data->>'acknowledge_evidence')::boolean,false)
    OR p_data->'document_review' IS NULL
    OR p_data->'document_review'->>'source_sha256' IS DISTINCT FROM v.source_sha256
    OR p_data->'document_review'->>'content_sha256' IS DISTINCT FROM v.content_sha256
    OR p_data->'document_review'->>'structure_manifest_sha256' IS DISTINCT FROM v.structure_manifest_sha256
    OR p_data->'document_review'->>'generation' IS DISTINCT FROM v.generation::text
    OR p_data->'document_review'->>'audience' IS DISTINCT FROM p_data->>'audience'
   THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
   SELECT count(DISTINCT section_context->>'section_id') INTO n FROM kb_chunks WHERE version_id=v.id AND generation=v.generation;
   IF n<1 OR n>1000 OR (SELECT count(*) FROM jsonb_object_keys(roles))<>n OR EXISTS(
    SELECT 1 FROM kb_chunks c WHERE c.version_id=v.id AND c.generation=v.generation AND (
     roles->>(c.section_context->>'section_id') IS NULL OR roles->>(c.section_context->>'section_id') NOT IN ('DIRECT','QUALIFICATION','CONTEXT')
     OR (roles->>(c.section_context->>'section_id')='CONTEXT' AND (
      c.section_context->>'version'<>'2' OR NOT (c.section_context->>'structure_known')::boolean
      OR (c.section_context->>'unresolved_references')::boolean
      OR c.content ~* '\m(only|unless|except|never|must|cannot|not|no|required|before|after|if|when|without|prohibited|authorize|approve|shall|should|hindi|dapat)\M'
      OR EXISTS(SELECT 1 FROM regexp_split_to_table(c.content,E'\n') line WHERE btrim(line)<>'' AND position(regexp_replace(btrim(line),'^#{1,6}\s+','') in c.heading_path)=0)
     )))) THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
  END IF;
 END IF;
 result:=kb_admin_command_ms58(p_scope,p_actor,p_operation,p_id,p_data);
 IF roles IS NOT NULL THEN
  -- The original publication function applies reviewed edges first. Bind its final manifest.
  UPDATE kb_document_versions SET evidence_roles=roles,evidence_binding=encode(digest(convert_to(source_sha256||'|'||generation||'|'||structure_manifest_sha256||'|'||roles::text,'UTF8'),'sha256'),'hex') WHERE id=p_id AND status='PUBLISHED';
  IF NOT FOUND THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.kb_admin_command(text,uuid,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kb_admin_command(text,uuid,text,uuid,jsonb) TO service_role;

-- Authenticated complete graph reader is installed below from the existing
-- expansion implementation, with only its private internal capacity increased.
-- It is never granted to clients or service_role directly.

CREATE FUNCTION public.assistant_evidence_graph_ms59(p_actor uuid,p_scope text,p_fingerprint text,p_chunks uuid[])
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
   (c.section_context IS NULL OR c.section_context->>'version' NOT IN ('1','2') OR (c.section_context->>'version'='2' AND c.section_context->>'scope'='UNREVIEWED') OR c.structure_sha256 IS NULL OR kb_structure_hash(c.section_context) IS NULL OR c.structure_sha256 IS DISTINCT FROM kb_structure_hash(c.section_context)))
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
 IF total>1000 THEN RETURN jsonb_build_object('complete',false,'reason','CONTEXT_BUDGET','sources','[]'::jsonb); END IF;
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

REVOKE ALL ON FUNCTION public.assistant_evidence_graph_ms59(uuid,text,text,uuid[]) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.assistant_project_evidence(p_actor uuid,p_scope text,p_fingerprint text,p_chunks uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE g jsonb; s jsonb; v kb_document_versions; ctx jsonb:='[]'; ops jsonb:='[]'; groups jsonb:='[]'; group_item jsonb; required jsonb; members jsonb;
BEGIN
 g:=assistant_evidence_graph_ms59(p_actor,p_scope,p_fingerprint,p_chunks);
 IF NOT (g->>'complete')::boolean THEN RETURN g; END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(g->'sources') LOOP
  SELECT * INTO v FROM kb_document_versions WHERE id=(s->>'version_id')::uuid;
  IF v.evidence_roles IS NOT NULL AND v.evidence_binding IS DISTINCT FROM encode(digest(convert_to(v.source_sha256||'|'||v.generation||'|'||v.structure_manifest_sha256||'|'||v.evidence_roles::text,'UTF8'),'sha256'),'hex') THEN RAISE EXCEPTION 'MANIFEST_INVALID'; END IF;
  IF v.evidence_roles->>(SELECT section_context->>'section_id' FROM kb_chunks WHERE id=(s->>'chunk_id')::uuid)='CONTEXT' THEN ctx:=ctx||jsonb_build_array(s);
  ELSE ops:=ops||jsonb_build_array(s); END IF;
 END LOOP;
 IF jsonb_array_length(ops)>6 OR jsonb_array_length(ctx)>12 THEN RETURN jsonb_build_object('complete',false,'reason','CONTEXT_BUDGET','sources','[]'::jsonb); END IF;
 FOR group_item IN SELECT value FROM jsonb_array_elements(g->'groups') LOOP
  SELECT coalesce(jsonb_agg(value),'[]') INTO members FROM jsonb_array_elements(group_item->'chunk_ids') WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(ops) o WHERE o->>'chunk_id'=value#>>'{}');
  IF jsonb_array_length(members)=0 THEN CONTINUE; END IF;
  SELECT coalesce(jsonb_agg(value),'[]') INTO required FROM jsonb_array_elements(group_item->'requires') WHERE EXISTS(
   SELECT 1 FROM jsonb_array_elements(g->'groups') other WHERE other->>'id'=value#>>'{}' AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(other->'chunk_ids') cid JOIN jsonb_array_elements(ops) o ON o->>'chunk_id'=cid));
  groups:=groups||jsonb_build_array(group_item||jsonb_build_object('chunk_ids',members,'requires',required));
 END LOOP;
 RETURN jsonb_build_object('complete',true,'sources',ops,'groups',groups,'context_sources',ctx);
END $$;
REVOKE ALL ON FUNCTION public.assistant_project_evidence(uuid,text,text,uuid[]) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.assistant_expand_evidence_v3(p_actor uuid,p_scope text,p_fingerprint text,p_chunks uuid[])
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
 SELECT assistant_project_evidence(p_actor,p_scope,p_fingerprint,p_chunks);
$$;
REVOKE ALL ON FUNCTION public.assistant_expand_evidence_v3(uuid,text,text,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.assistant_expand_evidence_v3(uuid,text,text,uuid[]) TO service_role;

CREATE FUNCTION public.assistant_evidence_costs(p_actor uuid,p_scope text,p_fingerprint text,p_chunks uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE g jsonb; root uuid; seen text[]; pending text[]; gid text; group_item jsonb; members jsonb; roots jsonb:='[]'; cost bigint; ep bigint;
BEGIN
 -- One authoritative manifest/graph read for all roots, never twelve remote reads.
 g:=assistant_evidence_graph_ms59(p_actor,p_scope,p_fingerprint,p_chunks);
 IF NOT (g->>'complete')::boolean THEN RAISE EXCEPTION 'UNRESOLVED_CONTEXT'; END IF;
 IF EXISTS(SELECT 1 FROM kb_document_versions v WHERE v.id IN (SELECT (s->>'version_id')::uuid FROM jsonb_array_elements(g->'sources') s)
  AND v.evidence_roles IS NOT NULL AND v.evidence_binding IS DISTINCT FROM encode(digest(convert_to(v.source_sha256||'|'||v.generation||'|'||v.structure_manifest_sha256||'|'||v.evidence_roles::text,'UTF8'),'sha256'),'hex')) THEN RAISE EXCEPTION 'MANIFEST_INVALID'; END IF;
 SELECT epoch INTO ep FROM kb_catalog WHERE scope_id=p_scope;
 FOREACH root IN ARRAY p_chunks LOOP
  SELECT ARRAY[value->>'id'] INTO pending FROM jsonb_array_elements(g->'groups') WHERE value->'chunk_ids' ? root::text;
  seen:=ARRAY[]::text[];
  WHILE cardinality(pending)>0 LOOP
   gid:=pending[1]; pending:=pending[2:];
   IF gid=ANY(seen) THEN CONTINUE; END IF;
   seen:=array_append(seen,gid);
   IF cardinality(seen)>1000 THEN RAISE EXCEPTION 'UNRESOLVED_CONTEXT'; END IF;
   SELECT value INTO group_item FROM jsonb_array_elements(g->'groups') WHERE value->>'id'=gid;
   IF group_item IS NULL THEN RAISE EXCEPTION 'UNRESOLVED_CONTEXT'; END IF;
   pending:=pending||ARRAY(SELECT jsonb_array_elements_text(group_item->'requires'));
  END LOOP;
  SELECT coalesce(jsonb_agg(cid),'[]') INTO members FROM jsonb_array_elements(g->'groups') u CROSS JOIN LATERAL jsonb_array_elements_text(u->'chunk_ids') cid WHERE u->>'id'=ANY(seen);
  SELECT coalesce(sum(octet_length(s::text)),0) INTO cost FROM jsonb_array_elements(g->'sources') s WHERE members ? (s->>'chunk_id');
  -- Context bytes remain included; only operative identities consume source slots.
  SELECT coalesce(jsonb_agg(cid),'[]') INTO members FROM jsonb_array_elements_text(members) cid JOIN kb_chunks c ON c.id=cid::uuid JOIN kb_document_versions v ON v.id=c.version_id
   WHERE coalesce(v.evidence_roles->>(c.section_context->>'section_id'),'QUALIFICATION')<>'CONTEXT';
  roots:=roots||jsonb_build_array(jsonb_build_object('chunk_id',root,'complete',true,'members',members,'source_count',jsonb_array_length(members),'bytes',cost));
 END LOOP;
 RETURN jsonb_build_object('version',3,'epoch',ep,'roots',roots);
END $$;
REVOKE ALL ON FUNCTION public.assistant_evidence_costs(uuid,text,text,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.assistant_evidence_costs(uuid,text,text,uuid[]) TO service_role;
COMMIT;
