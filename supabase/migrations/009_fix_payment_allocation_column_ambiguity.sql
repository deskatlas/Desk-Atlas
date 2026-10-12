-- Correct ambiguous payment processor columns in atomic online payment allocation.
-- Replaces the RPC even when migration 008 has already been applied.
-- Traceability: PRD-F6, SDD-C5, ERD-E10, ERD-E11, ERD-E13, QAD-TC7 through QAD-TC10.

BEGIN;

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

REVOKE ALL ON FUNCTION public.approve_online_payment_and_allocate(uuid, uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_online_payment_and_allocate(uuid, uuid, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.approve_online_payment_and_allocate(uuid, uuid, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.approve_online_payment_and_allocate(uuid, uuid, timestamptz) TO service_role;

-- Return partial approvals created by the removed multi-request fallback to the review queue.
INSERT INTO public.audit_logs (
  actor_user_id,
  actor_role,
  action,
  entity_type,
  entity_id,
  metadata
)
SELECT
  NULL,
  'SYSTEM',
  'payment_review_partial_transition_requeued',
  'payment_attempt',
  pa.id,
  jsonb_build_object(
    'reservation_id', pa.reservation_id,
    'previous_payment_status', pa.status,
    'reservation_status', r.status
  )
FROM public.payment_attempts pa
JOIN public.reservations r ON r.id = pa.reservation_id
WHERE pa.channel = 'WEB'
  AND pa.status = 'APPROVED'
  AND r.status = 'PAYMENT_UNDER_REVIEW'
  AND NOT EXISTS (
    SELECT 1
    FROM public.reservation_candidates rc
    WHERE rc.reservation_id = r.id
      AND rc.is_assigned = true
  );

UPDATE public.payment_attempts pa
SET
  status = 'UNDER_REVIEW',
  processed_by_user_id = NULL,
  processed_at = NULL,
  rejection_reason = NULL
FROM public.reservations r
WHERE r.id = pa.reservation_id
  AND pa.channel = 'WEB'
  AND pa.status = 'APPROVED'
  AND r.status = 'PAYMENT_UNDER_REVIEW'
  AND NOT EXISTS (
    SELECT 1
    FROM public.reservation_candidates rc
    WHERE rc.reservation_id = r.id
      AND rc.is_assigned = true
  );

COMMIT;


