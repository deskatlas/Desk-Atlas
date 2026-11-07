-- Migration 054: Redeem Voucher Without Customer ID and Hold Resolution
-- Traceability: MS-107, PRD-F15, SDD-C14, ERD-E18, QAD-TC45

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

  -- 1. Check if voucher is directly held by this reservation ID
  SELECT id INTO v_voucher_id
  FROM public.vouchers
  WHERE pending_reservation_id = v_res.id
    AND status = 'PENDING_REDEMPTION'
    AND redeemed_at IS NULL
  LIMIT 1;

  -- 2. Fallback: requested_voucher_id
  IF v_voucher_id IS NULL AND v_res.requested_voucher_id IS NOT NULL THEN
    v_voucher_id := v_res.requested_voucher_id;
  END IF;

  -- 3. Fallback: match by promo code used
  IF v_voucher_id IS NULL AND v_res.promo_code_used IS NOT NULL THEN
    -- A. Match promo code and customer ID if customer_id exists
    IF v_res.customer_id IS NOT NULL THEN
      SELECT id INTO v_voucher_id
      FROM public.vouchers
      WHERE promo_code = UPPER(TRIM(v_res.promo_code_used))
        AND customer_id = v_res.customer_id
        AND status IN ('AVAILABLE', 'PENDING_REDEMPTION')
        AND redeemed_at IS NULL
      LIMIT 1;
    END IF;

    -- B. Match promo code and customer email join
    IF v_voucher_id IS NULL AND v_res.customer_email IS NOT NULL THEN
      SELECT v.id INTO v_voucher_id
      FROM public.vouchers v
      JOIN public.customers c ON v.customer_id = c.id
      WHERE v.promo_code = UPPER(TRIM(v_res.promo_code_used))
        AND LOWER(TRIM(c.email)) = LOWER(TRIM(v_res.customer_email))
        AND v.status IN ('AVAILABLE', 'PENDING_REDEMPTION')
        AND v.redeemed_at IS NULL
      LIMIT 1;
    END IF;

    -- C. Match promo code directly
    IF v_voucher_id IS NULL THEN
      SELECT id INTO v_voucher_id
      FROM public.vouchers
      WHERE promo_code = UPPER(TRIM(v_res.promo_code_used))
        AND status IN ('AVAILABLE', 'PENDING_REDEMPTION')
        AND redeemed_at IS NULL
      LIMIT 1;
    END IF;
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

-- Unstick existing approved bookings with orphan holds
UPDATE public.vouchers v
SET
  status = 'USED',
  redeemed_at = COALESCE(r.confirmed_at, now()),
  redeemed_reservation_id = r.id,
  redeemed_discount_amount = COALESCE(r.discount_amount, 0),
  pending_reservation_id = NULL,
  held_at = NULL,
  updated_at = now()
FROM public.reservations r
WHERE v.pending_reservation_id = r.id
  AND r.status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED')
  AND v.status = 'PENDING_REDEMPTION'
  AND v.redeemed_at IS NULL;
