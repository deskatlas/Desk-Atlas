-- Migration: 048_fix_booking_rentals_guest_customer_id.sql
-- Description: Allow guest bookings (null customer_id) in booking_rentals and auto-resolve customer by email (Guest-First Lifecycle)

-- 1. Drop NOT NULL constraint on customer_id column in booking_rentals
ALTER TABLE public.booking_rentals ALTER COLUMN customer_id DROP NOT NULL;

-- 2. Update assign_booking_rental function to handle null customer_id and resolve via customer_email
CREATE OR REPLACE FUNCTION public.assign_booking_rental(
  p_reservation_id uuid,
  p_service_id uuid,
  p_billing_mode text,
  p_duration_units integer,
  p_id_notes text,
  p_staff_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_res record;
  v_svc record;
  v_customer_id uuid;
  v_rate numeric(10,2);
  v_total numeric(10,2);
  v_due_at timestamptz;
  v_code text;
  v_rental_id uuid;
BEGIN
  -- 1. Validate active reservation
  SELECT r.id, r.customer_id, r.customer_email, r.customer_first_name, r.customer_last_name, r.reference_code, r.status
  INTO v_res
  FROM public.reservations r
  WHERE r.id = p_reservation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found';
  END IF;

  IF v_res.status NOT IN ('CHECKED_IN', 'CONFIRMED') THEN
    RAISE EXCEPTION 'Customer must have an active checked-in reservation';
  END IF;

  -- Resolve customer_id if missing from reservations
  v_customer_id := v_res.customer_id;
  IF v_customer_id IS NULL AND v_res.customer_email IS NOT NULL AND btrim(v_res.customer_email) <> '' THEN
    SELECT c.id INTO v_customer_id
    FROM public.customers c
    WHERE c.email = lower(btrim(v_res.customer_email))
    LIMIT 1;

    IF v_customer_id IS NOT NULL THEN
      UPDATE public.reservations
      SET customer_id = v_customer_id
      WHERE id = v_res.id AND customer_id IS NULL;
    END IF;
  END IF;

  -- 2. Validate and lock service inventory row
  SELECT s.id, s.service_type, s.hourly_rate, s.daily_rate, s.available_inventory
  INTO v_svc
  FROM public.additional_services s
  WHERE s.id = p_service_id AND s.is_active = true
  FOR UPDATE;

  IF NOT FOUND OR v_svc.service_type <> 'rental' THEN
    RAISE EXCEPTION 'Selected service is not an active rental item';
  END IF;

  IF v_svc.available_inventory < 1 THEN
    RAISE EXCEPTION 'Item is currently out of stock';
  END IF;

  -- 3. Calculate rate and due timestamp
  IF p_billing_mode = 'hourly' THEN
    v_rate := v_svc.hourly_rate;
    v_due_at := now() + (p_duration_units || ' hours')::interval;
  ELSIF p_billing_mode = 'daily' THEN
    IF v_svc.daily_rate IS NULL THEN
      RAISE EXCEPTION 'Daily rate not available for this item';
    END IF;
    v_rate := v_svc.daily_rate;
    v_due_at := now() + (p_duration_units || ' days')::interval;
  ELSE
    RAISE EXCEPTION 'Invalid billing mode';
  END IF;

  v_total := v_rate * p_duration_units;
  v_code := 'RNT-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substring(md5(random()::text) from 1 for 6));

  -- 4. Decrement available inventory
  UPDATE public.additional_services
  SET available_inventory = available_inventory - 1,
      updated_at = now()
  WHERE id = p_service_id;

  -- 5. Insert rental record
  INSERT INTO public.booking_rentals (
    rental_code, reservation_id, customer_id, service_id, unit_count,
    billing_mode, duration_units, rate_applied, total_amount,
    id_verified, id_notes, status, rented_at, due_at, staff_user_id
  ) VALUES (
    v_code, p_reservation_id, v_customer_id, p_service_id, 1,
    p_billing_mode, p_duration_units, v_rate, v_total,
    true, p_id_notes, 'active', now(), v_due_at, p_staff_user_id
  )
  RETURNING id INTO v_rental_id;

  RETURN jsonb_build_object(
    'success', true,
    'rentalId', v_rental_id,
    'rentalCode', v_code,
    'dueAt', v_due_at,
    'totalAmount', v_total
  );
END;
$$;

