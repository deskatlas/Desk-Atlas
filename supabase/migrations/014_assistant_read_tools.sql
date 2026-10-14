-- SPEC-4: PRD-F26, SDD-C22, ERD-E1/E2/E6/E10/E11/E13, QAD-TC44.
-- Additive, read-only aggregate gateway. Never changes booking/payment state.
BEGIN;
CREATE OR REPLACE FUNCTION public.assistant_read_tool(p_actor uuid, p_tool text, p_args jsonb, p_start timestamptz, p_end timestamptz, p_as_of timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role text; v_tz text; v_rows jsonb; v_columns jsonb; v_title text; v_limits jsonb := '[]'; v_total integer;
BEGIN
  SELECT role::text INTO v_role FROM public.staff_profiles WHERE user_id = p_actor AND is_active;
  IF v_role IS NULL OR v_role NOT IN ('STAFF','ADMIN') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_tool NOT IN ('operational_snapshot','workspace_availability','booking_report','payment_report','workspace_usage_report','operational_report') THEN RAISE EXCEPTION 'UNSUPPORTED_REPORT'; END IF;
  IF v_role <> 'ADMIN' AND p_tool NOT IN ('operational_snapshot','workspace_availability') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_start >= p_end OR p_end - p_start > interval '367 days' THEN RAISE EXCEPTION 'UNSUPPORTED_REPORT'; END IF;
  SELECT timezone INTO STRICT v_tz FROM public.business_settings WHERE id = 1;
  IF p_args ? 'floor_id' AND NOT EXISTS(SELECT 1 FROM public.floors WHERE id = (p_args->>'floor_id')::uuid) THEN RAISE EXCEPTION 'UNSUPPORTED_REPORT'; END IF;
  IF p_args ? 'template_id' AND NOT EXISTS(SELECT 1 FROM public.workspace_templates WHERE id = (p_args->>'template_id')::uuid) THEN RAISE EXCEPTION 'UNSUPPORTED_REPORT'; END IF;
  IF p_args ? 'desk_id' AND NOT EXISTS(SELECT 1 FROM public.workspace_instances WHERE id = (p_args->>'desk_id')::uuid) THEN RAISE EXCEPTION 'UNSUPPORTED_REPORT'; END IF;
  IF p_args ? 'method_id' AND NOT EXISTS(SELECT 1 FROM public.payment_methods WHERE id = (p_args->>'method_id')::uuid) THEN RAISE EXCEPTION 'UNSUPPORTED_REPORT'; END IF;

  IF p_tool = 'operational_snapshot' THEN
    -- Staff cannot move this window with supplied dates. Counts use the frozen business day.
    WITH facts AS (
      SELECT r.status, r.checked_in_at, r.checked_out_at, c.workspace_instance_id, c.start_at, c.end_at, c.is_assigned
      FROM public.reservations r
      JOIN LATERAL (SELECT * FROM public.reservation_candidates c WHERE c.reservation_id = r.id ORDER BY c.is_assigned DESC,c.rank LIMIT 1) c ON true
      JOIN public.workspace_instances w ON w.id = c.workspace_instance_id
      WHERE NOT p_args ? 'floor_id' OR w.floor_id = (p_args->>'floor_id')::uuid
    ) SELECT jsonb_build_array(jsonb_build_array(
      count(*) FILTER (WHERE status IN ('CONFIRMED','CHECKED_IN','COMPLETED') AND (start_at AT TIME ZONE v_tz)::date = (p_as_of AT TIME ZONE v_tz)::date),
      count(*) FILTER (WHERE is_assigned AND status = 'CHECKED_IN' AND checked_in_at <= p_as_of AND checked_out_at IS NULL AND start_at <= p_as_of AND end_at > p_as_of),
      count(DISTINCT workspace_instance_id) FILTER (WHERE is_assigned AND status = 'CONFIRMED' AND start_at <= p_as_of AND end_at > p_as_of),
      count(DISTINCT workspace_instance_id) FILTER (WHERE is_assigned AND status = 'CHECKED_IN' AND checked_in_at <= p_as_of AND checked_out_at IS NULL AND start_at <= p_as_of AND end_at > p_as_of)
    )) INTO v_rows FROM facts;
    v_title := 'Current operational snapshot'; v_columns := '["Today qualifying scheduled bookings","Current check-ins","Reserved desks now","In-use desks now"]';
    v_limits := '["Scheduled starts use the current candidate schedule; historical moves cannot be reconstructed.","Available now requires an explicit interval."]';
  ELSIF p_tool = 'workspace_availability' THEN
    SELECT jsonb_agg(jsonb_build_array(w.id::text,w.display_name,
      CASE WHEN w.operational_status <> 'ACTIVE' OR NOT t.is_active THEN 'UNAVAILABLE'
      WHEN EXISTS(SELECT 1 FROM public.schedule_blocks b WHERE (b.scope = 'BUSINESS' OR b.workspace_instance_id = w.id) AND b.start_at < (p_args->>'end_at')::timestamptz AND b.end_at > (p_args->>'start_at')::timestamptz) THEN 'UNAVAILABLE'
      WHEN EXISTS(SELECT 1 FROM public.reservation_candidates c JOIN public.reservations r ON r.id=c.reservation_id WHERE c.workspace_instance_id=w.id AND c.is_assigned AND r.status IN ('CONFIRMED','CHECKED_IN') AND c.start_at < (p_args->>'end_at')::timestamptz AND c.end_at > (p_args->>'start_at')::timestamptz) THEN 'UNAVAILABLE'
      WHEN EXISTS(SELECT 1 FROM generate_series(((p_args->>'start_at')::timestamptz AT TIME ZONE v_tz)::date, (((p_args->>'end_at')::timestamptz - interval '1 microsecond') AT TIME ZONE v_tz)::date, interval '1 day') d
        WHERE NOT EXISTS(SELECT 1 FROM public.operating_hours h WHERE h.is_active AND h.day_of_week=extract(dow FROM d) AND h.opens_at < h.closes_at
          AND greatest((p_args->>'start_at')::timestamptz, d::date::timestamp AT TIME ZONE v_tz) >= (d::date+h.opens_at) AT TIME ZONE v_tz
          AND least((p_args->>'end_at')::timestamptz, (d::date+1)::timestamp AT TIME ZONE v_tz) <= (d::date+h.closes_at) AT TIME ZONE v_tz)) THEN 'UNAVAILABLE'
      ELSE 'AVAILABLE' END) ORDER BY w.id) INTO v_rows
    FROM public.workspace_instances w JOIN public.workspace_templates t ON t.id=w.template_id WHERE (NOT p_args ? 'floor_id' OR w.floor_id=(p_args->>'floor_id')::uuid)
      AND (NOT p_args ? 'template_id' OR w.template_id=(p_args->>'template_id')::uuid) AND (NOT p_args ? 'desk_id' OR w.id=(p_args->>'desk_id')::uuid);
    v_title := 'Workspace availability'; v_columns := '["Desk ID","Desk","Availability"]';
    v_limits := '["Read-only availability creates no hold. Overnight operating schedules require manual verification; conservative availability is shown."]';
  ELSIF p_tool = 'payment_report' THEN
    SELECT jsonb_agg(jsonb_build_array(bucket,currency,amount::text,n) ORDER BY bucket,currency) INTO v_rows FROM (
      SELECT to_char(date_trunc(coalesce(p_args->>'grouping','day'), p.processed_at AT TIME ZONE v_tz),'YYYY-MM-DD') bucket,
        r.currency::text currency, sum(p.amount)::numeric(20,2) amount, count(*) n
      FROM public.payment_attempts p JOIN public.reservations r ON r.id=p.reservation_id
      LEFT JOIN LATERAL (SELECT * FROM public.reservation_candidates c WHERE c.reservation_id=r.id ORDER BY c.is_assigned DESC,c.rank LIMIT 1) c ON true
      LEFT JOIN public.workspace_instances w ON w.id=c.workspace_instance_id
      WHERE p.status='APPROVED' AND p.processed_at >= p_start AND p.processed_at < least(p_end,p_as_of)
        AND (NOT p_args ? 'source' OR r.source::text=p_args->>'source')
        AND (NOT p_args ? 'method_id' OR p.payment_method_id=(p_args->>'method_id')::uuid)
        AND (NOT p_args ? 'floor_id' OR w.floor_id=(p_args->>'floor_id')::uuid)
        AND (NOT p_args ? 'template_id' OR w.template_id=(p_args->>'template_id')::uuid)
        AND (NOT p_args ? 'desk_id' OR w.id=(p_args->>'desk_id')::uuid)
      GROUP BY bucket,r.currency
    ) totals;
    v_title := 'Verified initial booking payments received'; v_columns := '["Period","Currency","Amount received","Approved records"]';
    v_limits := '["Extension receipts excluded/not fully captured. Refund coverage is unknown; this is not net revenue.","Desk attribution uses current candidates. Historical attribution is unavailable.","Discount ledger reconciliation is unavailable. Amounts are actual approved payment records, not reservation amount due."]';
  ELSIF p_tool = 'operational_report' AND p_args->>'metric' = 'review_backlog' THEN
    IF p_args ?| ARRAY['source','floor_id','template_id','desk_id','statuses','start_date','end_date','period'] THEN RAISE EXCEPTION 'UNSUPPORTED_REPORT'; END IF;
    SELECT jsonb_build_array(jsonb_build_array(count(*),coalesce(floor(extract(epoch FROM (p_as_of-min(proof_submitted_at)))/60)::text,'N/A'))) INTO v_rows
      FROM public.payment_attempts WHERE status='UNDER_REVIEW' AND proof_submitted_at <= p_as_of;
    v_title := 'Current payment review backlog'; v_columns := '["Pending attempts","Oldest age (minutes)"]';
  ELSE
    IF p_tool='workspace_usage_report' AND coalesce(p_args->>'metric','booking_count') <> 'booking_count' THEN RAISE EXCEPTION 'UNSUPPORTED_HISTORY'; END IF;
    IF p_tool='operational_report' AND coalesce(p_args->>'metric','status_cohorts') <> 'status_cohorts' THEN RAISE EXCEPTION 'UNSUPPORTED_REPORT'; END IF;
    WITH facts AS (
      SELECT r.id,r.status,r.source,c.workspace_instance_id,w.display_name,
        CASE WHEN p_args->>'basis'='created' THEN r.created_at ELSE c.start_at END basis_at
      FROM public.reservations r
      LEFT JOIN LATERAL (SELECT * FROM public.reservation_candidates c WHERE c.reservation_id=r.id ORDER BY c.is_assigned DESC,c.rank LIMIT 1) c ON true
      LEFT JOIN public.workspace_instances w ON w.id=c.workspace_instance_id
      WHERE (NOT p_args ? 'source' OR r.source::text=p_args->>'source')
        AND (NOT p_args ? 'floor_id' OR w.floor_id=(p_args->>'floor_id')::uuid)
        AND (NOT p_args ? 'template_id' OR w.template_id=(p_args->>'template_id')::uuid)
        AND (NOT p_args ? 'desk_id' OR w.id=(p_args->>'desk_id')::uuid)
        AND (NOT p_args ? 'statuses' OR p_args->'statuses' ? r.status::text)
    ), cohort AS (SELECT * FROM facts WHERE basis_at >= p_start AND basis_at < p_end)
    SELECT CASE WHEN p_tool='workspace_usage_report' THEN
      (SELECT jsonb_agg(jsonb_build_array(w.id::text,w.display_name,coalesce(c.n,0)) ORDER BY w.id) FROM public.workspace_instances w
        LEFT JOIN (SELECT workspace_instance_id,count(*) n FROM cohort WHERE status IN ('CONFIRMED','CHECKED_IN','COMPLETED') GROUP BY workspace_instance_id) c ON c.workspace_instance_id=w.id
        WHERE (NOT p_args ? 'floor_id' OR w.floor_id=(p_args->>'floor_id')::uuid) AND (NOT p_args ? 'template_id' OR w.template_id=(p_args->>'template_id')::uuid) AND (NOT p_args ? 'desk_id' OR w.id=(p_args->>'desk_id')::uuid))
      ELSE (SELECT jsonb_agg(jsonb_build_array(bucket,status,source,n) ORDER BY bucket,status,source) FROM (
        SELECT to_char(date_trunc(coalesce(p_args->>'grouping','day'),basis_at AT TIME ZONE v_tz),'YYYY-MM-DD') bucket,status::text,source::text,count(*) n FROM cohort GROUP BY bucket,status,source
      ) groups) END INTO v_rows;
    v_title := CASE WHEN p_tool='workspace_usage_report' THEN 'Per-desk current-candidate booking counts' ELSE 'Reservation requests by current status and source' END;
    v_columns := CASE WHEN p_tool='workspace_usage_report' THEN '["Desk ID","Desk","Qualifying bookings"]'::jsonb ELSE '["Period","Current status","Source","Requests"]'::jsonb END;
    v_limits := '["Current-status cohorts do not reconstruct historical events or status.","Scheduled basis uses assigned candidate or Main when unassigned. Relocations and reschedules may change attribution; historical desk hours and occupancy are N/A."]';
  END IF;
  v_rows := coalesce(v_rows,'[]'::jsonb); v_total := jsonb_array_length(v_rows);
  IF v_total > 500 THEN RAISE EXCEPTION 'UNSUPPORTED_REPORT'; END IF;
  RETURN jsonb_build_object('tables',jsonb_build_array(jsonb_build_object('title',v_title,'columns',v_columns,'rows',v_rows)), 'limitations',v_limits,'interpretation',jsonb_build_array(
    'Timezone: '||v_tz, 'Basis: '||CASE WHEN p_tool='payment_report' THEN 'payment processed_at' ELSE coalesce(p_args->>'basis','scheduled') END,
    'UTC interval: ['||p_start::text||', '||p_end::text||')', 'Grouping: '||coalesce(p_args->>'grouping','day'), 'Complete aggregate; one database snapshot per tool; as_of: '||p_as_of::text,
    'Filters: '||p_args::text));
END $$;
REVOKE ALL ON FUNCTION public.assistant_read_tool(uuid,text,jsonb,timestamptz,timestamptz,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assistant_read_tool(uuid,text,jsonb,timestamptz,timestamptz,timestamptz) TO service_role;
COMMIT;
