-- Migration: 049_booking_rentals_notifications.sql
-- Description: Add notification tracking timestamps for rental confirmation and ending alert emails

-- 1. Add notification tracking columns to booking_rentals
ALTER TABLE public.booking_rentals
  ADD COLUMN IF NOT EXISTS confirmation_sent_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS end_alert_sent_at timestamptz NULL;

-- 2. Index for active rental end alert queries
CREATE INDEX IF NOT EXISTS idx_booking_rentals_end_alert
  ON public.booking_rentals (status, due_at, end_alert_sent_at);

-- 3. Update extend_booking_rental function to reset end_alert_sent_at upon duration extension
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
  -- 1. Fetch and lock rental
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

  -- 2. Fetch service item rates
  SELECT s.id, s.hourly_rate, s.daily_rate
  INTO v_svc
  FROM public.additional_services s
  WHERE s.id = v_rental.service_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rental service item not found';
  END IF;

  -- 3. Compute rates and new due timestamp
  IF p_extension_mode = 'hourly' THEN
    IF v_svc.hourly_rate IS NULL THEN
      RAISE EXCEPTION 'Hourly rate is required for this item';
    END IF;
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

  -- 4. Insert extension audit record
  INSERT INTO public.rental_extensions (
    rental_id,
    extension_mode,
    additional_units,
    rate_applied,
    additional_amount,
    previous_due_at,
    new_due_at,
    staff_user_id
  ) VALUES (
    p_rental_id,
    p_extension_mode,
    p_additional_units,
    v_rate,
    v_additional_amount,
    v_previous_due_at,
    v_new_due_at,
    p_staff_user_id
  )
  RETURNING id INTO v_extension_id;

  -- 5. Update booking_rentals total amount, due_at, and reset end_alert_sent_at
  UPDATE public.booking_rentals
  SET 
    due_at = v_new_due_at,
    total_amount = total_amount + v_additional_amount,
    end_alert_sent_at = NULL,
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

GRANT EXECUTE ON FUNCTION public.extend_booking_rental(uuid, text, integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.extend_booking_rental(uuid, text, integer, uuid) TO service_role;

