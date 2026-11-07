-- Down Migration 054: Revert redeem_voucher_for_confirmed_reservation
-- Reverts to definition from 013_voucher_pending_redemption_hold.sql

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
