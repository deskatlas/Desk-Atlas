-- MS77-R03 / ERD-E23: fixed atomic public quotas and shared customer permits.
BEGIN;
ALTER TABLE public.rate_limit_events DROP CONSTRAINT rate_limit_events_scope_check;
ALTER TABLE public.rate_limit_events ADD CONSTRAINT rate_limit_events_scope_check CHECK (scope IN (
 'VERIFY_IP','VERIFY_EMAIL','CUSTOMER_TOKEN','PROMO_IP','PROMO_EMAIL','EMAIL_CUSTOMER','EMAIL_VOUCHER',
 'PUBLIC_ASSISTANT_IP','PUBLIC_ASSISTANT_VISITOR'));
CREATE FUNCTION public.admit_public_assistant(p_ip text,p_visitor text,p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE t timestamptz:=clock_timestamp(); ip_count int; visitor_count int; retry int;
BEGIN
 IF p_ip IS NULL OR p_ip !~ '^[a-f0-9]{64}$' OR p_visitor IS NULL OR p_visitor !~ '^[a-f0-9]{64}$' OR p_request IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('public-assistant-ip:'||p_ip,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('public-assistant-visitor:'||p_visitor,0));
 DELETE FROM rate_limit_events WHERE id IN (SELECT id FROM rate_limit_events
  WHERE scope IN ('PUBLIC_ASSISTANT_IP','PUBLIC_ASSISTANT_VISITOR') AND created_at<t-interval '1 hour' ORDER BY created_at LIMIT 100);
 SELECT count(*) INTO ip_count FROM rate_limit_events WHERE scope='PUBLIC_ASSISTANT_IP' AND subject_hash=p_ip AND created_at>t-interval '10 minutes';
 SELECT count(*) INTO visitor_count FROM rate_limit_events WHERE scope='PUBLIC_ASSISTANT_VISITOR' AND subject_hash=p_visitor AND created_at>t-interval '1 hour';
 IF ip_count>=10 OR visitor_count>=30 THEN
  SELECT greatest(1,ceil(max(extract(epoch FROM created_at+CASE scope WHEN 'PUBLIC_ASSISTANT_IP' THEN interval '10 minutes' ELSE interval '1 hour' END-t))))::int INTO retry
   FROM (SELECT scope,min(created_at) created_at FROM rate_limit_events WHERE
    (ip_count>=10 AND scope='PUBLIC_ASSISTANT_IP' AND subject_hash=p_ip AND created_at>t-interval '10 minutes') OR
    (visitor_count>=30 AND scope='PUBLIC_ASSISTANT_VISITOR' AND subject_hash=p_visitor AND created_at>t-interval '1 hour') GROUP BY scope) q;
  RETURN jsonb_build_object('allowed',false,'retry_after',retry);
 END IF;
 INSERT INTO rate_limit_events(scope,subject_hash,request_id,created_at) VALUES
  ('PUBLIC_ASSISTANT_IP',p_ip,p_request,t),('PUBLIC_ASSISTANT_VISITOR',p_visitor,p_request,t);
 RETURN jsonb_build_object('allowed',true);
END $$;
REVOKE ALL ON FUNCTION public.admit_public_assistant(text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admit_public_assistant(text,text,uuid) TO service_role;

ALTER FUNCTION public.customer_assistant_control(text,text,text,text,uuid,uuid,uuid,text) RENAME TO customer_assistant_control_ms76;
REVOKE ALL ON FUNCTION public.customer_assistant_control_ms76(text,text,text,text,uuid,uuid,uuid,text) FROM service_role;
CREATE FUNCTION public.customer_assistant_control(p_operation text,p_scope text,p_principal text,p_subject text,
 p_request uuid,p_session uuid,p_generation uuid,p_stage text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF p_operation='claim' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('customer-assistant:'||p_scope,0));
  IF (SELECT count(*) FROM customer_assistant_controls WHERE scope_id=p_scope AND permit_until>clock_timestamp() AND NOT cancelled AND stage<>'complete')>=2
   THEN RAISE EXCEPTION 'RATE_LIMITED'; END IF;
 END IF;
 RETURN customer_assistant_control_ms76(p_operation,p_scope,p_principal,p_subject,p_request,p_session,p_generation,p_stage);
END $$;
REVOKE ALL ON FUNCTION public.customer_assistant_control(text,text,text,text,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.customer_assistant_control(text,text,text,text,uuid,uuid,uuid,text) TO service_role;

-- PRD-F1-F4: one bounded, stable query over active instances on published maps.
CREATE FUNCTION public.customer_spot_candidates(p_ids uuid[] DEFAULT NULL,p_template uuid DEFAULT NULL,p_floor uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF p_ids IS NOT NULL AND cardinality(p_ids)>3 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY workspace_id),'[]'::jsonb) INTO result FROM (
  SELECT w.id workspace_id,w.template_id,w.floor_id,m.id map_version_id,w.display_name name,t.capacity,t.rate_amount hourly_rate
  FROM workspace_instances w JOIN workspace_templates t ON t.id=w.template_id JOIN floors f ON f.id=w.floor_id
  JOIN map_versions m ON m.floor_id=f.id AND m.status='PUBLISHED'
  WHERE w.operational_status='ACTIVE' AND t.is_active AND f.is_active
   AND (p_ids IS NULL OR w.id=ANY(p_ids)) AND (p_template IS NULL OR w.template_id=p_template) AND (p_floor IS NULL OR w.floor_id=p_floor)
   AND EXISTS(SELECT 1 FROM map_elements e WHERE e.map_version_id=m.id AND e.workspace_instance_id=w.id AND e.element_role='WORKSPACE')
  ORDER BY w.id LIMIT 13
 ) q;
 RETURN jsonb_build_object('spots',result,'has_more',jsonb_array_length(result)>12);
END $$;
REVOKE ALL ON FUNCTION public.customer_spot_candidates(uuid[],uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.customer_spot_candidates(uuid[],uuid,uuid) TO service_role;
COMMIT;
