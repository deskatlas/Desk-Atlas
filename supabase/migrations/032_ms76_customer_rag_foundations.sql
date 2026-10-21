-- MS76-R02/R04 / SDD-C20-C24 / ERD-E22-E29 / MS76-TC01-TC12.
BEGIN;
ALTER TABLE public.kb_documents DROP CONSTRAINT kb_documents_audience_check;
ALTER TABLE public.kb_documents ADD CONSTRAINT kb_documents_audience_check
 CHECK (audience IN ('ADMIN_ONLY','ADMIN_AND_STAFF','PUBLIC_CUSTOMER','VERIFIED_CUSTOMER'));
ALTER TABLE public.customer_access_challenges DROP CONSTRAINT customer_access_challenges_purpose_check;
ALTER TABLE public.customer_access_challenges ADD CONSTRAINT customer_access_challenges_purpose_check
 CHECK (purpose IN ('REWARDS_ACCESS','REWARDS_AND_ASSISTANT_ACCESS'));

CREATE FUNCTION public.kb_customer_version_valid(p_version uuid,p_fingerprint text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM kb_document_versions v WHERE v.id=p_version
  AND v.status='PUBLISHED' AND v.removed_at IS NULL AND v.published_at IS NOT NULL
  AND v.embedding_fingerprint=p_fingerprint AND v.expected_chunk_count>0 AND v.chunk_count=v.expected_chunk_count
  AND ((v.review_acknowledged AND v.reviewed_by IS NOT NULL AND v.reviewed_at IS NOT NULL)
   OR coalesce(v.system_verification->>'policy'='kb-auto-v1'
    AND v.system_verification->>'generation'=v.generation::text
    AND v.system_verification->>'source_sha256'=v.source_sha256
    AND v.system_verification->>'content_sha256'=v.content_sha256
    AND v.system_verification->>'manifest_sha256'=v.manifest_sha256
    AND v.system_verification->>'parser_fingerprint'=v.parser_fingerprint
    AND v.system_verification->>'structure_manifest_sha256'=v.structure_manifest_sha256
    AND v.system_verification->>'embedding_fingerprint'=v.embedding_fingerprint,false))
  AND (SELECT count(*)=v.expected_chunk_count AND min(c.ordinal)=0 AND max(c.ordinal)=v.expected_chunk_count-1
    AND bool_and(c.embedding_fingerprint=p_fingerprint AND c.content_sha256=encode(digest(convert_to(c.content,'UTF8'),'sha256'),'hex'))
    AND v.manifest_sha256=encode(digest(convert_to(string_agg(c.content_sha256,'' ORDER BY c.ordinal),'UTF8'),'sha256'),'hex')
    FROM kb_chunks c WHERE c.version_id=v.id AND c.generation=v.generation));
$$;
REVOKE ALL ON FUNCTION kb_customer_version_valid(uuid,text) FROM PUBLIC,anon,authenticated,service_role;

-- Amend the installed lifecycle implementations, including renamed wrappers,
-- without replacing their generation, lease or publication verification logic.
DO $migration$
DECLARE f record; definition text; principal text;
BEGIN
 FOR f IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND (p.proname LIKE 'kb_admin_command%' OR p.proname LIKE 'kb_worker_command%' OR p.proname='kb_try_auto_publish')
 LOOP
  definition:=pg_get_functiondef(f.oid);
  definition:=replace(definition,'''ADMIN_ONLY'',''ADMIN_AND_STAFF''','''ADMIN_ONLY'',''ADMIN_AND_STAFF'',''PUBLIC_CUSTOMER'',''VERIFIED_CUSTOMER''');
  EXECUTE definition;
 END LOOP;
 -- Every internal retrieval route, including private expansion helpers, uses
 -- the same exact matrix. Admin management functions above retain all access.
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND (p.proname LIKE 'assistant_%' OR p.proname='kb_search')
 LOOP
  definition:=pg_get_functiondef(f.oid);
  definition:=replace(definition,'(a.role=''ADMIN'' OR (a.role=''STAFF'' AND d.audience=''ADMIN_AND_STAFF''))',
   '((a.role=''ADMIN'' AND d.audience=''ADMIN_ONLY'') OR (a.role IN (''ADMIN'',''STAFF'') AND d.audience=''ADMIN_AND_STAFF''))');
  FOREACH principal IN ARRAY ARRAY['v_role','role_name','actor_role'] LOOP
   definition:=replace(definition,'('||principal||'=''ADMIN'' OR d.audience=''ADMIN_AND_STAFF'')',
    '(('||principal||'=''ADMIN'' AND d.audience=''ADMIN_ONLY'') OR ('||principal||' IN (''ADMIN'',''STAFF'') AND d.audience=''ADMIN_AND_STAFF''))');
  END LOOP;
  EXECUTE definition;
 END LOOP;
END $migration$;

-- Narrow customer readers reuse the installed canonical verification and
-- whole-document expansion. Only service_role may resolve customer authority.
-- No synthetic staff profile, callback or browser-supplied role is used.
DO $migration$
DECLARE f record; definition text; principal text; target text; args text;
BEGIN
 FOR f IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('assistant_knowledge_availability','assistant_search_knowledge','assistant_search_hybrid','assistant_read_source','assistant_document_evidence')
  ORDER BY CASE p.proname WHEN 'assistant_read_source' THEN 0 ELSE 1 END
 LOOP
  target:=replace(f.proname,'assistant_','customer_');
  definition:=pg_get_functiondef(f.oid);
  definition:=replace(definition,'FUNCTION public.'||f.proname||'(p_actor uuid,','FUNCTION public.'||target||'(p_actor uuid, p_principal text,');
  FOREACH principal IN ARRAY ARRAY['v_role','role_name','actor_role'] LOOP
   definition:=regexp_replace(definition,'SELECT role::text INTO '||principal||' FROM (public\.)?staff_profiles WHERE user_id=p_actor AND is_active;',
    principal||':=p_principal;');
   definition:=replace(definition,principal||' NOT IN (''ADMIN'',''STAFF'')',principal||' NOT IN (''PUBLIC_VISITOR'',''VERIFIED_CUSTOMER'')');
   definition:=replace(definition,'(('||principal||'=''ADMIN'' AND d.audience=''ADMIN_ONLY'') OR ('||principal||' IN (''ADMIN'',''STAFF'') AND d.audience=''ADMIN_AND_STAFF''))',
    '(d.audience=''PUBLIC_CUSTOMER'' OR ('||principal||'=''VERIFIED_CUSTOMER'' AND d.audience=''VERIFIED_CUSTOMER''))');
  END LOOP;
  definition:=replace(definition,'assistant_read_source(p_actor,p_scope','customer_read_source(p_actor,p_principal,p_scope');
  -- Canonical verification applies before any customer title or content leaves
  -- search/source APIs, as well as during whole-document admission.
  definition:=replace(definition,'d.scope_id=p_scope AND','d.scope_id=p_scope AND kb_customer_version_valid(v.id,p_fingerprint) AND');
  EXECUTE definition;
  args:=replace(pg_get_function_identity_arguments(f.oid),'p_actor uuid,','p_actor uuid, p_principal text,');
  EXECUTE 'REVOKE ALL ON FUNCTION public.'||target||'('||args||') FROM PUBLIC,anon,authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.'||target||'('||args||') TO service_role';
 END LOOP;
END $migration$;

CREATE TABLE public.customer_assistant_controls (
 request_id uuid PRIMARY KEY, session_id uuid NOT NULL, generation uuid NOT NULL,
 scope_id text NOT NULL, principal text NOT NULL CHECK(principal IN ('PUBLIC_VISITOR','VERIFIED_CUSTOMER')),
 subject_digest text NOT NULL CHECK(subject_digest ~ '^[a-f0-9]{64}$'),
 stage text NOT NULL DEFAULT 'checking' CHECK(stage IN ('checking','retrieving','preparing','complete')),
 deadline timestamptz NOT NULL, cancelled boolean NOT NULL DEFAULT false,
 permit_until timestamptz NOT NULL
);
CREATE INDEX customer_assistant_controls_owner ON public.customer_assistant_controls(scope_id,subject_digest,deadline);
ALTER TABLE public.customer_assistant_controls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_assistant_controls FROM PUBLIC,anon,authenticated,service_role;

-- Fixed server limits cannot be weakened through request input. One owner has
-- one live permit and at most ten admissions per minute; each business has four.
CREATE FUNCTION public.customer_assistant_control(p_operation text,p_scope text,p_principal text,p_subject text,
 p_request uuid,p_session uuid,p_generation uuid,p_stage text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r customer_assistant_controls; t timestamptz:=clock_timestamp();
BEGIN
 IF p_operation IS NULL OR p_operation NOT IN ('claim','progress','cancel','stage','release','check') THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 IF p_scope IS NULL OR length(p_scope) NOT BETWEEN 1 AND 200 OR p_principal IS NULL
  OR p_principal NOT IN ('PUBLIC_VISITOR','VERIFIED_CUSTOMER') OR p_subject IS NULL OR p_subject !~ '^[a-f0-9]{64}$'
  OR p_request IS NULL OR p_session IS NULL OR p_generation IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_operation='claim' THEN
  -- Serializes admission across gateway replicas without table-wide locks.
  PERFORM pg_advisory_xact_lock(hashtextextended('customer-assistant:'||p_scope,0));
  DELETE FROM customer_assistant_controls WHERE request_id IN
   (SELECT request_id FROM customer_assistant_controls WHERE deadline<t-interval '2 minutes' ORDER BY deadline LIMIT 100);
  IF EXISTS(SELECT 1 FROM customer_assistant_controls WHERE request_id=p_request) THEN RAISE EXCEPTION 'REQUEST_REPLAY'; END IF;
  IF (SELECT count(*) FROM customer_assistant_controls WHERE scope_id=p_scope AND permit_until>t AND NOT cancelled AND stage<>'complete')>=4
   OR EXISTS(SELECT 1 FROM customer_assistant_controls WHERE scope_id=p_scope AND subject_digest=p_subject AND permit_until>t AND NOT cancelled AND stage<>'complete')
   OR (SELECT count(*) FROM customer_assistant_controls WHERE scope_id=p_scope AND subject_digest=p_subject AND deadline>t+interval '1 minute')>=10
  THEN RAISE EXCEPTION 'RATE_LIMITED'; END IF;
  -- Deadline is also a short replay/quota tombstone. Permit expires after 60s.
  INSERT INTO customer_assistant_controls VALUES(p_request,p_session,p_generation,p_scope,p_principal,p_subject,'checking',t+interval '2 minutes',false,t+interval '60 seconds') RETURNING * INTO r;
 ELSE
  SELECT * INTO r FROM customer_assistant_controls WHERE request_id=p_request AND session_id=p_session AND generation=p_generation
   AND scope_id=p_scope AND principal=p_principal AND subject_digest=p_subject AND deadline>t FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF p_operation='cancel' THEN
   UPDATE customer_assistant_controls SET cancelled=true,permit_until=t WHERE request_id=r.request_id RETURNING * INTO r;
  ELSIF p_operation='release' THEN
   UPDATE customer_assistant_controls SET stage='complete',permit_until=t WHERE request_id=r.request_id RETURNING * INTO r;
  ELSIF p_operation='stage' THEN
   IF p_stage NOT IN ('checking','retrieving','preparing') OR p_stage IS NULL OR r.cancelled OR r.permit_until<=t OR r.stage='complete' THEN RAISE EXCEPTION 'REQUEST_CANCELLED'; END IF;
   UPDATE customer_assistant_controls SET stage=p_stage WHERE request_id=r.request_id RETURNING * INTO r;
  ELSIF p_operation NOT IN ('check','progress') THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 END IF;
 RETURN jsonb_build_object('stage',r.stage,'cancelled',r.cancelled OR r.permit_until<=t);
END $$;
REVOKE ALL ON FUNCTION customer_assistant_control(text,text,text,text,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION customer_assistant_control(text,text,text,text,uuid,uuid,uuid,text) TO service_role;
COMMIT;
