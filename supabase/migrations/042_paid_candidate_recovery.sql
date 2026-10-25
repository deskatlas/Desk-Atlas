-- MS83-R01/R02/R05/R06; PRD-F6/F14, SDD-C3/C5/C11, ERD-E6/E7/E11/E13.
BEGIN;

CREATE TABLE public.paid_candidate_recovery (
  reservation_id uuid PRIMARY KEY REFERENCES public.reservations(id) ON DELETE RESTRICT,
  episode_id uuid NOT NULL DEFAULT gen_random_uuid(),
  original_candidates jsonb NOT NULL,
  template_id uuid REFERENCES public.workspace_templates(id),
  template_name text,
  start_at timestamptz,
  end_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  remedy text CHECK (remedy IN ('RESCHEDULE', 'REPOSITION', 'REFUND'))
);
ALTER TABLE public.paid_candidate_recovery ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paid_candidate_recovery FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.paid_candidate_recovery TO service_role;

ALTER TABLE public.notification_outbox DROP CONSTRAINT IF EXISTS notification_outbox_kind_check;
ALTER TABLE public.notification_outbox ADD CONSTRAINT notification_outbox_kind_check
  CHECK (kind IN ('BOOKING_CONFIRMED','SAVE_CUSTOMER_ID','VOUCHER_EMAIL','PAID_CANDIDATE_EXHAUSTED'));
ALTER TABLE public.notification_outbox DROP CONSTRAINT IF EXISTS chk_outbox_kind_requirements;
ALTER TABLE public.notification_outbox ADD CONSTRAINT chk_outbox_kind_requirements CHECK (
  (kind IN ('BOOKING_CONFIRMED','PAID_CANDIDATE_EXHAUSTED') AND reservation_id IS NOT NULL) OR
  (kind = 'SAVE_CUSTOMER_ID' AND customer_id IS NOT NULL AND depends_on_id IS NOT NULL) OR
  (kind = 'VOUCHER_EMAIL' AND customer_id IS NOT NULL));

CREATE FUNCTION public.capture_paid_candidate_exhaustion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_main public.reservation_candidates%ROWTYPE;
  v_template uuid;
  v_name text;
  v_candidates jsonb;
  v_episode uuid;
BEGIN
  -- Only the committed payment-allocation transition can establish this reason.
  IF NEW.status <> 'NEEDS_MANUAL_RESOLUTION' OR (OLD.status NOT IN
    ('PAYMENT_UNDER_REVIEW','PENDING_COUNTER_CONFIRMATION','CANCELLED') AND NOT
    (OLD.status = 'NEEDS_MANUAL_RESOLUTION' AND EXISTS (SELECT 1 FROM public.audit_logs a
      JOIN public.payment_attempts p ON p.id = a.entity_id WHERE p.reservation_id = NEW.id
      AND a.entity_type = 'payment_attempt' AND a.metadata->>'manual_resolution_required' = 'true')))
    OR NEW.is_closure_impacted OR NOT EXISTS
    (SELECT 1 FROM public.payment_attempts p WHERE p.reservation_id = NEW.id AND p.status = 'APPROVED')
    OR EXISTS (SELECT 1 FROM public.reservation_candidates c WHERE c.reservation_id = NEW.id AND c.is_assigned)
  THEN RETURN NEW; END IF;
  SELECT * INTO v_main FROM public.reservation_candidates c WHERE c.reservation_id = NEW.id AND c.rank = 0;
  SELECT w.template_id, t.name INTO v_template, v_name FROM public.workspace_instances w
    JOIN public.workspace_templates t ON t.id = w.template_id WHERE w.id = v_main.workspace_instance_id;
  SELECT jsonb_agg(to_jsonb(c) ORDER BY c.rank) INTO v_candidates
    FROM public.reservation_candidates c WHERE c.reservation_id = NEW.id;
  -- Inconsistent legacy facts stay support-only; do not invent a duration/template.
  IF v_main.id IS NULL OR EXISTS (SELECT 1 FROM public.reservation_candidates c
    JOIN public.workspace_instances w ON w.id = c.workspace_instance_id
    WHERE c.reservation_id = NEW.id AND (w.template_id <> v_template OR
      c.end_at - c.start_at <> v_main.end_at - v_main.start_at OR
      (c.start_at AT TIME ZONE public.get_business_timezone())::date <> (v_main.start_at AT TIME ZONE public.get_business_timezone())::date)) THEN
    v_template := NULL;
  END IF;
  INSERT INTO public.paid_candidate_recovery(reservation_id,original_candidates,template_id,template_name,start_at,end_at)
    VALUES (NEW.id,coalesce(v_candidates,'[]'),v_template,v_name,v_main.start_at,v_main.end_at)
    ON CONFLICT (reservation_id) DO NOTHING RETURNING episode_id INTO v_episode;
  IF v_episode IS NOT NULL THEN
    INSERT INTO public.notification_outbox(dedupe_key,kind,reservation_id,recipient_email,payload)
    VALUES ('paid-candidate-exhausted:' || v_episode,'PAID_CANDIDATE_EXHAUSTED',NEW.id,NEW.customer_email,
      jsonb_build_object('referenceCode',NEW.reference_code,'customerFirstName',NEW.customer_first_name,
      'customerLastName',NEW.customer_last_name,'startAt',v_main.start_at,'endAt',v_main.end_at,'workspaceName',v_name));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER capture_paid_candidate_exhaustion AFTER UPDATE OF status ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.capture_paid_candidate_exhaustion();

-- Enrich only recovery confirmations before immutable outbox insertion. The normal
-- confirmation identity/dedupe lifecycle remains the sole confirmation producer.
CREATE FUNCTION public.paid_recovery_confirmation_payload() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.kind = 'BOOKING_CONFIRMED' AND EXISTS
    (SELECT 1 FROM public.paid_candidate_recovery c WHERE c.reservation_id = NEW.reservation_id) THEN
    SELECT NEW.payload || jsonb_build_object('bookingStartAt',c.start_at,'bookingEndAt',c.end_at,
      'workspaceDisplayName',w.display_name,'workspaceTemplateName',t.name,'floorName',f.name,
      'bookingToken',r.booking_token,'paidRecovery',true)
      INTO NEW.payload FROM public.reservations r
      JOIN public.reservation_candidates c ON c.reservation_id = r.id AND c.is_assigned
      JOIN public.workspace_instances w ON w.id = c.workspace_instance_id
      JOIN public.workspace_templates t ON t.id = w.template_id JOIN public.floors f ON f.id = w.floor_id
      WHERE r.id = NEW.reservation_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER paid_recovery_confirmation_payload BEFORE INSERT ON public.notification_outbox
  FOR EACH ROW EXECUTE FUNCTION public.paid_recovery_confirmation_payload();

CREATE FUNCTION public.read_paid_candidate_recovery(p_reference text, p_email text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  IF p_email IS NULL OR btrim(p_email) = '' THEN RAISE EXCEPTION 'Verification required' USING ERRCODE = '42501'; END IF;
  SELECT jsonb_build_object('reservationId',r.id,'status',r.status,'episodeId',c.episode_id,
    'templateId',c.template_id,'templateName',c.template_name,'startAt',c.start_at,'endAt',c.end_at,
    'eligible',r.status = 'NEEDS_MANUAL_RESOLUTION' AND NOT r.is_closure_impacted AND c.resolved_at IS NULL
      AND c.template_id IS NOT NULL AND c.start_at < c.end_at
      AND EXISTS (SELECT 1 FROM public.payment_attempts p WHERE p.reservation_id = r.id AND p.status = 'APPROVED' AND p.refund_status = 'NONE')
      AND NOT EXISTS (SELECT 1 FROM public.reservation_candidates a WHERE a.reservation_id = r.id AND a.is_assigned),
    'refundPending',r.status = 'CANCELLED' AND EXISTS
      (SELECT 1 FROM public.payment_attempts p WHERE p.reservation_id = r.id AND p.refund_status = 'REQUIRED'),
    'remedy',c.remedy,'timezone',s.timezone)
    INTO v_result FROM public.reservations r JOIN public.paid_candidate_recovery c ON c.reservation_id = r.id
    CROSS JOIN public.business_settings s WHERE s.id = 1 AND r.reference_code = upper(btrim(p_reference))
      AND lower(r.customer_email) = lower(btrim(p_email));
  RETURN v_result;
END $$;

CREATE FUNCTION public.recover_paid_reservation(p_reference text,p_email text,p_episode uuid,
  p_remedy text,p_workspace uuid DEFAULT NULL,p_start timestamptz DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_r public.reservations%ROWTYPE;
  v_c public.paid_candidate_recovery%ROWTYPE;
  v_s public.business_settings%ROWTYPE;
  v_start timestamptz; v_end timestamptz;
  v_local_start timestamp; v_local_end timestamp; v_day date;
  v_context jsonb; v_token text;
BEGIN
  IF p_email IS NULL OR btrim(p_email) = '' THEN RAISE EXCEPTION 'Verification required' USING ERRCODE = '42501'; END IF;
  IF p_remedy NOT IN ('RESCHEDULE','REPOSITION','REFUND') OR p_remedy IS NULL THEN RAISE EXCEPTION 'Invalid remedy'; END IF;
  SELECT * INTO v_r FROM public.reservations r WHERE r.reference_code = upper(btrim(p_reference))
    AND lower(r.customer_email) = lower(btrim(p_email));
  IF v_r.id IS NULL THEN RAISE EXCEPTION 'Reservation not found' USING ERRCODE = '42501'; END IF;
  -- Same payment -> reservation lock order as payment allocation. No mutation retries.
  PERFORM 1 FROM public.payment_attempts p WHERE p.reservation_id = v_r.id ORDER BY p.id FOR UPDATE;
  SELECT * INTO v_r FROM public.reservations r WHERE r.id = v_r.id FOR UPDATE;
  SELECT * INTO v_c FROM public.paid_candidate_recovery c WHERE c.reservation_id = v_r.id FOR UPDATE;
  IF v_c.episode_id IS DISTINCT FROM p_episode THEN RAISE EXCEPTION 'Recovery episode changed' USING ERRCODE = '40001'; END IF;
  v_context := public.read_paid_candidate_recovery(p_reference,p_email);
  -- A replay or losing race returns authoritative state without another side effect.
  IF v_c.resolved_at IS NOT NULL OR v_r.status <> 'NEEDS_MANUAL_RESOLUTION' THEN RETURN v_context; END IF;
  IF (v_context->>'eligible')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Recovery unavailable. Contact support.'; END IF;
  IF p_remedy = 'REFUND' THEN
    UPDATE public.payment_attempts SET refund_status = 'REQUIRED',refund_notes = 'Customer requested refund after paid candidate exhaustion'
      WHERE reservation_id = v_r.id AND status = 'APPROVED' AND refund_status = 'NONE';
    UPDATE public.reservations SET status = 'CANCELLED',cancelled_at = now(),
      cancellation_reason = 'Customer requested refund after paid candidate exhaustion',
      qr_revoked_at = NULL,qr_issued_at = NULL,booking_token = NULL,booking_token_hash = NULL,updated_at = now() WHERE id = v_r.id;
  ELSE
    SELECT * INTO STRICT v_s FROM public.business_settings WHERE id = 1 FOR SHARE;
    v_start := CASE WHEN p_remedy = 'REPOSITION' THEN v_c.start_at ELSE p_start END;
    v_end := v_start + (v_c.end_at - v_c.start_at);
    IF v_start IS NULL OR v_start <= now() OR v_start > now() + make_interval(days => v_s.max_advance_booking_days)
      OR (p_remedy = 'RESCHEDULE' AND v_start > now() + make_interval(hours =>
        v_s.reschedule_max_advance_value * CASE WHEN v_s.reschedule_max_advance_unit = 'DAYS' THEN 24 ELSE 1 END))
      THEN RAISE EXCEPTION 'Choose a future start within the booking horizon'; END IF;
    PERFORM 1 FROM public.workspace_instances w JOIN public.workspace_templates t ON t.id = w.template_id
      JOIN public.floors f ON f.id = w.floor_id WHERE w.id = p_workspace AND w.template_id = v_c.template_id
      AND w.operational_status = 'ACTIVE' AND t.is_active AND f.is_active AND EXISTS
      (SELECT 1 FROM public.map_elements e JOIN public.map_versions m ON m.id = e.map_version_id
        WHERE m.status = 'PUBLISHED' AND e.workspace_instance_id = w.id) FOR SHARE OF w,t,f;
    IF NOT FOUND THEN RAISE EXCEPTION 'Select an active published workspace of the original template'; END IF;
    IF EXISTS (SELECT 1 FROM public.schedule_blocks b WHERE b.start_at < v_end AND b.end_at > v_start
      AND (b.scope = 'BUSINESS' OR b.workspace_instance_id = p_workspace)) THEN RAISE EXCEPTION 'Selected interval is blocked'; END IF;
    v_local_start := v_start AT TIME ZONE v_s.timezone;
    v_local_end := v_end AT TIME ZONE v_s.timezone;
    PERFORM 1 FROM public.operating_hours h WHERE h.is_active FOR SHARE;
    -- Check each local calendar day, including overnight and pass windows.
    FOR v_day IN SELECT generate_series(v_local_start::date,(v_local_end - interval '1 microsecond')::date,interval '1 day')::date LOOP
      IF NOT coalesce((SELECT range_agg(tsrange(v_day + h.opens_at,
        CASE WHEN h.closes_at >= time '23:59' THEN v_day::timestamp + interval '1 day' ELSE v_day + h.closes_at END,'[)'))
        @> tsrange(greatest(v_local_start,v_day::timestamp),least(v_local_end,v_day::timestamp + interval '1 day'),'[)')
        FROM public.operating_hours h WHERE h.is_active AND h.day_of_week = extract(dow FROM v_day)),false)
        THEN RAISE EXCEPTION 'Selected interval is outside operating hours'; END IF;
    END LOOP;
    IF (v_c.start_at AT TIME ZONE v_s.timezone)::time = v_s.day_pass_start_time::time AND (v_c.end_at AT TIME ZONE v_s.timezone)::time = v_s.day_pass_end_time::time AND (v_local_start::time <> v_s.day_pass_start_time::time OR v_local_end::time <> v_s.day_pass_end_time::time)
      OR (v_c.start_at AT TIME ZONE v_s.timezone)::time = v_s.night_pass_start_time::time AND (v_c.end_at AT TIME ZONE v_s.timezone)::time = v_s.night_pass_end_time::time AND (v_local_start::time <> v_s.night_pass_start_time::time OR v_local_end::time <> v_s.night_pass_end_time::time)
      THEN RAISE EXCEPTION 'Replacement must match the booked pass window and exact duration'; END IF;
    -- Original candidate consent is retained in the immutable recovery snapshot and audit.
    UPDATE public.reservation_candidates SET workspace_instance_id = p_workspace,start_at = v_start,end_at = v_end,
      is_assigned = true,updated_at = now() WHERE id = (SELECT c.id FROM public.reservation_candidates c
        WHERE c.reservation_id = v_r.id ORDER BY
        (c.workspace_instance_id = p_workspace AND c.start_at = v_start) DESC,c.rank LIMIT 1);
    v_token := encode(extensions.gen_random_bytes(32),'hex');
    UPDATE public.reservations SET status = 'CONFIRMED',confirmed_at = now(),updated_at = now(),
      booking_token = v_token,booking_token_hash = encode(extensions.digest(v_token,'sha256'),'hex'),
      qr_issued_at = now(),qr_revoked_at = NULL WHERE id = v_r.id;
    PERFORM public.process_confirmed_reservation_identity_and_outbox(v_r.id,now());
  END IF;
  UPDATE public.paid_candidate_recovery SET resolved_at = now(),remedy = p_remedy WHERE reservation_id = v_r.id;
  INSERT INTO public.audit_logs(actor_role,action,entity_type,entity_id,metadata)
    VALUES ('SYSTEM','paid_candidate_recovery_' || lower(p_remedy),'reservation',v_r.id,
      jsonb_build_object('actor_role','CUSTOMER','episode_id',p_episode,'original_candidates',v_c.original_candidates,
      'approved_workspace_instance_id',p_workspace,'start_at',v_start,'end_at',v_end));
  RETURN public.read_paid_candidate_recovery(p_reference,p_email);
END $$;
REVOKE ALL ON FUNCTION public.capture_paid_candidate_exhaustion() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.paid_recovery_confirmation_payload() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.read_paid_candidate_recovery(text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.recover_paid_reservation(text,text,uuid,text,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_paid_candidate_recovery(text,text),public.recover_paid_reservation(text,text,uuid,text,uuid,timestamptz) TO service_role;
-- Existing records require positive persisted allocation-failure audit evidence.
UPDATE public.reservations SET status = status WHERE status = 'NEEDS_MANUAL_RESOLUTION';
COMMIT;
