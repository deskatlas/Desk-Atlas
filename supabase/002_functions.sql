-- ============================================================================
-- DeskAtlas - 002_functions.sql
-- Application RPC Functions and Stored Procedures
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Map Publishing RPC
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.publish_map_version(
  p_draft_version_id uuid,
  p_published_by_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_draft public.map_versions%ROWTYPE;
  v_floor public.floors%ROWTYPE;
  v_actor_role public.staff_role;
  v_actor_active boolean;
  v_previous_published_ids uuid[];
  v_result jsonb;
BEGIN
  IF p_published_by_user_id IS NULL THEN
    RAISE EXCEPTION 'published_by_user_id is required when publishing a map';
  END IF;

  SELECT role, is_active
    INTO v_actor_role, v_actor_active
  FROM public.staff_profiles
  WHERE user_id = p_published_by_user_id
  FOR UPDATE;

  IF v_actor_role IS DISTINCT FROM 'ADMIN' OR v_actor_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Only an active ADMIN may publish a map version';
  END IF;

  SELECT *
    INTO v_draft
  FROM public.map_versions
  WHERE id = p_draft_version_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Map draft version % does not exist', p_draft_version_id;
  END IF;

  IF v_draft.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Only a DRAFT map version can be published';
  END IF;

  SELECT *
    INTO v_floor
  FROM public.floors
  WHERE id = v_draft.floor_id
  FOR UPDATE;

  IF NOT FOUND OR v_floor.is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Draft map version must belong to an active floor';
  END IF;

  PERFORM 1
  FROM public.map_elements e
  WHERE e.map_version_id = v_draft.id
    AND (
      e.x < 0
      OR e.y < 0
      OR e.width <= 0
      OR e.height <= 0
      OR e.x + e.width > v_draft.canvas_width
      OR e.y + e.height > v_draft.canvas_height
      OR e.rotation NOT IN (0, 90, 180, 270)
    )
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Draft contains invalid map geometry';
  END IF;

  PERFORM 1
  FROM public.map_elements e
  LEFT JOIN public.workspace_instances wi
    ON wi.id = e.workspace_instance_id
  WHERE e.map_version_id = v_draft.id
    AND e.element_role = 'WORKSPACE'
    AND (
      e.workspace_instance_id IS NULL
      OR wi.id IS NULL
      OR wi.floor_id <> v_draft.floor_id
    )
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Draft contains an invalid bookable workspace placement';
  END IF;

  PERFORM e.workspace_instance_id
  FROM public.map_elements e
  WHERE e.map_version_id = v_draft.id
    AND e.workspace_instance_id IS NOT NULL
  GROUP BY e.workspace_instance_id
  HAVING count(*) > 1
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Draft contains duplicate workspace-instance placements';
  END IF;

  PERFORM 1
  FROM public.map_elements a
  JOIN public.map_elements b
    ON a.map_version_id = b.map_version_id
   AND a.id < b.id
  WHERE a.map_version_id = v_draft.id
    AND a.element_role = 'WORKSPACE'
    AND b.element_role = 'WORKSPACE'
    AND a.x < b.x + b.width
    AND a.x + a.width > b.x
    AND a.y < b.y + b.height
    AND a.y + a.height > b.y
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Draft contains overlapping bookable workspaces';
  END IF;

  PERFORM 1
  FROM public.map_elements workspace_element
  JOIN public.map_elements wall_element
    ON workspace_element.map_version_id = wall_element.map_version_id
   AND workspace_element.id <> wall_element.id
  WHERE workspace_element.map_version_id = v_draft.id
    AND workspace_element.element_role = 'WORKSPACE'
    AND wall_element.element_role = 'STRUCTURE'
    AND wall_element.element_type IN ('wall', 'divider')
    AND workspace_element.x < wall_element.x + wall_element.width
    AND workspace_element.x + workspace_element.width > wall_element.x
    AND workspace_element.y < wall_element.y + wall_element.height
    AND workspace_element.y + workspace_element.height > wall_element.y
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Draft contains a workspace conflicting with a wall/divider';
  END IF;

  WITH locked_published AS (
    SELECT id
    FROM public.map_versions
    WHERE floor_id = v_draft.floor_id
      AND status = 'PUBLISHED'
    FOR UPDATE
  )
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[])
    INTO v_previous_published_ids
  FROM locked_published;

  UPDATE public.map_versions
  SET status = 'ARCHIVED'
  WHERE id = ANY(v_previous_published_ids);

  UPDATE public.map_versions
  SET
    status = 'PUBLISHED',
    published_by_user_id = p_published_by_user_id,
    published_at = now()
  WHERE id = v_draft.id;

  INSERT INTO public.audit_logs (
    actor_user_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    metadata
  )
  VALUES (
    p_published_by_user_id,
    'ADMIN',
    'map_published',
    'map_version',
    v_draft.id,
    jsonb_build_object(
      'floor_id', v_draft.floor_id,
      'archived_version_ids', v_previous_published_ids,
      'element_count', (
        SELECT count(*)
        FROM public.map_elements
        WHERE map_version_id = v_draft.id
      ),
      'workspace_instance_count', (
        SELECT count(*)
        FROM public.map_elements
        WHERE map_version_id = v_draft.id
          AND workspace_instance_id IS NOT NULL
      )
    )
  );

  SELECT jsonb_build_object(
    'floor', (
      SELECT to_jsonb(f)
      FROM public.floors f
      WHERE f.id = v_draft.floor_id
    ),
    'version', (
      SELECT to_jsonb(v)
      FROM public.map_versions v
      WHERE v.id = v_draft.id
    ),
    'elements', (
      SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.z_index, e.id), '[]'::jsonb)
      FROM public.map_elements e
      WHERE e.map_version_id = v_draft.id
    )
  )
    INTO v_result
  ;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_map_version(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publish_map_version(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.publish_map_version(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.publish_map_version(uuid, uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 2. Basic Reservation Creation RPC
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_reservation(
    p_source public.reservation_source,
    p_first_name text,
    p_last_name text,
    p_email text,
    p_rate_snapshot numeric,
    p_amount_due numeric,
    p_candidates jsonb,
    p_contact_number text DEFAULT NULL
)
RETURNS public.reservations
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_reservation public.reservations;
    v_status public.reservation_status;
    v_candidate record;
BEGIN
    IF p_source = 'WEB' THEN
        v_status := 'PENDING_PAYMENT';
    ELSE
        v_status := 'PENDING_COUNTER_CONFIRMATION';
    END IF;

    INSERT INTO public.reservations (
        source,
        customer_first_name,
        customer_last_name,
        customer_email,
        customer_contact_number,
        status,
        rate_snapshot,
        amount_due
    )
    VALUES (
        p_source,
        p_first_name,
        p_last_name,
        p_email,
        p_contact_number,
        v_status,
        p_rate_snapshot,
        p_amount_due
    )
    RETURNING * INTO v_reservation;

    FOR v_candidate IN
        SELECT * FROM jsonb_to_recordset(p_candidates) AS x(
            rank smallint,
            "workspaceInstanceId" uuid,
            "startAt" timestamptz,
            "endAt" timestamptz
        )
    LOOP
        INSERT INTO public.reservation_candidates (
            reservation_id,
            rank,
            workspace_instance_id,
            start_at,
            end_at,
            is_assigned
        )
        VALUES (
            v_reservation.id,
            v_candidate.rank,
            v_candidate."workspaceInstanceId",
            v_candidate."startAt",
            v_candidate."endAt",
            false
        );
    END LOOP;

    RETURN v_reservation;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Web Reservation & Payment Session RPCs
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_web_reservation_with_payment_session(
  p_first_name text,
  p_last_name text,
  p_email text,
  p_rate_snapshot numeric,
  p_amount_due numeric,
  p_candidates jsonb,
  p_token_hash text,
  p_expires_at timestamptz,
  p_contact_number text DEFAULT NULL
)
RETURNS TABLE (
  reservation_id uuid,
  payment_attempt_id uuid
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_reservation public.reservations;
  v_candidate record;
  v_payment_attempt_id uuid;
BEGIN
  INSERT INTO public.reservations (
    source,
    customer_first_name,
    customer_last_name,
    customer_email,
    customer_contact_number,
    status,
    rate_snapshot,
    amount_due
  )
  VALUES (
    'WEB',
    p_first_name,
    p_last_name,
    p_email,
    p_contact_number,
    'PENDING_PAYMENT',
    p_rate_snapshot,
    p_amount_due
  )
  RETURNING * INTO v_reservation;

  FOR v_candidate IN
    SELECT * FROM jsonb_to_recordset(p_candidates) AS x(
      rank smallint,
      "workspaceInstanceId" uuid,
      "startAt" timestamptz,
      "endAt" timestamptz
    )
  LOOP
    INSERT INTO public.reservation_candidates (
      reservation_id,
      rank,
      workspace_instance_id,
      start_at,
      end_at,
      is_assigned
    )
    VALUES (
      v_reservation.id,
      v_candidate.rank,
      v_candidate."workspaceInstanceId",
      v_candidate."startAt",
      v_candidate."endAt",
      false
    );
  END LOOP;

  INSERT INTO public.payment_attempts (
    reservation_id,
    attempt_number,
    channel,
    amount,
    status,
    token_hash,
    expires_at
  )
  VALUES (
    v_reservation.id,
    1,
    'WEB',
    p_amount_due,
    'PENDING',
    p_token_hash,
    p_expires_at
  )
  RETURNING id INTO v_payment_attempt_id;

  reservation_id := v_reservation.id;
  payment_attempt_id := v_payment_attempt_id;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_web_payment_proof(
  p_token_hash text,
  p_payment_method_id uuid,
  p_proof_storage_path text,
  p_proof_submitted_at timestamptz
)
RETURNS TABLE (
  payment_attempt_id uuid,
  reservation_id uuid,
  reservation_status public.reservation_status,
  payment_status public.payment_status,
  proof_submitted_at timestamptz
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_attempt public.payment_attempts;
BEGIN
  SELECT *
  INTO v_attempt
  FROM public.payment_attempts
  WHERE token_hash = p_token_hash
    AND channel = 'WEB'
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid payment token';
  END IF;

  IF v_attempt.status <> 'PENDING' OR v_attempt.proof_submitted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Payment proof already submitted or no longer pending';
  END IF;

  IF p_proof_submitted_at >= v_attempt.expires_at THEN
    UPDATE public.payment_attempts
    SET status = 'EXPIRED'
    WHERE id = v_attempt.id
      AND status = 'PENDING';

    UPDATE public.reservations
    SET status = 'EXPIRED'
    WHERE id = v_attempt.reservation_id
      AND status = 'PENDING_PAYMENT';

    RAISE EXCEPTION 'Payment session has expired';
  END IF;

  UPDATE public.payment_attempts
  SET
    payment_method_id = p_payment_method_id,
    proof_storage_path = p_proof_storage_path,
    proof_submitted_at = p_proof_submitted_at,
    status = 'UNDER_REVIEW'
  WHERE id = v_attempt.id;

  UPDATE public.reservations
  SET status = 'PAYMENT_UNDER_REVIEW'
  WHERE id = v_attempt.reservation_id;

  payment_attempt_id := v_attempt.id;
  reservation_id := v_attempt.reservation_id;
  reservation_status := 'PAYMENT_UNDER_REVIEW';
  payment_status := 'UNDER_REVIEW';
  proof_submitted_at := p_proof_submitted_at;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_web_payment_session(
  p_token_hash text,
  p_expired_at timestamptz
)
RETURNS TABLE (
  payment_attempt_id uuid,
  reservation_id uuid
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_attempt public.payment_attempts;
BEGIN
  SELECT *
  INTO v_attempt
  FROM public.payment_attempts
  WHERE token_hash = p_token_hash
    AND channel = 'WEB'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_attempt.status <> 'PENDING'
     OR v_attempt.proof_submitted_at IS NOT NULL
     OR p_expired_at < v_attempt.expires_at THEN
    RETURN;
  END IF;

  UPDATE public.payment_attempts
  SET status = 'EXPIRED'
  WHERE id = v_attempt.id;

  UPDATE public.reservations
  SET status = 'EXPIRED'
  WHERE id = v_attempt.reservation_id
    AND status = 'PENDING_PAYMENT';

  payment_attempt_id := v_attempt.id;
  reservation_id := v_attempt.reservation_id;
  RETURN NEXT;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. Online Payment Review & Allocation RPCs (Admin Only)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.approve_online_payment_and_allocate(
  p_payment_attempt_id uuid,
  p_processed_by_user_id uuid,
  p_processed_at timestamptz
)
RETURNS TABLE (
  payment_attempt_id uuid,
  reservation_id uuid,
  reservation_reference_code text,
  reservation_status public.reservation_status,
  payment_status public.payment_status,
  refund_status public.refund_status,
  assigned_candidate_id uuid,
  assigned_candidate_rank smallint,
  assigned_workspace_instance_id uuid,
  assigned_start_at timestamptz,
  assigned_end_at timestamptz,
  rejection_reason text,
  processed_at timestamptz,
  processed_by_user_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_role public.staff_role;
  v_actor_active boolean;
  v_attempt public.payment_attempts%ROWTYPE;
  v_reservation public.reservations%ROWTYPE;
  v_candidate public.reservation_candidates%ROWTYPE;
  v_assigned_candidate public.reservation_candidates%ROWTYPE;
BEGIN
  IF p_payment_attempt_id IS NULL THEN
    RAISE EXCEPTION 'payment_attempt_id is required';
  END IF;

  IF p_processed_by_user_id IS NULL THEN
    RAISE EXCEPTION 'processed_by_user_id is required';
  END IF;

  IF p_processed_at IS NULL THEN
    RAISE EXCEPTION 'processed_at is required';
  END IF;

  SELECT role, is_active
    INTO v_actor_role, v_actor_active
  FROM public.staff_profiles
  WHERE user_id = p_processed_by_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_actor_role <> 'ADMIN' OR v_actor_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Only an active ADMIN may approve online payment proof';
  END IF;

  SELECT *
    INTO v_attempt
  FROM public.payment_attempts
  WHERE id = p_payment_attempt_id
    AND channel = 'WEB'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Online payment attempt % was not found', p_payment_attempt_id;
  END IF;

  SELECT *
    INTO v_reservation
  FROM public.reservations
  WHERE id = v_attempt.reservation_id
  FOR UPDATE;

  IF v_attempt.status = 'APPROVED' THEN
    SELECT *
      INTO v_assigned_candidate
    FROM public.reservation_candidates rc
    WHERE rc.reservation_id = v_reservation.id
      AND rc.is_assigned = true
    LIMIT 1;
  ELSIF v_attempt.status NOT IN ('UNDER_REVIEW', 'REJECTED') THEN
    RAISE EXCEPTION 'Payment attempt % is not in an approvable review state', p_payment_attempt_id;
  ELSE
    FOR v_candidate IN
      SELECT rc.*
      FROM public.reservation_candidates rc
      JOIN public.workspace_instances wi ON wi.id = rc.workspace_instance_id
      WHERE rc.reservation_id = v_reservation.id
        AND wi.operational_status = 'ACTIVE'
        AND EXISTS (
          SELECT 1
          FROM public.map_elements me
          JOIN public.map_versions mv ON mv.id = me.map_version_id
          WHERE mv.status = 'PUBLISHED'
            AND me.workspace_instance_id = rc.workspace_instance_id
        )
      ORDER BY rc.rank ASC
      FOR UPDATE OF rc
    LOOP
      BEGIN
        UPDATE public.reservation_candidates
        SET is_assigned = true
        WHERE id = v_candidate.id;

        v_assigned_candidate := v_candidate;
        EXIT;
      EXCEPTION
        WHEN exclusion_violation THEN
          CONTINUE;
      END;
    END LOOP;

    UPDATE public.payment_attempts
    SET
      status = 'APPROVED',
      processed_by_user_id = p_processed_by_user_id,
      processed_at = p_processed_at,
      rejection_reason = NULL
    WHERE id = v_attempt.id;

    IF v_assigned_candidate.id IS NOT NULL THEN
      UPDATE public.reservations
      SET
        status = 'CONFIRMED',
        confirmed_at = COALESCE(confirmed_at, p_processed_at),
        cancelled_at = NULL,
        cancellation_reason = NULL,
        cancelled_by_user_id = NULL,
        updated_at = p_processed_at
      WHERE id = v_reservation.id;
    ELSE
      UPDATE public.reservations
      SET
        status = 'NEEDS_MANUAL_RESOLUTION',
        cancelled_at = NULL,
        cancellation_reason = NULL,
        cancelled_by_user_id = NULL,
        updated_at = p_processed_at
      WHERE id = v_reservation.id;
    END IF;

    INSERT INTO public.audit_logs (
      actor_user_id,
      actor_role,
      action,
      entity_type,
      entity_id,
      metadata
    )
    VALUES (
      p_processed_by_user_id,
      'ADMIN',
      CASE WHEN v_attempt.status = 'REJECTED' THEN 'payment_review_reconsidered_approved' ELSE 'payment_review_completed' END,
      'payment_attempt',
      v_attempt.id,
      jsonb_build_object(
        'decision', 'APPROVE',
        'was_reconsidered', v_attempt.status = 'REJECTED',
        'reservation_id', v_reservation.id,
        'assigned_candidate_id', v_assigned_candidate.id,
        'assigned_candidate_rank', v_assigned_candidate.rank,
        'assigned_workspace_instance_id', v_assigned_candidate.workspace_instance_id,
        'manual_resolution_required', v_assigned_candidate.id IS NULL
      )
    );
  END IF;

  SELECT *
    INTO v_attempt
  FROM public.payment_attempts
  WHERE id = p_payment_attempt_id;

  SELECT *
    INTO v_reservation
  FROM public.reservations
  WHERE id = v_attempt.reservation_id;

  IF v_assigned_candidate.id IS NULL THEN
    SELECT *
      INTO v_assigned_candidate
    FROM public.reservation_candidates rc
    WHERE rc.reservation_id = v_reservation.id
      AND rc.is_assigned = true
    LIMIT 1;
  END IF;

  payment_attempt_id := v_attempt.id;
  reservation_id := v_reservation.id;
  reservation_reference_code := v_reservation.reference_code;
  reservation_status := v_reservation.status;
  payment_status := v_attempt.status;
  refund_status := v_attempt.refund_status;
  assigned_candidate_id := v_assigned_candidate.id;
  assigned_candidate_rank := v_assigned_candidate.rank;
  assigned_workspace_instance_id := v_assigned_candidate.workspace_instance_id;
  assigned_start_at := v_assigned_candidate.start_at;
  assigned_end_at := v_assigned_candidate.end_at;
  rejection_reason := v_attempt.rejection_reason;
  processed_at := v_attempt.processed_at;
  processed_by_user_id := v_attempt.processed_by_user_id;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_online_payment_attempt(
  p_payment_attempt_id uuid,
  p_processed_by_user_id uuid,
  p_processed_at timestamptz,
  p_rejection_reason text
)
RETURNS TABLE (
  payment_attempt_id uuid,
  reservation_id uuid,
  reservation_reference_code text,
  reservation_status public.reservation_status,
  payment_status public.payment_status,
  refund_status public.refund_status,
  assigned_candidate_id uuid,
  assigned_candidate_rank smallint,
  assigned_workspace_instance_id uuid,
  assigned_start_at timestamptz,
  assigned_end_at timestamptz,
  rejection_reason text,
  processed_at timestamptz,
  processed_by_user_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_actor_role public.staff_role;
  v_actor_active boolean;
  v_attempt public.payment_attempts%ROWTYPE;
  v_reservation public.reservations%ROWTYPE;
BEGIN
  IF p_payment_attempt_id IS NULL THEN
    RAISE EXCEPTION 'payment_attempt_id is required';
  END IF;

  IF p_processed_by_user_id IS NULL THEN
    RAISE EXCEPTION 'processed_by_user_id is required';
  END IF;

  IF p_processed_at IS NULL THEN
    RAISE EXCEPTION 'processed_at is required';
  END IF;

  IF p_rejection_reason IS NULL OR btrim(p_rejection_reason) = '' THEN
    RAISE EXCEPTION 'rejection_reason is required';
  END IF;

  SELECT sp.role, sp.is_active
    INTO v_actor_role, v_actor_active
  FROM public.staff_profiles sp
  WHERE sp.user_id = p_processed_by_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_actor_role <> 'ADMIN' OR v_actor_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Only an active ADMIN may reject online payment proof';
  END IF;

  SELECT *
    INTO v_attempt
  FROM public.payment_attempts pa
  WHERE pa.id = p_payment_attempt_id
    AND pa.channel = 'WEB'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Online payment attempt % was not found', p_payment_attempt_id;
  END IF;

  SELECT *
    INTO v_reservation
  FROM public.reservations r
  WHERE r.id = v_attempt.reservation_id
  FOR UPDATE;

  IF v_attempt.status <> 'UNDER_REVIEW' AND v_attempt.status <> 'REJECTED' THEN
    RAISE EXCEPTION 'Payment attempt % is not in a rejectable review state', p_payment_attempt_id;
  END IF;

  IF v_attempt.status = 'UNDER_REVIEW' THEN
    UPDATE public.payment_attempts pa
    SET
      status = 'REJECTED',
      processed_by_user_id = p_processed_by_user_id,
      processed_at = p_processed_at,
      rejection_reason = btrim(p_rejection_reason)
    WHERE pa.id = v_attempt.id;

    UPDATE public.reservation_candidates rc
    SET
      is_assigned = false,
      updated_at = p_processed_at
    WHERE rc.reservation_id = v_reservation.id
      AND rc.is_assigned = true;

    UPDATE public.reservations r
    SET
      status = 'CANCELLED',
      cancelled_at = p_processed_at,
      cancellation_reason = 'Payment proof rejected: ' || btrim(p_rejection_reason),
      cancelled_by_user_id = p_processed_by_user_id,
      qr_revoked_at = CASE WHEN r.booking_token_hash IS NOT NULL THEN p_processed_at ELSE r.qr_revoked_at END,
      updated_at = p_processed_at
    WHERE r.id = v_reservation.id;

    INSERT INTO public.audit_logs (
      actor_user_id,
      actor_role,
      action,
      entity_type,
      entity_id,
      metadata
    )
    VALUES (
      p_processed_by_user_id,
      'ADMIN',
      'payment_review_completed',
      'payment_attempt',
      v_attempt.id,
      jsonb_build_object(
        'decision', 'REJECT',
        'reservation_id', v_reservation.id,
        'rejection_reason', btrim(p_rejection_reason)
      )
    );
  ELSIF v_reservation.status <> 'CANCELLED' THEN
    UPDATE public.reservation_candidates rc
    SET
      is_assigned = false,
      updated_at = p_processed_at
    WHERE rc.reservation_id = v_reservation.id
      AND rc.is_assigned = true;

    UPDATE public.reservations r
    SET
      status = 'CANCELLED',
      cancelled_at = p_processed_at,
      cancellation_reason = 'Payment proof rejected: ' || btrim(p_rejection_reason),
      cancelled_by_user_id = p_processed_by_user_id,
      qr_revoked_at = CASE WHEN r.booking_token_hash IS NOT NULL THEN p_processed_at ELSE r.qr_revoked_at END,
      updated_at = p_processed_at
    WHERE r.id = v_reservation.id;
  END IF;

  SELECT *
    INTO v_attempt
  FROM public.payment_attempts pa
  WHERE pa.id = p_payment_attempt_id;

  SELECT *
    INTO v_reservation
  FROM public.reservations r
  WHERE r.id = v_attempt.reservation_id;

  payment_attempt_id := v_attempt.id;
  reservation_id := v_reservation.id;
  reservation_reference_code := v_reservation.reference_code;
  reservation_status := v_reservation.status;
  payment_status := v_attempt.status;
  refund_status := v_attempt.refund_status;
  assigned_candidate_id := NULL;
  assigned_candidate_rank := NULL;
  assigned_workspace_instance_id := NULL;
  assigned_start_at := NULL;
  assigned_end_at := NULL;
  rejection_reason := v_attempt.rejection_reason;
  processed_at := v_attempt.processed_at;
  processed_by_user_id := v_attempt.processed_by_user_id;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_online_payment_and_allocate(uuid, uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_online_payment_and_allocate(uuid, uuid, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.approve_online_payment_and_allocate(uuid, uuid, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.approve_online_payment_and_allocate(uuid, uuid, timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.reject_online_payment_attempt(uuid, uuid, timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_online_payment_attempt(uuid, uuid, timestamptz, text) FROM anon;
REVOKE ALL ON FUNCTION public.reject_online_payment_attempt(uuid, uuid, timestamptz, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reject_online_payment_attempt(uuid, uuid, timestamptz, text) TO service_role;

-- ----------------------------------------------------------------------------
-- 5. Kiosk Counter Payment & Allocation RPCs (Admin & Staff)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_kiosk_reservation_with_counter_payment(
  p_first_name text,
  p_last_name text,
  p_email text,
  p_rate_snapshot numeric,
  p_amount_due numeric,
  p_candidates jsonb,
  p_payment_method_id uuid DEFAULT NULL,
  p_contact_number text DEFAULT NULL
)
RETURNS TABLE (
  reservation_id uuid,
  payment_attempt_id uuid
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_reservation public.reservations;
  v_candidate record;
  v_payment_method public.payment_methods%ROWTYPE;
  v_payment_attempt_id uuid;
BEGIN
  IF p_payment_method_id IS NOT NULL THEN
    SELECT *
      INTO v_payment_method
    FROM public.payment_methods
    WHERE id = p_payment_method_id
      AND is_active = true
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Kiosk payment method % is not active', p_payment_method_id;
    END IF;
  END IF;

  INSERT INTO public.reservations (
    source,
    customer_first_name,
    customer_last_name,
    customer_email,
    customer_contact_number,
    status,
    rate_snapshot,
    amount_due
  )
  VALUES (
    'KIOSK',
    p_first_name,
    p_last_name,
    p_email,
    p_contact_number,
    'PENDING_COUNTER_CONFIRMATION',
    p_rate_snapshot,
    p_amount_due
  )
  RETURNING * INTO v_reservation;

  FOR v_candidate IN
    SELECT * FROM jsonb_to_recordset(p_candidates) AS x(
      rank smallint,
      "workspaceInstanceId" uuid,
      "startAt" timestamptz,
      "endAt" timestamptz
    )
  LOOP
    INSERT INTO public.reservation_candidates (
      reservation_id,
      rank,
      workspace_instance_id,
      start_at,
      end_at,
      is_assigned
    )
    VALUES (
      v_reservation.id,
      v_candidate.rank,
      v_candidate."workspaceInstanceId",
      v_candidate."startAt",
      v_candidate."endAt",
      false
    );
  END LOOP;

  INSERT INTO public.payment_attempts (
    reservation_id,
    attempt_number,
    channel,
    payment_method_id,
    amount,
    status
  )
  VALUES (
    v_reservation.id,
    1,
    'KIOSK',
    p_payment_method_id,
    p_amount_due,
    'PENDING'
  )
  RETURNING id INTO v_payment_attempt_id;

  reservation_id := v_reservation.id;
  payment_attempt_id := v_payment_attempt_id;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_kiosk_payment_and_allocate(
  p_payment_attempt_id uuid,
  p_processed_by_user_id uuid,
  p_processed_at timestamptz
)
RETURNS TABLE (
  payment_attempt_id uuid,
  reservation_id uuid,
  reservation_reference_code text,
  reservation_status public.reservation_status,
  payment_status public.payment_status,
  refund_status public.refund_status,
  assigned_candidate_id uuid,
  assigned_candidate_rank smallint,
  assigned_workspace_instance_id uuid,
  assigned_start_at timestamptz,
  assigned_end_at timestamptz,
  rejection_reason text,
  processed_at timestamptz,
  processed_by_user_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_role public.staff_role;
  v_actor_active boolean;
  v_actor_display_name text;
  v_attempt public.payment_attempts%ROWTYPE;
  v_reservation public.reservations%ROWTYPE;
  v_candidate public.reservation_candidates%ROWTYPE;
  v_assigned_candidate public.reservation_candidates%ROWTYPE;
BEGIN
  IF p_payment_attempt_id IS NULL THEN
    RAISE EXCEPTION 'payment_attempt_id is required';
  END IF;

  IF p_processed_by_user_id IS NULL THEN
    RAISE EXCEPTION 'processed_by_user_id is required';
  END IF;

  IF p_processed_at IS NULL THEN
    RAISE EXCEPTION 'processed_at is required';
  END IF;

  SELECT role, is_active, display_name
    INTO v_actor_role, v_actor_active, v_actor_display_name
  FROM public.staff_profiles
  WHERE user_id = p_processed_by_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_actor_role NOT IN ('ADMIN', 'STAFF') OR v_actor_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Only an active ADMIN or STAFF may confirm kiosk counter payment';
  END IF;

  SELECT *
    INTO v_attempt
  FROM public.payment_attempts
  WHERE id = p_payment_attempt_id
    AND channel = 'KIOSK'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Kiosk payment attempt % was not found', p_payment_attempt_id;
  END IF;

  SELECT *
    INTO v_reservation
  FROM public.reservations
  WHERE id = v_attempt.reservation_id
  FOR UPDATE;

  IF v_attempt.status = 'APPROVED' THEN
    SELECT *
      INTO v_assigned_candidate
    FROM public.reservation_candidates rc
    WHERE rc.reservation_id = v_reservation.id
      AND rc.is_assigned = true
    LIMIT 1;
  ELSIF v_attempt.status <> 'PENDING' THEN
    RAISE EXCEPTION 'Counter payment attempt % is not in a confirmable state', p_payment_attempt_id;
  ELSE
    FOR v_candidate IN
      SELECT rc.*
      FROM public.reservation_candidates rc
      JOIN public.workspace_instances wi ON wi.id = rc.workspace_instance_id
      WHERE rc.reservation_id = v_reservation.id
        AND wi.operational_status = 'ACTIVE'
        AND EXISTS (
          SELECT 1
          FROM public.map_elements me
          JOIN public.map_versions mv ON mv.id = me.map_version_id
          WHERE mv.status = 'PUBLISHED'
            AND me.workspace_instance_id = rc.workspace_instance_id
        )
      ORDER BY rc.rank ASC
      FOR UPDATE OF rc
    LOOP
      BEGIN
        UPDATE public.reservation_candidates
        SET is_assigned = true
        WHERE id = v_candidate.id;

        v_assigned_candidate := v_candidate;
        EXIT;
      EXCEPTION
        WHEN exclusion_violation THEN
          CONTINUE;
      END;
    END LOOP;

    UPDATE public.payment_attempts
    SET
      status = 'APPROVED',
      processed_by_user_id = p_processed_by_user_id,
      processed_at = p_processed_at,
      rejection_reason = NULL
    WHERE id = v_attempt.id;

    IF v_assigned_candidate.id IS NOT NULL THEN
      UPDATE public.reservations
      SET
        status = 'CHECKED_IN',
        confirmed_at = COALESCE(v_reservation.confirmed_at, p_processed_at),
        checked_in_at = COALESCE(v_reservation.checked_in_at, p_processed_at)
      WHERE id = v_reservation.id;
    ELSE
      UPDATE public.reservations
      SET status = 'NEEDS_MANUAL_RESOLUTION'
      WHERE id = v_reservation.id;
    END IF;

    INSERT INTO public.audit_logs (
      actor_user_id,
      actor_role,
      action,
      entity_type,
      entity_id,
      metadata
    )
    VALUES (
      p_processed_by_user_id,
      v_actor_role::text::public.audit_actor_role,
      'kiosk_payment_confirmed',
      'payment_attempt',
      v_attempt.id,
      jsonb_build_object(
        'reservation_id', v_reservation.id,
        'assigned_candidate_id', v_assigned_candidate.id,
        'assigned_candidate_rank', v_assigned_candidate.rank,
        'assigned_workspace_instance_id', v_assigned_candidate.workspace_instance_id,
        'actor_name', COALESCE(v_actor_display_name, CASE WHEN v_actor_role = 'ADMIN' THEN 'Admin' ELSE 'Staff' END),
        'manual_resolution_required', v_assigned_candidate.id IS NULL
      )
    );

    IF v_assigned_candidate.id IS NOT NULL THEN
      INSERT INTO public.audit_logs (
        actor_user_id,
        actor_role,
        action,
        entity_type,
        entity_id,
        metadata
      )
      VALUES (
        p_processed_by_user_id,
        v_actor_role::text::public.audit_actor_role,
        'reservation_checked_in',
        'reservation',
        v_reservation.id,
        jsonb_build_object(
          'source', 'KIOSK',
          'auto_check_in', true,
          'reentry', false,
          'event_type', 'CHECK_IN',
          'actor_name', COALESCE(v_actor_display_name, CASE WHEN v_actor_role = 'ADMIN' THEN 'Admin' ELSE 'Staff' END),
          'workspace_instance_id', v_assigned_candidate.workspace_instance_id,
          'start_at', v_assigned_candidate.start_at,
          'end_at', v_assigned_candidate.end_at
        )
      );
    END IF;
  END IF;

  SELECT *
    INTO v_attempt
  FROM public.payment_attempts
  WHERE id = p_payment_attempt_id;

  SELECT *
    INTO v_reservation
  FROM public.reservations
  WHERE id = v_attempt.reservation_id;

  IF v_assigned_candidate.id IS NULL THEN
    SELECT *
      INTO v_assigned_candidate
    FROM public.reservation_candidates rc
    WHERE rc.reservation_id = v_reservation.id
      AND rc.is_assigned = true
    LIMIT 1;
  END IF;

  payment_attempt_id := v_attempt.id;
  reservation_id := v_reservation.id;
  reservation_reference_code := v_reservation.reference_code;
  reservation_status := v_reservation.status;
  payment_status := v_attempt.status;
  refund_status := v_attempt.refund_status;
  assigned_candidate_id := v_assigned_candidate.id;
  assigned_candidate_rank := v_assigned_candidate.rank;
  assigned_workspace_instance_id := v_assigned_candidate.workspace_instance_id;
  assigned_start_at := v_assigned_candidate.start_at;
  assigned_end_at := v_assigned_candidate.end_at;
  rejection_reason := v_attempt.rejection_reason;
  processed_at := v_attempt.processed_at;
  processed_by_user_id := v_attempt.processed_by_user_id;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_kiosk_payment_and_allocate(uuid, uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_kiosk_payment_and_allocate(uuid, uuid, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.confirm_kiosk_payment_and_allocate(uuid, uuid, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_kiosk_payment_and_allocate(uuid, uuid, timestamptz) TO service_role;

-- ----------------------------------------------------------------------------
-- 6. Staff Operational Actions (Check-In & Check-Out)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_in_reservation(
  p_reservation_id uuid,
  p_actor_user_id uuid,
  p_acted_at timestamptz
)
RETURNS TABLE (
  reservation_id uuid,
  reservation_status public.reservation_status,
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  reentry boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_actor_role public.staff_role;
  v_actor_display_name text;
  v_reservation public.reservations%ROWTYPE;
  v_candidate public.reservation_candidates%ROWTYPE;
  v_reentry boolean := false;
BEGIN
  IF p_reservation_id IS NULL THEN
    RAISE EXCEPTION 'Reservation ID is required';
  END IF;

  IF p_actor_user_id IS NOT NULL THEN
    SELECT role, display_name
      INTO v_actor_role, v_actor_display_name
    FROM public.staff_profiles
    WHERE user_id = p_actor_user_id
      AND is_active = true;

    IF NOT FOUND OR v_actor_role NOT IN ('ADMIN', 'STAFF') THEN
      RAISE EXCEPTION 'Only active ADMIN or STAFF profiles may check in reservations';
    END IF;
  ELSE
    v_actor_role := 'STAFF';
  END IF;

  SELECT *
    INTO v_reservation
  FROM public.reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation was not found';
  END IF;

  SELECT *
    INTO v_candidate
  FROM public.reservation_candidates
  WHERE reservation_id = v_reservation.id
    AND is_assigned = true
  LIMIT 1;

  IF v_candidate.id IS NULL THEN
    RAISE EXCEPTION 'Reservation has no assigned workspace to check in';
  END IF;

  IF v_reservation.status = 'CHECKED_IN' THEN
    v_reentry := true;
  ELSIF v_reservation.status <> 'CONFIRMED' THEN
    RAISE EXCEPTION 'Reservation is not in a check-in state';
  END IF;

  IF NOT v_reentry AND (p_acted_at < v_candidate.start_at OR p_acted_at > v_candidate.end_at) THEN
    IF v_reservation.source = 'KIOSK' AND p_acted_at >= (v_candidate.start_at - interval '15 minutes') AND p_acted_at <= v_candidate.end_at THEN
      -- Allow early check-in for kiosk bookings within the leeway window
    ELSE
      RAISE EXCEPTION 'Reservation is not currently active for check-in';
    END IF;
  END IF;

  UPDATE public.reservations
  SET
    status = 'CHECKED_IN',
    checked_in_at = COALESCE(v_reservation.checked_in_at, p_acted_at),
    updated_at = p_acted_at
  WHERE id = v_reservation.id;

  INSERT INTO public.audit_logs (
    actor_user_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    metadata
  )
  VALUES (
    p_actor_user_id,
    v_actor_role::text::public.audit_actor_role,
    CASE WHEN v_reentry THEN 'reservation_reentered' ELSE 'reservation_checked_in' END,
    'reservation',
    v_reservation.id,
    jsonb_build_object(
      'reentry', v_reentry,
      'event_type', CASE WHEN v_reentry THEN 'RE_ENTRY' ELSE 'CHECK_IN' END,
      'actor_name', COALESCE(v_actor_display_name, CASE WHEN v_actor_role = 'ADMIN' THEN 'Admin' ELSE 'Staff' END),
      'workspace_instance_id', v_candidate.workspace_instance_id,
      'start_at', v_candidate.start_at,
      'end_at', v_candidate.end_at
    )
  );

  SELECT r.id, r.status, r.checked_in_at, r.checked_out_at
    INTO reservation_id, reservation_status, checked_in_at, checked_out_at
  FROM public.reservations r
  WHERE r.id = v_reservation.id;

  reentry := v_reentry;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_out_reservation(
  p_reservation_id uuid,
  p_actor_user_id uuid,
  p_acted_at timestamptz
)
RETURNS TABLE (
  reservation_id uuid,
  reservation_status public.reservation_status,
  checked_in_at timestamptz,
  checked_out_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_actor_role public.staff_role;
  v_actor_display_name text;
  v_reservation public.reservations%ROWTYPE;
BEGIN
  IF p_reservation_id IS NULL THEN
    RAISE EXCEPTION 'Reservation ID is required';
  END IF;

  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Actor user ID is required';
  END IF;

  IF p_acted_at IS NULL THEN
    RAISE EXCEPTION 'Action timestamp is required';
  END IF;

  SELECT role, display_name
    INTO v_actor_role, v_actor_display_name
  FROM public.staff_profiles
  WHERE user_id = p_actor_user_id
    AND is_active = true;

  IF NOT FOUND OR v_actor_role NOT IN ('ADMIN', 'STAFF') THEN
    RAISE EXCEPTION 'Only active ADMIN or STAFF profiles may check out reservations';
  END IF;

  SELECT *
    INTO v_reservation
  FROM public.reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation was not found';
  END IF;

  IF v_reservation.status = 'COMPLETED' THEN
    SELECT r.id, r.status, r.checked_in_at, r.checked_out_at
      INTO reservation_id, reservation_status, checked_in_at, checked_out_at
    FROM public.reservations r
    WHERE r.id = v_reservation.id;

    RETURN NEXT;
  END IF;

  IF v_reservation.status <> 'CHECKED_IN' THEN
    RAISE EXCEPTION 'Reservation is not currently checked in';
  END IF;

  UPDATE public.reservations
  SET
    status = 'COMPLETED',
    checked_out_at = COALESCE(v_reservation.checked_out_at, p_acted_at),
    updated_at = p_acted_at
  WHERE id = v_reservation.id;

  -- Release the physical workspace on early checkout by updating end_at of the assigned candidate
  -- so that subsequent bookings for this workspace can be allocated without exclusion violation.
  UPDATE public.reservation_candidates
  SET end_at = p_acted_at
  WHERE reservation_id = v_reservation.id
    AND is_assigned = true
    AND end_at > p_acted_at
    AND start_at < p_acted_at;

  INSERT INTO public.audit_logs (
    actor_user_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    metadata
  )
  VALUES (
    p_actor_user_id,
    v_actor_role::text::public.audit_actor_role,
    'reservation_checked_out',
    'reservation',
    v_reservation.id,
    jsonb_build_object(
      'actor_name', COALESCE(v_actor_display_name, CASE WHEN v_actor_role = 'ADMIN' THEN 'Admin' ELSE 'Staff' END),
      'checked_in_at', v_reservation.checked_in_at,
      'checked_out_at', p_acted_at
    )
  );

  SELECT r.id, r.status, r.checked_in_at, r.checked_out_at
    INTO reservation_id, reservation_status, checked_in_at, checked_out_at
  FROM public.reservations r
  WHERE r.id = v_reservation.id;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.check_in_reservation(uuid, uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_in_reservation(uuid, uuid, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.check_in_reservation(uuid, uuid, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_in_reservation(uuid, uuid, timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.check_out_reservation(uuid, uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_out_reservation(uuid, uuid, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.check_out_reservation(uuid, uuid, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_out_reservation(uuid, uuid, timestamptz) TO service_role;

-- ----------------------------------------------------------------------------
-- 6.1. Reservation Cancellation RPC
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cancel_reservation(
  p_reservation_id uuid,
  p_cancellation_reason text,
  p_cancelled_at timestamptz DEFAULT now(),
  p_actor_user_id uuid DEFAULT NULL,
  p_actor_role text DEFAULT 'ADMIN'
)
RETURNS TABLE (
  reservation_id uuid,
  reference_code text,
  reservation_status public.reservation_status,
  cancelled_at timestamptz,
  cancellation_reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_reservation public.reservations%ROWTYPE;
  v_actor_user_id uuid := NULL;
  v_actor_role public.audit_actor_role := 'ADMIN';
BEGIN
  IF p_reservation_id IS NULL THEN
    RAISE EXCEPTION 'Reservation ID is required';
  END IF;

  IF p_cancellation_reason IS NULL OR btrim(p_cancellation_reason) = '' THEN
    RAISE EXCEPTION 'Cancellation reason is required';
  END IF;

  SELECT *
    INTO v_reservation
  FROM public.reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation was not found';
  END IF;

  IF v_reservation.status = 'CANCELLED' THEN
    SELECT
      v_reservation.id,
      v_reservation.reference_code,
      v_reservation.status,
      v_reservation.cancelled_at,
      v_reservation.cancellation_reason
    INTO
      reservation_id,
      reference_code,
      reservation_status,
      cancelled_at,
      cancellation_reason;
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_actor_user_id IS NOT NULL THEN
    PERFORM 1 FROM public.staff_profiles WHERE user_id = p_actor_user_id;
    IF FOUND THEN
      v_actor_user_id := p_actor_user_id;
    END IF;
  END IF;

  IF v_actor_user_id IS NULL THEN
    SELECT user_id INTO v_actor_user_id
    FROM public.staff_profiles
    WHERE role = 'ADMIN' AND is_active = true
    LIMIT 1;
  END IF;

  IF p_actor_role IS NOT NULL AND p_actor_role IN ('ADMIN', 'STAFF', 'SYSTEM') THEN
    v_actor_role := p_actor_role::public.audit_actor_role;
  END IF;

  IF v_actor_user_id IS NULL THEN
    v_actor_role := 'SYSTEM';
  END IF;

  -- 1. Unassign all candidates to release physical workspace inventory
  UPDATE public.reservation_candidates
  SET
    is_assigned = false,
    updated_at = COALESCE(p_cancelled_at, now())
  WHERE reservation_id = v_reservation.id
    AND is_assigned = true;

  -- 2. Update reservation status to CANCELLED and record cancellation details
  UPDATE public.reservations
  SET
    status = 'CANCELLED',
    cancelled_at = COALESCE(p_cancelled_at, now()),
    cancellation_reason = btrim(p_cancellation_reason),
    cancelled_by_user_id = v_actor_user_id,
    qr_revoked_at = COALESCE(p_cancelled_at, now()),
    updated_at = COALESCE(p_cancelled_at, now())
  WHERE id = v_reservation.id;

  -- 3. Create audit log entry
  INSERT INTO public.audit_logs (
    actor_user_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    metadata
  )
  VALUES (
    v_actor_user_id,
    v_actor_role,
    'reservation_cancelled',
    'reservation',
    v_reservation.id,
    jsonb_build_object(
      'reason', btrim(p_cancellation_reason),
      'reference_code', v_reservation.reference_code,
      'previous_status', v_reservation.status,
      'cancelled_at', COALESCE(p_cancelled_at, now())
    )
  );

  SELECT
    r.id,
    r.reference_code,
    r.status,
    r.cancelled_at,
    r.cancellation_reason
  INTO
    reservation_id,
    reference_code,
    reservation_status,
    cancelled_at,
    cancellation_reason
  FROM public.reservations r
  WHERE r.id = v_reservation.id;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_reservation(uuid, text, timestamptz, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_reservation(uuid, text, timestamptz, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.cancel_reservation(uuid, text, timestamptz, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_reservation(uuid, text, timestamptz, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_reservation(uuid, text, timestamptz, uuid, text) TO authenticated;


-- ----------------------------------------------------------------------------
-- 7. Staff Authentication Login Verification RPC
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.verify_staff_login(
  p_email text,
  p_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_user auth.users%ROWTYPE;
  v_profile public.staff_profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_user
  FROM auth.users
  WHERE email = lower(btrim(p_email));

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid email or password');
  END IF;

  IF v_user.encrypted_password IS NULL OR v_user.encrypted_password::text <> extensions.crypt(p_password::text, v_user.encrypted_password::text) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid email or password');
  END IF;

  SELECT * INTO v_profile
  FROM public.staff_profiles
  WHERE user_id = v_user.id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No staff profile configured for this user');
  END IF;

  IF v_profile.is_active IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('success', false, 'error', 'This account has been deactivated');
  END IF;

    RETURN jsonb_build_object(
      'success', true,
      'user', jsonb_build_object(
        'id', v_user.id,
        'email', v_user.email,
        'role', lower(v_profile.role::text),
        'displayName', v_profile.display_name,
        'isSuperAdmin', COALESCE(v_profile.is_super_admin, false)
      )
    );
  END;
  $$;

REVOKE ALL ON FUNCTION public.verify_staff_login(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_staff_login(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.verify_staff_login(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.verify_staff_login(text, text) TO service_role;

-- ----------------------------------------------------------------------------
-- 8. Staff Management RPCs (Admin Only)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_list_staff(
  p_actor_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  email text,
  role public.staff_role,
  display_name text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz,
  last_sign_in_at timestamptz,
  created_by_admin_id uuid,
  is_super_admin boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
BEGIN
  IF p_actor_user_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.staff_profiles sp
      WHERE sp.user_id = p_actor_user_id
        AND sp.role = 'ADMIN'
        AND sp.is_active = true
    ) THEN
      RAISE EXCEPTION 'Only active ADMIN profiles may view staff management';
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    p.user_id AS id,
    COALESCE(u.email, 'unknown@deskatlas.com')::text AS email,
    p.role,
    p.display_name,
    p.is_active,
    p.created_at,
    p.updated_at,
    u.last_sign_in_at,
    p.created_by_admin_id,
    COALESCE(p.is_super_admin, false) AS is_super_admin
  FROM public.staff_profiles p
  LEFT JOIN auth.users u ON u.id = p.user_id
  ORDER BY
    COALESCE(p.is_super_admin, false) DESC,
    CASE WHEN p.role = 'ADMIN' THEN 0 ELSE 1 END ASC,
    p.created_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_staff(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_staff(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.admin_list_staff(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_staff(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_create_staff(
  p_actor_user_id uuid,
  p_email text,
  p_password text,
  p_display_name text,
  p_role public.staff_role
)
RETURNS TABLE (
  id uuid,
  email text,
  role public.staff_role,
  display_name text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz,
  last_sign_in_at timestamptz,
  created_by_admin_id uuid,
  is_super_admin boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_trimmed_email text;
  v_trimmed_name text;
  v_new_user_id uuid;
  v_encrypted_pw text;
  v_actor_is_super_admin boolean := false;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Creating admin actor is required to create staff accounts';
  END IF;

  SELECT COALESCE(is_super_admin, false) INTO v_actor_is_super_admin
  FROM public.staff_profiles
  WHERE user_id = p_actor_user_id
    AND role = 'ADMIN'
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only active ADMIN profiles may create staff accounts';
  END IF;

  IF p_role = 'ADMIN' AND NOT v_actor_is_super_admin THEN
    RAISE EXCEPTION 'Only the Superadmin can create administrator accounts';
  END IF;

  v_trimmed_email := lower(btrim(p_email));
  v_trimmed_name := btrim(p_display_name);

  IF v_trimmed_email = '' OR position('@' in v_trimmed_email) = 0 THEN
    RAISE EXCEPTION 'A valid email address is required';
  END IF;

  IF v_trimmed_name = '' THEN
    RAISE EXCEPTION 'Display name cannot be blank';
  END IF;

  IF p_password IS NULL OR length(p_password) < 8 OR p_password !~ '[A-Z]' OR p_password !~ '[0-9]' OR p_password !~ '[^a-zA-Z0-9\s]' THEN
    RAISE EXCEPTION 'Password must be at least 8 characters long, contain at least 1 uppercase letter, 1 number, and 1 special character';
  END IF;

  IF p_role NOT IN ('ADMIN', 'STAFF') THEN
    RAISE EXCEPTION 'Role must be either ADMIN or STAFF';
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users WHERE email = v_trimmed_email) THEN
    RAISE EXCEPTION 'A user with email % already exists', v_trimmed_email;
  END IF;

  v_new_user_id := gen_random_uuid();
  v_encrypted_pw := extensions.crypt(p_password::text, extensions.gen_salt('bf'::text));

  INSERT INTO auth.users (
    id,
    instance_id,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    role,
    aud,
    confirmation_token
  )
  VALUES (
    v_new_user_id,
    '00000000-0000-0000-0000-000000000000',
    v_trimmed_email,
    v_encrypted_pw,
    now(),
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    jsonb_build_object('display_name', v_trimmed_name, 'role', p_role::text),
    now(),
    now(),
    'authenticated',
    'authenticated',
    encode(gen_random_bytes(32), 'hex')
  );

  INSERT INTO public.staff_profiles (
    user_id,
    created_by_admin_id,
    role,
    display_name,
    is_active,
    is_super_admin,
    created_at,
    updated_at
  )
  VALUES (
    v_new_user_id,
    p_actor_user_id,
    p_role,
    v_trimmed_name,
    true,
    false,
    now(),
    now()
  );

  INSERT INTO public.audit_logs (
    actor_user_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    metadata
  )
  VALUES (
    p_actor_user_id,
    'ADMIN',
    'CREATE_STAFF_ACCOUNT',
    'staff_profiles',
    v_new_user_id,
    jsonb_build_object(
      'email', v_trimmed_email,
      'role', p_role::text,
      'display_name', v_trimmed_name,
      'created_by_admin_id', p_actor_user_id
    )
  );

  RETURN QUERY
  SELECT
    p.user_id AS id,
    v_trimmed_email AS email,
    p.role,
    p.display_name,
    p.is_active,
    p.created_at,
    p.updated_at,
    NULL::timestamptz AS last_sign_in_at,
    p.created_by_admin_id,
    COALESCE(p.is_super_admin, false) AS is_super_admin
  FROM public.staff_profiles p
  WHERE p.user_id = v_new_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_staff(uuid, text, text, text, public.staff_role) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_create_staff(uuid, text, text, text, public.staff_role) FROM anon;
REVOKE ALL ON FUNCTION public.admin_create_staff(uuid, text, text, text, public.staff_role) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_staff(uuid, text, text, text, public.staff_role) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_update_staff(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_display_name text DEFAULT NULL,
  p_role public.staff_role DEFAULT NULL,
  p_is_active boolean DEFAULT NULL,
  p_new_password text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  email text,
  role public.staff_role,
  display_name text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz,
  last_sign_in_at timestamptz,
  created_by_admin_id uuid,
  is_super_admin boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_current_profile public.staff_profiles%ROWTYPE;
  v_action text := 'UPDATE_STAFF_ACCOUNT';
  v_actor_is_super_admin boolean := false;
BEGIN
  IF p_actor_user_id IS NOT NULL THEN
    SELECT (COALESCE(sp.is_super_admin, false) OR sp.created_by_admin_id IS NULL) INTO v_actor_is_super_admin
    FROM public.staff_profiles sp
    WHERE sp.user_id = p_actor_user_id
      AND sp.role = 'ADMIN'
      AND sp.is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Only active ADMIN profiles may manage staff accounts';
    END IF;
  END IF;

  SELECT * INTO v_current_profile
  FROM public.staff_profiles
  WHERE user_id = p_target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff member not found';
  END IF;

  -- Protection: Superadmin account cannot be demoted or deactivated
  IF v_current_profile.is_super_admin THEN
    IF p_role IS NOT NULL AND p_role <> 'ADMIN' THEN
      RAISE EXCEPTION 'Cannot demote the Superadmin account';
    END IF;
    IF p_is_active IS NOT NULL AND p_is_active = false THEN
      RAISE EXCEPTION 'Cannot deactivate the Superadmin account';
    END IF;
  END IF;

  -- Non-superadmin cannot manage other admin accounts
  IF v_current_profile.role = 'ADMIN' AND NOT v_actor_is_super_admin AND p_actor_user_id IS NOT NULL AND p_actor_user_id <> p_target_user_id THEN
    RAISE EXCEPTION 'Only the Superadmin can manage administrator accounts';
  END IF;

  -- Non-superadmin cannot promote to admin
  IF p_role = 'ADMIN' AND v_current_profile.role <> 'ADMIN' AND NOT v_actor_is_super_admin THEN
    RAISE EXCEPTION 'Only the Superadmin can promote accounts to administrator';
  END IF;

  IF p_display_name IS NOT NULL AND btrim(p_display_name) = '' THEN
    RAISE EXCEPTION 'Display name cannot be blank';
  END IF;

  IF p_new_password IS NOT NULL AND btrim(p_new_password) <> '' THEN
    IF length(p_new_password) < 8 OR p_new_password !~ '[A-Z]' OR p_new_password !~ '[0-9]' OR p_new_password !~ '[^a-zA-Z0-9\s]' THEN
      RAISE EXCEPTION 'Password must be at least 8 characters long, contain at least 1 uppercase letter, 1 number, and 1 special character';
    END IF;
    UPDATE auth.users
    SET
      encrypted_password = extensions.crypt(p_new_password::text, extensions.gen_salt('bf'::text)),
      updated_at = now()
    WHERE id = p_target_user_id;
  END IF;

  IF p_is_active IS NOT NULL AND p_is_active <> v_current_profile.is_active THEN
    IF p_is_active = false THEN
      v_action := 'DEACTIVATE_STAFF_ACCOUNT';
    ELSE
      v_action := 'REACTIVATE_STAFF_ACCOUNT';
    END IF;
  END IF;

  UPDATE public.staff_profiles
  SET
    display_name = COALESCE(btrim(p_display_name), display_name),
    role = COALESCE(p_role, role),
    is_active = COALESCE(p_is_active, is_active),
    updated_at = now()
  WHERE user_id = p_target_user_id;

  IF p_actor_user_id IS NOT NULL THEN
    INSERT INTO public.audit_logs (
      actor_user_id,
      actor_role,
      action,
      entity_type,
      entity_id,
      metadata
    )
    VALUES (
      p_actor_user_id,
      'ADMIN',
      v_action,
      'staff_profiles',
      p_target_user_id,
      jsonb_build_object(
        'previous_role', v_current_profile.role::text,
        'new_role', COALESCE(p_role::text, v_current_profile.role::text),
        'previous_display_name', v_current_profile.display_name,
        'new_display_name', COALESCE(btrim(p_display_name), v_current_profile.display_name),
        'previous_is_active', v_current_profile.is_active,
        'new_is_active', COALESCE(p_is_active, v_current_profile.is_active),
        'password_changed', (p_new_password IS NOT NULL AND btrim(p_new_password) <> ''),
        'created_by_admin_id', v_current_profile.created_by_admin_id
      )
    );
  END IF;

  RETURN QUERY
  SELECT
    p.user_id AS id,
    COALESCE(u.email, 'unknown@deskatlas.com')::text AS email,
    p.role,
    p.display_name,
    p.is_active,
    p.created_at,
    p.updated_at,
    u.last_sign_in_at,
    p.created_by_admin_id,
    COALESCE(p.is_super_admin, false) AS is_super_admin
  FROM public.staff_profiles p
  LEFT JOIN auth.users u ON u.id = p.user_id
  WHERE p.user_id = p_target_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_staff(uuid, uuid, text, public.staff_role, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_update_staff(uuid, uuid, text, public.staff_role, boolean, text) FROM anon;
REVOKE ALL ON FUNCTION public.admin_update_staff(uuid, uuid, text, public.staff_role, boolean, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_staff(uuid, uuid, text, public.staff_role, boolean, text) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_check_staff_deletion(
  p_target_user_id uuid
)
RETURNS TABLE (
  can_delete boolean,
  reason text,
  reference_counts jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_audit_count integer := 0;
  v_res_count integer := 0;
  v_pay_count integer := 0;
  v_total integer := 0;
  v_reason text := NULL;
  v_reasons text[] := ARRAY[]::text[];
  v_profile public.staff_profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_profile
  FROM public.staff_profiles
  WHERE user_id = p_target_user_id;

  IF v_profile.is_super_admin THEN
    RETURN QUERY SELECT false, 'Cannot delete the Superadmin account.'::text, jsonb_build_object(
      'auditLogs', 0,
      'reservations', 0,
      'payments', 0,
      'total', 0
    );
    RETURN;
  END IF;

  SELECT count(*) INTO v_audit_count
  FROM public.audit_logs
  WHERE actor_user_id = p_target_user_id;

  SELECT count(*) INTO v_res_count
  FROM public.reservations
  WHERE resolved_by_user_id = p_target_user_id
     OR cancelled_by_user_id = p_target_user_id;

  SELECT count(*) INTO v_pay_count
  FROM public.payment_attempts
  WHERE processed_by_user_id = p_target_user_id
     OR refund_recorded_by_user_id = p_target_user_id;

  v_total := v_audit_count + v_res_count + v_pay_count;

  IF v_total > 0 THEN
    IF v_audit_count > 0 THEN
      v_reasons := array_append(v_reasons, v_audit_count || ' audit log' || (CASE WHEN v_audit_count > 1 THEN 's' ELSE '' END));
    END IF;
    IF v_res_count > 0 THEN
      v_reasons := array_append(v_reasons, v_res_count || ' reservation' || (CASE WHEN v_res_count > 1 THEN 's' ELSE '' END));
    END IF;
    IF v_pay_count > 0 THEN
      v_reasons := array_append(v_reasons, v_pay_count || ' payment confirmation' || (CASE WHEN v_pay_count > 1 THEN 's' ELSE '' END));
    END IF;
    v_reason := 'Cannot delete: Staff has historical records (' || array_to_string(v_reasons, ', ') || '). Deactivate instead.';
    RETURN QUERY SELECT false, v_reason, jsonb_build_object(
      'auditLogs', v_audit_count,
      'reservations', v_res_count,
      'payments', v_pay_count,
      'total', v_total
    );
  ELSE
    RETURN QUERY SELECT true, NULL::text, jsonb_build_object(
      'auditLogs', 0,
      'reservations', 0,
      'payments', 0,
      'total', 0
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_check_staff_deletion(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_check_staff_deletion(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.admin_check_staff_deletion(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_check_staff_deletion(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_delete_staff(
  p_actor_user_id uuid,
  p_target_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_profile public.staff_profiles%ROWTYPE;
  v_actor_is_super_admin boolean := false;
  v_check RECORD;
BEGIN
  IF p_actor_user_id IS NOT NULL THEN
    SELECT (COALESCE(sp.is_super_admin, false) OR sp.created_by_admin_id IS NULL) INTO v_actor_is_super_admin
    FROM public.staff_profiles sp
    WHERE sp.user_id = p_actor_user_id
      AND sp.role = 'ADMIN'
      AND sp.is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Only active ADMIN profiles may delete staff accounts';
    END IF;
  END IF;

  SELECT * INTO v_profile
  FROM public.staff_profiles
  WHERE user_id = p_target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff member not found';
  END IF;

  IF v_profile.is_super_admin THEN
    RAISE EXCEPTION 'Cannot delete the Superadmin account';
  END IF;

  IF v_profile.role = 'ADMIN' AND NOT v_actor_is_super_admin THEN
    RAISE EXCEPTION 'Only the Superadmin can delete administrator accounts';
  END IF;

  SELECT * INTO v_check
  FROM public.admin_check_staff_deletion(p_target_user_id);

  IF v_check.can_delete IS NOT TRUE THEN
    RAISE EXCEPTION '%', COALESCE(v_check.reason, 'Cannot delete staff account with historical audit, reservation, or payment records. Deactivate instead.');
  END IF;

  DELETE FROM public.staff_profiles
  WHERE user_id = p_target_user_id;

  DELETE FROM auth.users
  WHERE id = p_target_user_id;

  IF p_actor_user_id IS NOT NULL THEN
    INSERT INTO public.audit_logs (
      actor_user_id,
      actor_role,
      action,
      entity_type,
      entity_id,
      metadata
    )
    VALUES (
      p_actor_user_id,
      'ADMIN',
      'DELETE_STAFF_ACCOUNT',
      'staff_profiles',
      p_target_user_id,
      jsonb_build_object(
        'email', 'deleted@deskatlas.com',
        'display_name', v_profile.display_name,
        'role', v_profile.role::text
      )
    );
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_staff(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_staff(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.admin_delete_staff(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_staff(uuid, uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 10. Admin Initial Sign-Up & Setup RPCs (MF-43)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_has_existing_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.staff_profiles
    WHERE role = 'ADMIN'
      AND is_active = true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_has_existing_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_has_existing_admin() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_check_password_configured(p_user_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
DECLARE
  v_configured boolean;
BEGIN
  IF p_user_id IS NOT NULL THEN
    SELECT (encrypted_password IS NOT NULL AND encrypted_password <> '') INTO v_configured
    FROM auth.users
    WHERE id = p_user_id;
    RETURN COALESCE(v_configured, false);
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM auth.users u
    INNER JOIN public.staff_profiles sp ON sp.user_id = u.id
    WHERE sp.role = 'ADMIN'
      AND sp.is_active = true
      AND u.encrypted_password IS NOT NULL
      AND u.encrypted_password <> ''
  ) INTO v_configured;

  RETURN COALESCE(v_configured, false);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_check_password_configured(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_check_password_configured(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_bootstrap_initial_admin(
  p_user_id uuid,
  p_email text,
  p_display_name text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  email text,
  role public.staff_role,
  display_name text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz,
  is_super_admin boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_trimmed_email text;
  v_final_name text;
BEGIN
  -- Strict single-use guard
  IF EXISTS (
    SELECT 1
    FROM public.staff_profiles
    WHERE role = 'ADMIN'
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Admin account already exists. Setup is sealed.';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User ID is required for initial admin bootstrap';
  END IF;

  v_trimmed_email := lower(btrim(p_email));
  IF v_trimmed_email = '' OR position('@' in v_trimmed_email) = 0 THEN
    RAISE EXCEPTION 'A valid email address is required';
  END IF;

  v_final_name := COALESCE(NULLIF(btrim(p_display_name), ''), split_part(v_trimmed_email, '@', 1));
  IF v_final_name = '' THEN
    v_final_name := 'Admin';
  END IF;

  -- Upsert staff_profiles for this auth user with role ADMIN and is_super_admin = true
  INSERT INTO public.staff_profiles (
    user_id,
    role,
    display_name,
    is_active,
    is_super_admin,
    created_at,
    updated_at
  )
  VALUES (
    p_user_id,
    'ADMIN',
    v_final_name,
    true,
    true,
    now(),
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    role = 'ADMIN',
    display_name = EXCLUDED.display_name,
    is_active = true,
    is_super_admin = true,
    updated_at = now();

  -- Append to audit logs
  INSERT INTO public.audit_logs (
    id,
    actor_user_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    metadata,
    created_at
  )
  VALUES (
    gen_random_uuid(),
    p_user_id,
    'ADMIN',
    'BOOTSTRAP_INITIAL_ADMIN',
    'staff_profiles',
    p_user_id::text,
    jsonb_build_object(
      'email', v_trimmed_email,
      'display_name', v_final_name,
      'provider', 'google_oauth',
      'is_super_admin', true
    ),
    now()
  );

  RETURN QUERY
  SELECT
    p.user_id AS id,
    v_trimmed_email AS email,
    p.role,
    p.display_name,
    p.is_active,
    p.created_at,
    p.updated_at,
    COALESCE(p.is_super_admin, true) AS is_super_admin
  FROM public.staff_profiles p
  WHERE p.user_id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_bootstrap_initial_admin(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_bootstrap_initial_admin(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_bootstrap_initial_admin(uuid, text, text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 11. Admin Password Reset RPCs (MF-69)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_get_admin_by_email(
  p_email text
)
RETURNS TABLE (
  id uuid,
  email text,
  display_name text,
  role public.staff_role,
  is_active boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.user_id AS id,
    lower(btrim(u.email))::text AS email,
    p.display_name,
    p.role,
    p.is_active
  FROM public.staff_profiles p
  JOIN auth.users u ON u.id = p.user_id
  WHERE lower(btrim(u.email)) = lower(btrim(p_email))
    AND p.role = 'ADMIN'
    AND p.is_active = true
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_admin_by_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_admin_by_email(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_get_admin_by_email(text) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_request_password_reset(
  p_email text,
  p_token text,
  p_expires_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_admin RECORD;
  v_new_id uuid;
BEGIN
  SELECT p.user_id, lower(btrim(u.email)) AS email
  INTO v_admin
  FROM public.staff_profiles p
  JOIN auth.users u ON u.id = p.user_id
  WHERE lower(btrim(u.email)) = lower(btrim(p_email))
    AND p.role = 'ADMIN'
    AND p.is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'not_found', true);
  END IF;

  v_new_id := gen_random_uuid();

  INSERT INTO public.admin_password_resets (
    id,
    user_id,
    email,
    token,
    status,
    expires_at,
    created_at
  )
  VALUES (
    v_new_id,
    v_admin.user_id,
    v_admin.email,
    p_token,
    'PENDING',
    p_expires_at,
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'record', jsonb_build_object(
      'id', v_new_id,
      'user_id', v_admin.user_id,
      'email', v_admin.email,
      'token', p_token,
      'status', 'PENDING',
      'expires_at', p_expires_at,
      'created_at', now(),
      'used_at', null
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_request_password_reset(text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_request_password_reset(text, text, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_request_password_reset(text, text, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_verify_password_reset_token(
  p_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_reset public.admin_password_resets%ROWTYPE;
BEGIN
  SELECT * INTO v_reset
  FROM public.admin_password_resets
  WHERE token = btrim(p_token);

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Invalid token');
  END IF;

  IF v_reset.status <> 'PENDING' THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Token already used');
  END IF;

  IF now() > v_reset.expires_at THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Token expired');
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'record', jsonb_build_object(
      'id', v_reset.id,
      'user_id', v_reset.user_id,
      'email', v_reset.email,
      'token', v_reset.token,
      'status', v_reset.status,
      'expires_at', v_reset.expires_at,
      'created_at', v_reset.created_at,
      'used_at', v_reset.used_at
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_verify_password_reset_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_verify_password_reset_token(text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_complete_password_reset(
  p_token text,
  p_new_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_reset public.admin_password_resets%ROWTYPE;
BEGIN
  SELECT * INTO v_reset
  FROM public.admin_password_resets
  WHERE token = btrim(p_token);

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid token');
  END IF;

  IF v_reset.status <> 'PENDING' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Token already used');
  END IF;

  IF now() > v_reset.expires_at THEN
    RETURN jsonb_build_object('success', false, 'error', 'Token expired');
  END IF;

  IF p_new_password IS NULL OR length(p_new_password) < 8 OR p_new_password !~ '[A-Z]' OR p_new_password !~ '[0-9]' OR p_new_password !~ '[^a-zA-Z0-9\s]' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Password must be at least 8 characters long, contain at least 1 uppercase letter, 1 number, and 1 special character');
  END IF;

  -- Update auth user password
  UPDATE auth.users
  SET
    encrypted_password = extensions.crypt(p_new_password::text, extensions.gen_salt('bf'::text)),
    updated_at = now()
  WHERE id = v_reset.user_id;

  -- Mark reset record as used
  UPDATE public.admin_password_resets
  SET
    status = 'USED',
    used_at = now()
  WHERE id = v_reset.id;

  -- Insert audit log entry
  INSERT INTO public.audit_logs (
    id,
    actor_user_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    metadata,
    created_at
  )
  VALUES (
    gen_random_uuid(),
    v_reset.user_id,
    'ADMIN',
    'ADMIN_PASSWORD_RESET',
    'staff_profiles',
    v_reset.user_id,
    jsonb_build_object(
      'email', v_reset.email,
      'method', 'password_reset_flow'
    ),
    now()
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_complete_password_reset(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_complete_password_reset(text, text) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 12. Admin Reservation Relocation RPC (MF-124)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.relocate_reservation(
  p_reservation_id uuid,
  p_target_workspace_instance_id uuid,
  p_reason text,
  p_notes text DEFAULT NULL,
  p_actor_user_id uuid DEFAULT NULL,
  p_actor_role text DEFAULT 'ADMIN'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res public.reservations%ROWTYPE;
  v_assigned public.reservation_candidates%ROWTYPE;
  v_old_inst public.workspace_instances%ROWTYPE;
  v_target_inst public.workspace_instances%ROWTYPE;
  v_now timestamptz := now();
  v_effective_start timestamptz;
  v_conflict_count integer;
  v_actor_user_id uuid := NULL;
  v_actor_role public.audit_actor_role := 'SYSTEM';
  v_staff_prof public.staff_profiles%ROWTYPE;
BEGIN
  IF p_reservation_id IS NULL THEN
    RAISE EXCEPTION 'reservation_id is required';
  END IF;

  IF p_target_workspace_instance_id IS NULL THEN
    RAISE EXCEPTION 'target_workspace_instance_id is required';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'relocation reason is required';
  END IF;

  SELECT * INTO v_res
  FROM public.reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation % not found', p_reservation_id;
  END IF;

  IF v_res.status NOT IN ('CONFIRMED', 'CHECKED_IN') THEN
    RAISE EXCEPTION 'Only confirmed or checked-in reservations can be relocated (current status: %)', v_res.status;
  END IF;

  SELECT * INTO v_assigned
  FROM public.reservation_candidates
  WHERE reservation_id = p_reservation_id
    AND is_assigned = true
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    SELECT * INTO v_assigned
    FROM public.reservation_candidates
    WHERE reservation_id = p_reservation_id
    ORDER BY rank ASC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF v_assigned.id IS NULL THEN
    RAISE EXCEPTION 'No candidate found for reservation %', p_reservation_id;
  END IF;

  IF v_assigned.workspace_instance_id = p_target_workspace_instance_id THEN
    RAISE EXCEPTION 'Target spot must be different from current spot';
  END IF;

  SELECT * INTO v_old_inst
  FROM public.workspace_instances
  WHERE id = v_assigned.workspace_instance_id;

  SELECT * INTO v_target_inst
  FROM public.workspace_instances
  WHERE id = p_target_workspace_instance_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target workspace instance % not found', p_target_workspace_instance_id;
  END IF;

  IF v_old_inst.id IS NOT NULL AND v_target_inst.template_id <> v_old_inst.template_id THEN
    RAISE EXCEPTION 'Relocation is only allowed to spots of the exact same workspace template (tier)';
  END IF;

  IF upper(COALESCE(v_target_inst.operational_status::text, 'ACTIVE')) IN ('MAINTENANCE', 'INACTIVE') THEN
    RAISE EXCEPTION 'Cannot relocate to a spot that is under maintenance or inactive';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.map_elements me
    JOIN public.map_versions mv ON mv.id = me.map_version_id
    WHERE mv.status = 'PUBLISHED'
      AND me.workspace_instance_id = p_target_workspace_instance_id
  ) THEN
    RAISE EXCEPTION 'Cannot relocate to a workspace spot that is not on the published map';
  END IF;

  v_effective_start := CASE
    WHEN (v_assigned.start_at < v_now AND v_assigned.end_at > v_now) THEN v_now
    ELSE v_assigned.start_at
  END;

  SELECT count(*) INTO v_conflict_count
  FROM public.reservation_candidates rc
  JOIN public.reservations r ON r.id = rc.reservation_id
  WHERE rc.workspace_instance_id = p_target_workspace_instance_id
    AND rc.is_assigned = true
    AND rc.reservation_id <> p_reservation_id
    AND r.status IN ('CONFIRMED', 'CHECKED_IN')
    AND v_effective_start < rc.end_at
    AND v_assigned.end_at > rc.start_at;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'Target workspace spot is already booked for this time window';
  END IF;

  UPDATE public.reservation_candidates
  SET workspace_instance_id = p_target_workspace_instance_id,
      is_assigned = true
  WHERE id = v_assigned.id;

  UPDATE public.reservations
  SET updated_at = v_now
  WHERE id = p_reservation_id;

  -- Resolve actor for audit log
  IF p_actor_user_id IS NOT NULL THEN
    SELECT * INTO v_staff_prof
    FROM public.staff_profiles
    WHERE user_id = p_actor_user_id;

    IF FOUND THEN
      v_actor_user_id := v_staff_prof.user_id;
      v_actor_role := v_staff_prof.role::text::public.audit_actor_role;
    END IF;
  END IF;

  -- If actor was not resolved by p_actor_user_id, find an appropriate active staff profile
  IF v_actor_user_id IS NULL THEN
    IF upper(COALESCE(p_actor_role, '')) = 'STAFF' THEN
      SELECT * INTO v_staff_prof
      FROM public.staff_profiles
      WHERE role = 'STAFF' AND is_active = true
      ORDER BY created_at ASC
      LIMIT 1;
    ELSIF upper(COALESCE(p_actor_role, '')) IN ('ADMIN', 'SUPERADMIN', 'SUPER_ADMIN') THEN
      SELECT * INTO v_staff_prof
      FROM public.staff_profiles
      WHERE role = 'ADMIN' AND is_active = true
      ORDER BY created_at ASC
      LIMIT 1;
    END IF;

    IF FOUND THEN
      v_actor_user_id := v_staff_prof.user_id;
      v_actor_role := v_staff_prof.role::text::public.audit_actor_role;
    ELSE
      -- Fallback to any active staff profile if available
      SELECT * INTO v_staff_prof
      FROM public.staff_profiles
      WHERE is_active = true
      ORDER BY created_at ASC
      LIMIT 1;

      IF FOUND THEN
        v_actor_user_id := v_staff_prof.user_id;
        v_actor_role := v_staff_prof.role::text::public.audit_actor_role;
      ELSE
        -- Fallback to SYSTEM if no staff profile exists in database
        v_actor_user_id := NULL;
        v_actor_role := 'SYSTEM'::public.audit_actor_role;
      END IF;
    END IF;
  END IF;

  INSERT INTO public.audit_logs (
    id,
    actor_user_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    metadata,
    created_at
  )
  VALUES (
    gen_random_uuid(),
    v_actor_user_id,
    v_actor_role,
    'reservation_relocated',
    'reservation',
    p_reservation_id,
    jsonb_build_object(
      'old_instance_id', v_assigned.workspace_instance_id,
      'new_instance_id', p_target_workspace_instance_id,
      'old_workspace_name', COALESCE(v_old_inst.display_name, v_old_inst.instance_code, v_assigned.workspace_instance_id::text),
      'new_workspace_name', COALESCE(v_target_inst.display_name, v_target_inst.instance_code, p_target_workspace_instance_id::text),
      'reason', p_reason,
      'notes', p_notes,
      'relocated_at', v_now,
      'reference_code', v_res.reference_code,
      'in_session', (v_assigned.start_at < v_now AND v_assigned.end_at > v_now),
      'remaining_minutes', CASE WHEN (v_assigned.start_at < v_now AND v_assigned.end_at > v_now) THEN ROUND(EXTRACT(EPOCH FROM (v_assigned.end_at - v_now)) / 60) ELSE NULL END,
      'actor_role', COALESCE(p_actor_role, 'ADMIN')
    ),
    v_now
  );

  RETURN jsonb_build_object(
    'success', true,
    'old_workspace_name', COALESCE(v_old_inst.display_name, v_old_inst.instance_code, v_assigned.workspace_instance_id::text),
    'new_workspace_name', COALESCE(v_target_inst.display_name, v_target_inst.instance_code, p_target_workspace_instance_id::text)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.relocate_reservation(uuid, uuid, text, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.relocate_reservation(uuid, uuid, text, text, uuid, text) TO anon, authenticated, service_role;

COMMIT;
