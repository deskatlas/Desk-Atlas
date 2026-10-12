-- Forward migration: Single-use voucher redemption trigger and payment confirmation integration
-- Traceability: MS-39, PRD-F4, PRD-F6, PRD-F8, PRD-F23, PRD-F24, SDD-C5, SDD-C6, SDD-C14, ERD-E10, ERD-E16, ERD-E18, QAD-TC39

BEGIN;

-- Helper function to atomically redeem voucher for confirmed reservation
CREATE OR REPLACE FUNCTION public.redeem_voucher_for_confirmed_reservation(
  p_reservation_id UUID
)
RETURNS public.vouchers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res public.reservations%ROWTYPE;
  v_voucher_id UUID;
  v_voucher public.vouchers%ROWTYPE;
BEGIN
  IF p_reservation_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_res
  FROM public.reservations
  WHERE id = p_reservation_id;

  IF NOT FOUND OR v_res.status NOT IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED') THEN
    RETURN NULL;
  END IF;

  -- 1. Resolve target voucher by requested_voucher_id
  IF v_res.requested_voucher_id IS NOT NULL THEN
    v_voucher_id := v_res.requested_voucher_id;
  -- 2. Fallback: match by promo code used and customer ID
  ELSIF v_res.promo_code_used IS NOT NULL AND v_res.customer_id IS NOT NULL THEN
    SELECT id INTO v_voucher_id
    FROM public.vouchers
    WHERE promo_code = UPPER(TRIM(v_res.promo_code_used))
      AND customer_id = v_res.customer_id
      AND status = 'AVAILABLE'
      AND redeemed_at IS NULL
    LIMIT 1;
  END IF;

  IF v_voucher_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Atomically transition voucher to USED while satisfying vouchers_redeemed_fields_consistency
  UPDATE public.vouchers
  SET
    status = 'USED',
    redeemed_at = COALESCE(v_res.confirmed_at, now()),
    redeemed_reservation_id = v_res.id,
    redeemed_discount_amount = COALESCE(v_res.discount_amount, 0),
    updated_at = now()
  WHERE id = v_voucher_id
    AND status = 'AVAILABLE'
    AND redeemed_at IS NULL
  RETURNING * INTO v_voucher;

  -- Ensure reservation links to the redeemed voucher if requested_voucher_id was not populated
  IF v_res.requested_voucher_id IS NULL AND v_voucher.id IS NOT NULL THEN
    UPDATE public.reservations
    SET requested_voucher_id = v_voucher.id
    WHERE id = v_res.id;
  END IF;

  RETURN v_voucher;
END;
$$;

-- Trigger function on reservations table
CREATE OR REPLACE FUNCTION public.trg_redeem_reservation_voucher()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED') AND (NEW.requested_voucher_id IS NOT NULL OR NEW.promo_code_used IS NOT NULL) THEN
    PERFORM public.redeem_voucher_for_confirmed_reservation(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reservation_voucher_redemption ON public.reservations;
CREATE TRIGGER trg_reservation_voucher_redemption
  AFTER INSERT OR UPDATE OF status, confirmed_at
  ON public.reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_redeem_reservation_voucher();

-- Update approve_online_payment_and_allocate to invoke voucher redemption
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
  v_should_allocate boolean := false;
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
    v_should_allocate := v_assigned_candidate.id IS NULL
      AND v_reservation.status = 'PAYMENT_UNDER_REVIEW';
  ELSIF v_attempt.status IN ('UNDER_REVIEW', 'REJECTED') THEN
    v_should_allocate := true;
  ELSE
    RAISE EXCEPTION 'Payment attempt % is not in an approvable review state', p_payment_attempt_id;
  END IF;

  IF v_assigned_candidate.id IS NOT NULL THEN
    IF v_reservation.status = 'PAYMENT_UNDER_REVIEW' THEN
      UPDATE public.reservations
      SET
        status = 'CONFIRMED',
        confirmed_at = COALESCE(confirmed_at, v_attempt.processed_at, p_processed_at),
        cancelled_at = NULL,
        cancellation_reason = NULL,
        cancelled_by_user_id = NULL,
        updated_at = p_processed_at
      WHERE id = v_reservation.id;
    END IF;

    PERFORM public.process_confirmed_reservation_identity_and_outbox(
      v_reservation.id,
      COALESCE(v_attempt.processed_at, p_processed_at)
    );

    -- Single-use voucher redemption
    PERFORM public.redeem_voucher_for_confirmed_reservation(v_reservation.id);
  ELSIF v_should_allocate THEN
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

    UPDATE public.payment_attempts AS pa
    SET
      status = 'APPROVED',
      processed_by_user_id = COALESCE(pa.processed_by_user_id, p_processed_by_user_id),
      processed_at = COALESCE(pa.processed_at, p_processed_at),
      rejection_reason = NULL
    WHERE pa.id = v_attempt.id;

    IF v_assigned_candidate.id IS NOT NULL THEN
      UPDATE public.reservations
      SET
        status = 'CONFIRMED',
        confirmed_at = COALESCE(confirmed_at, v_attempt.processed_at, p_processed_at),
        cancelled_at = NULL,
        cancellation_reason = NULL,
        cancelled_by_user_id = NULL,
        updated_at = p_processed_at
      WHERE id = v_reservation.id;

      PERFORM public.process_confirmed_reservation_identity_and_outbox(
        v_reservation.id,
        COALESCE(v_attempt.processed_at, p_processed_at)
      );

      -- Single-use voucher redemption
      PERFORM public.redeem_voucher_for_confirmed_reservation(v_reservation.id);
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
      CASE
        WHEN v_attempt.status = 'REJECTED' THEN 'payment_review_reconsidered_approved'
        WHEN v_attempt.status = 'APPROVED' THEN 'payment_review_allocation_recovered'
        ELSE 'payment_review_completed'
      END,
      'payment_attempt',
      v_attempt.id,
      jsonb_build_object(
        'decision', 'APPROVE',
        'was_reconsidered', v_attempt.status = 'REJECTED',
        'was_partial_transition_recovery', v_attempt.status = 'APPROVED',
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

-- Update confirm_kiosk_payment_and_allocate to invoke voucher redemption
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

      -- Single-use voucher redemption
      PERFORM public.redeem_voucher_for_confirmed_reservation(v_reservation.id);
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

-- Permissions
REVOKE ALL ON FUNCTION public.redeem_voucher_for_confirmed_reservation(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.redeem_voucher_for_confirmed_reservation(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.redeem_voucher_for_confirmed_reservation(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.redeem_voucher_for_confirmed_reservation(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.approve_online_payment_and_allocate(uuid, uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_online_payment_and_allocate(uuid, uuid, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.approve_online_payment_and_allocate(uuid, uuid, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.approve_online_payment_and_allocate(uuid, uuid, timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.confirm_kiosk_payment_and_allocate(uuid, uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_kiosk_payment_and_allocate(uuid, uuid, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.confirm_kiosk_payment_and_allocate(uuid, uuid, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_kiosk_payment_and_allocate(uuid, uuid, timestamptz) TO service_role;

-- Backfill: Redeem vouchers for existing confirmed reservations
UPDATE public.vouchers v
SET
  status = 'USED',
  redeemed_at = COALESCE(r.confirmed_at, r.created_at, now()),
  redeemed_reservation_id = r.id,
  redeemed_discount_amount = COALESCE(r.discount_amount, 0),
  updated_at = now()
FROM public.reservations r
WHERE (
    r.requested_voucher_id = v.id
    OR (
      r.promo_code_used IS NOT NULL
      AND UPPER(TRIM(r.promo_code_used)) = v.promo_code
      AND r.customer_id = v.customer_id
    )
  )
  AND r.status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED')
  AND v.status = 'AVAILABLE'
  AND v.redeemed_at IS NULL;

COMMIT;
