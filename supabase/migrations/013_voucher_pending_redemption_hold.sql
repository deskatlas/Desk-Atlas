-- Forward migration: Voucher pending redemption hold, concurrency abuse prevention, and rejection reactivation
-- Traceability: MS-40, BRD-M1, BRD-M2, BRD-M3, BRD-M5, PRD-F4, PRD-F6, PRD-F8, PRD-F23, PRD-F24, SDD-C5, SDD-C6, SDD-C14, SDD-C15, ERD-E10, ERD-E16, ERD-E18, QAD-TC40

BEGIN;

-- 1. Add pending hold tracking columns to public.vouchers
ALTER TABLE public.vouchers
  ADD COLUMN IF NOT EXISTS pending_reservation_id uuid NULL REFERENCES public.reservations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS held_at timestamptz NULL;

-- 2. Update status constraint to include PENDING_REDEMPTION
ALTER TABLE public.vouchers
  DROP CONSTRAINT IF EXISTS vouchers_status_check;

ALTER TABLE public.vouchers
  ADD CONSTRAINT vouchers_status_check CHECK (
    status IN ('AVAILABLE', 'PENDING_REDEMPTION', 'USED', 'EXPIRED')
  );

-- 3. Replace redeemed fields consistency constraint with lifecycle fields consistency constraint
ALTER TABLE public.vouchers
  DROP CONSTRAINT IF EXISTS vouchers_redeemed_fields_consistency;

ALTER TABLE public.vouchers
  DROP CONSTRAINT IF EXISTS vouchers_lifecycle_fields_consistency;

ALTER TABLE public.vouchers
  ADD CONSTRAINT vouchers_lifecycle_fields_consistency CHECK (
    (
      status = 'USED' AND
      redeemed_at IS NOT NULL AND
      redeemed_reservation_id IS NOT NULL AND
      redeemed_discount_amount IS NOT NULL AND
      pending_reservation_id IS NULL
    ) OR
    (
      status = 'PENDING_REDEMPTION' AND
      pending_reservation_id IS NOT NULL AND
      held_at IS NOT NULL AND
      redeemed_at IS NULL AND
      redeemed_reservation_id IS NULL AND
      redeemed_discount_amount IS NULL
    ) OR
    (
      status IN ('AVAILABLE', 'EXPIRED') AND
      pending_reservation_id IS NULL AND
      redeemed_at IS NULL AND
      redeemed_reservation_id IS NULL AND
      redeemed_discount_amount IS NULL
    )
  );

-- 4. Partial unique index: at most one voucher held per pending reservation
CREATE UNIQUE INDEX IF NOT EXISTS uq_vouchers_pending_reservation
  ON public.vouchers (pending_reservation_id)
  WHERE pending_reservation_id IS NOT NULL;

-- 5. Performance index for pending voucher lookups
CREATE INDEX IF NOT EXISTS idx_vouchers_pending_lookup
  ON public.vouchers (status, pending_reservation_id)
  WHERE status = 'PENDING_REDEMPTION';

-- 6. Helper function: hold voucher for pending reservation
CREATE OR REPLACE FUNCTION public.hold_voucher_for_pending_reservation(
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

  IF NOT FOUND OR v_res.status NOT IN ('PENDING_PAYMENT', 'PAYMENT_UNDER_REVIEW', 'PENDING_COUNTER_CONFIRMATION') THEN
    RETURN NULL;
  END IF;

  -- Resolve voucher by requested_voucher_id or promo_code_used + customer_id
  IF v_res.requested_voucher_id IS NOT NULL THEN
    v_voucher_id := v_res.requested_voucher_id;
  ELSIF v_res.promo_code_used IS NOT NULL AND v_res.customer_id IS NOT NULL THEN
    SELECT id INTO v_voucher_id
    FROM public.vouchers
    WHERE promo_code = UPPER(TRIM(v_res.promo_code_used))
      AND customer_id = v_res.customer_id
      AND status = 'AVAILABLE'
    LIMIT 1;
  END IF;

  IF v_voucher_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Check if already held by this exact reservation
  SELECT * INTO v_voucher
  FROM public.vouchers
  WHERE id = v_voucher_id
    AND pending_reservation_id = v_res.id
    AND status = 'PENDING_REDEMPTION';

  IF FOUND THEN
    RETURN v_voucher;
  END IF;

  -- Atomically acquire hold
  UPDATE public.vouchers
  SET
    status = 'PENDING_REDEMPTION',
    pending_reservation_id = v_res.id,
    held_at = now(),
    updated_at = now()
  WHERE id = v_voucher_id
    AND status = 'AVAILABLE'
    AND pending_reservation_id IS NULL
  RETURNING * INTO v_voucher;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Voucher % is not available for hold (already held or used)', v_voucher_id;
  END IF;

  -- Ensure reservation links to requested_voucher_id
  IF v_res.requested_voucher_id IS NULL THEN
    UPDATE public.reservations
    SET requested_voucher_id = v_voucher.id
    WHERE id = v_res.id;
  END IF;

  RETURN v_voucher;
END;
$$;

-- 7. Helper function: release held voucher for reservation
CREATE OR REPLACE FUNCTION public.release_held_voucher_for_reservation(
  p_reservation_id UUID
)
RETURNS public.vouchers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_voucher public.vouchers%ROWTYPE;
BEGIN
  IF p_reservation_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Atomically revert voucher from PENDING_REDEMPTION to AVAILABLE
  UPDATE public.vouchers
  SET
    status = 'AVAILABLE',
    pending_reservation_id = NULL,
    held_at = NULL,
    updated_at = now()
  WHERE pending_reservation_id = p_reservation_id
    AND status = 'PENDING_REDEMPTION'
  RETURNING * INTO v_voucher;

  RETURN v_voucher;
END;
$$;

-- 8. Updated helper function: redeem voucher for confirmed reservation
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
  -- 2. Fallback: match by promo code used and customer ID or pending reservation hold
  ELSIF v_res.promo_code_used IS NOT NULL AND v_res.customer_id IS NOT NULL THEN
    SELECT id INTO v_voucher_id
    FROM public.vouchers
    WHERE promo_code = UPPER(TRIM(v_res.promo_code_used))
      AND customer_id = v_res.customer_id
      AND (status IN ('AVAILABLE', 'PENDING_REDEMPTION'))
      AND redeemed_at IS NULL
    LIMIT 1;
  ELSE
    SELECT id INTO v_voucher_id
    FROM public.vouchers
    WHERE pending_reservation_id = v_res.id
      AND status = 'PENDING_REDEMPTION'
      AND redeemed_at IS NULL
    LIMIT 1;
  END IF;

  IF v_voucher_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Atomically transition voucher to USED from either PENDING_REDEMPTION or AVAILABLE
  UPDATE public.vouchers
  SET
    status = 'USED',
    redeemed_at = COALESCE(v_res.confirmed_at, now()),
    redeemed_reservation_id = v_res.id,
    redeemed_discount_amount = COALESCE(v_res.discount_amount, 0),
    pending_reservation_id = NULL,
    held_at = NULL,
    updated_at = now()
  WHERE (id = v_voucher_id OR pending_reservation_id = v_res.id)
    AND status IN ('PENDING_REDEMPTION', 'AVAILABLE')
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

-- 9. Trigger on reservations for pending hold acquisition
CREATE OR REPLACE FUNCTION public.trg_hold_reservation_voucher()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('PENDING_PAYMENT', 'PAYMENT_UNDER_REVIEW', 'PENDING_COUNTER_CONFIRMATION')
     AND (NEW.requested_voucher_id IS NOT NULL OR NEW.promo_code_used IS NOT NULL) THEN
    PERFORM public.hold_voucher_for_pending_reservation(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reservation_voucher_pending_hold ON public.reservations;
CREATE TRIGGER trg_reservation_voucher_pending_hold
  AFTER INSERT OR UPDATE OF requested_voucher_id, promo_code_used, status
  ON public.reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_hold_reservation_voucher();

-- 10. Trigger on reservations for releasing hold on terminal cancellation/expiry
CREATE OR REPLACE FUNCTION public.trg_release_reservation_voucher()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('CANCELLED', 'EXPIRED')
     AND OLD.status NOT IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED') THEN
    PERFORM public.release_held_voucher_for_reservation(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reservation_voucher_release_on_terminal_state ON public.reservations;
CREATE TRIGGER trg_reservation_voucher_release_on_terminal_state
  AFTER UPDATE OF status
  ON public.reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_release_reservation_voucher();

-- 11. Update reject_online_payment_attempt stored procedure
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

    -- Release held voucher back to AVAILABLE
    PERFORM public.release_held_voucher_for_reservation(v_reservation.id);

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

-- 12. Update expire_web_payment_session stored procedure
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

  -- Release held voucher back to AVAILABLE
  PERFORM public.release_held_voucher_for_reservation(v_attempt.reservation_id);

  payment_attempt_id := v_attempt.id;
  reservation_id := v_attempt.reservation_id;
  RETURN NEXT;
END;
$$;

-- Permissions
REVOKE ALL ON FUNCTION public.hold_voucher_for_pending_reservation(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hold_voucher_for_pending_reservation(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.hold_voucher_for_pending_reservation(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.hold_voucher_for_pending_reservation(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.release_held_voucher_for_reservation(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_held_voucher_for_reservation(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.release_held_voucher_for_reservation(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_held_voucher_for_reservation(UUID) TO authenticated;

COMMIT;
