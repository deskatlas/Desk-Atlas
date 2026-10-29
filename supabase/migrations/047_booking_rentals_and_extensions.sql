-- Migration: 047_booking_rentals_and_extensions.sql
-- Description: Staff Operations Rental Desk, Booking QR/ID Lookup, Duration Assignment, and Parity (MS-90)

-- Create booking rentals table
CREATE TABLE IF NOT EXISTS public.booking_rentals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_code text NOT NULL UNIQUE,
  reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE RESTRICT,
  customer_id uuid NULL REFERENCES public.customers(id) ON DELETE SET NULL,
  service_id uuid NOT NULL REFERENCES public.additional_services(id) ON DELETE RESTRICT,
  unit_count integer NOT NULL DEFAULT 1 CHECK (unit_count > 0),
  billing_mode text NOT NULL CHECK (billing_mode IN ('hourly', 'daily')),
  duration_units integer NOT NULL CHECK (duration_units > 0),
  rate_applied numeric(10,2) NOT NULL CHECK (rate_applied > 0),
  total_amount numeric(10,2) NOT NULL CHECK (total_amount >= 0),
  id_verified boolean NOT NULL DEFAULT true,
  id_notes text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('active', 'returned', 'overdue', 'cancelled')) DEFAULT 'active',
  rented_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz NOT NULL,
  returned_at timestamptz NULL,
  staff_user_id uuid NULL REFERENCES auth.users(id),
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Create rental time extensions table
CREATE TABLE IF NOT EXISTS public.rental_extensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id uuid NOT NULL REFERENCES public.booking_rentals(id) ON DELETE CASCADE,
  extension_mode text NOT NULL CHECK (extension_mode IN ('hourly', 'daily')),
  additional_units integer NOT NULL CHECK (additional_units > 0),
  rate_applied numeric(10,2) NOT NULL CHECK (rate_applied > 0),
  additional_amount numeric(10,2) NOT NULL CHECK (additional_amount >= 0),
  previous_due_at timestamptz NOT NULL,
  new_due_at timestamptz NOT NULL,
  staff_user_id uuid NULL REFERENCES auth.users(id),
  extended_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for operational active rental queries and alert polling
CREATE INDEX IF NOT EXISTS idx_booking_rentals_status_due 
  ON public.booking_rentals (status, due_at);
CREATE INDEX IF NOT EXISTS idx_booking_rentals_reservation 
  ON public.booking_rentals (reservation_id);
CREATE INDEX IF NOT EXISTS idx_rental_extensions_rental 
  ON public.rental_extensions (rental_id);

-- Atomic procedure to assign rental and decrement inventory
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

-- Atomic procedure to return item and restore inventory
CREATE OR REPLACE FUNCTION public.return_booking_rental(
  p_rental_id uuid,
  p_staff_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rental record;
BEGIN
  SELECT r.id, r.service_id, r.status
  INTO v_rental
  FROM public.booking_rentals r
  WHERE r.id = p_rental_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rental record not found';
  END IF;

  IF v_rental.status = 'returned' THEN
    RAISE EXCEPTION 'Rental item has already been returned';
  END IF;

  -- Restore inventory
  UPDATE public.additional_services
  SET available_inventory = available_inventory + 1,
      updated_at = now()
  WHERE id = v_rental.service_id;

  -- Update rental record
  UPDATE public.booking_rentals
  SET status = 'returned',
      returned_at = now(),
      staff_user_id = COALESCE(p_staff_user_id, staff_user_id),
      updated_at = now()
  WHERE id = p_rental_id;

  RETURN jsonb_build_object('success', true, 'returnedAt', now());
END;
$$;

-- Atomic procedure to extend rental duration
CREATE OR REPLACE FUNCTION public.extend_booking_rental(
  p_rental_id uuid,
  p_extension_mode text,
  p_additional_units integer,
  p_staff_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rental record;
  v_svc record;
  v_rate numeric(10,2);
  v_additional_amount numeric(10,2);
  v_previous_due_at timestamptz;
  v_new_due_at timestamptz;
  v_extension_id uuid;
BEGIN
  SELECT r.id, r.service_id, r.status, r.due_at, r.total_amount
  INTO v_rental
  FROM public.booking_rentals r
  WHERE r.id = p_rental_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rental record not found';
  END IF;

  IF v_rental.status = 'returned' THEN
    RAISE EXCEPTION 'Cannot extend a returned rental';
  END IF;

  SELECT s.id, s.hourly_rate, s.daily_rate
  INTO v_svc
  FROM public.additional_services s
  WHERE s.id = v_rental.service_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rental service item not found';
  END IF;

  IF p_extension_mode = 'hourly' THEN
    v_rate := v_svc.hourly_rate;
    v_new_due_at := v_rental.due_at + (p_additional_units || ' hours')::interval;
  ELSIF p_extension_mode = 'daily' THEN
    IF v_svc.daily_rate IS NULL THEN
      RAISE EXCEPTION 'Daily rate not available for this item';
    END IF;
    v_rate := v_svc.daily_rate;
    v_new_due_at := v_rental.due_at + (p_additional_units || ' days')::interval;
  ELSE
    RAISE EXCEPTION 'Invalid extension mode';
  END IF;

  v_additional_amount := v_rate * p_additional_units;
  v_previous_due_at := v_rental.due_at;

  INSERT INTO public.rental_extensions (
    rental_id, extension_mode, additional_units, rate_applied,
    additional_amount, previous_due_at, new_due_at, staff_user_id
  ) VALUES (
    p_rental_id, p_extension_mode, p_additional_units, v_rate,
    v_additional_amount, v_previous_due_at, v_new_due_at, p_staff_user_id
  )
  RETURNING id INTO v_extension_id;

  UPDATE public.booking_rentals
  SET due_at = v_new_due_at,
      total_amount = total_amount + v_additional_amount,
      updated_at = now()
  WHERE id = p_rental_id;

  RETURN jsonb_build_object(
    'success', true,
    'extensionId', v_extension_id,
    'previousDueAt', v_previous_due_at,
    'newDueAt', v_new_due_at,
    'additionalAmount', v_additional_amount,
    'totalAmount', v_rental.total_amount + v_additional_amount
  );
END;
$$;

-- Enable RLS
ALTER TABLE public.booking_rentals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_extensions ENABLE ROW LEVEL SECURITY;

-- Policies for authenticated staff and admin
CREATE POLICY "Authenticated users full access to booking_rentals"
  ON public.booking_rentals
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users full access to rental_extensions"
  ON public.rental_extensions
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Comments for documentation
COMMENT ON TABLE public.booking_rentals IS 
  'Tracks physical equipment checkouts assigned to active customer workspace reservations.';
COMMENT ON TABLE public.rental_extensions IS 
  'Audit trail of duration extensions on active equipment rentals.';

