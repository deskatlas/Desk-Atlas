-- Forward migration: Automated campaign qualifying facts confirmation trigger
-- Traceability: MS-36, PRD-F23, SDD-C5, SDD-C6, SDD-C14, ERD-E18, ERD-E19, QAD-TC36

BEGIN;

-- Helper function to record qualifying booking fact for confirmed reservation
CREATE OR REPLACE FUNCTION public.record_qualifying_booking_fact_for_reservation(
  p_reservation_id UUID
)
RETURNS public.qualifying_booking_facts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res public.reservations%ROWTYPE;
  v_template_id UUID;
  v_start_at TIMESTAMPTZ;
  v_end_at TIMESTAMPTZ;
  v_fact public.qualifying_booking_facts%ROWTYPE;
  v_minutes INTEGER;
BEGIN
  IF p_reservation_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_res
  FROM public.reservations
  WHERE id = p_reservation_id;

  IF NOT FOUND OR v_res.status NOT IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED') OR v_res.customer_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- 1. Try to resolve candidate from assigned candidate
  SELECT
    rc.start_at,
    rc.end_at,
    wi.template_id
  INTO
    v_start_at,
    v_end_at,
    v_template_id
  FROM public.reservation_candidates rc
  JOIN public.workspace_instances wi ON wi.id = rc.workspace_instance_id
  WHERE rc.reservation_id = v_res.id
    AND rc.is_assigned = true
  LIMIT 1;

  -- 2. Fallback to main candidate (rank 0) if assignment is still pending in transaction
  IF v_template_id IS NULL THEN
    SELECT
      rc.start_at,
      rc.end_at,
      wi.template_id
    INTO
      v_start_at,
      v_end_at,
      v_template_id
    FROM public.reservation_candidates rc
    JOIN public.workspace_instances wi ON wi.id = rc.workspace_instance_id
    WHERE rc.reservation_id = v_res.id
    ORDER BY rc.rank ASC
    LIMIT 1;
  END IF;

  IF v_template_id IS NULL THEN
    RETURN NULL;
  END IF;

  v_minutes := GREATEST(1, ROUND(EXTRACT(EPOCH FROM (v_end_at - v_start_at)) / 60)::integer);

  INSERT INTO public.qualifying_booking_facts (
    reservation_id,
    customer_id,
    confirmed_at,
    source,
    workspace_type_id,
    net_paid_amount,
    booked_minutes,
    is_qualifying,
    created_at
  ) VALUES (
    v_res.id,
    v_res.customer_id,
    COALESCE(v_res.confirmed_at, now()),
    v_res.source,
    v_template_id,
    COALESCE(v_res.amount_due, 0),
    v_minutes,
    true,
    now()
  )
  ON CONFLICT (reservation_id) DO NOTHING
  RETURNING * INTO v_fact;

  RETURN v_fact;
END;
$$;

-- Trigger function on reservations table
CREATE OR REPLACE FUNCTION public.trg_record_qualifying_booking_fact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED') AND NEW.customer_id IS NOT NULL THEN
    PERFORM public.record_qualifying_booking_fact_for_reservation(NEW.id);
  ELSIF NEW.status = 'CANCELLED' THEN
    UPDATE public.qualifying_booking_facts
    SET is_qualifying = false
    WHERE reservation_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reservation_qualifying_fact ON public.reservations;
CREATE TRIGGER trg_reservation_qualifying_fact
  AFTER INSERT OR UPDATE OF status, customer_id
  ON public.reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_record_qualifying_booking_fact();

-- Support VOUCHER_AWARDED in notification_outbox constraints
ALTER TABLE public.notification_outbox
  DROP CONSTRAINT IF EXISTS chk_outbox_kind_requirements;

ALTER TABLE public.notification_outbox
  DROP CONSTRAINT IF EXISTS notification_outbox_kind_check;

ALTER TABLE public.notification_outbox
  ADD CONSTRAINT notification_outbox_kind_check
  CHECK (kind IN ('BOOKING_CONFIRMED', 'SAVE_CUSTOMER_ID', 'VOUCHER_EMAIL', 'VOUCHER_AWARDED'));

ALTER TABLE public.notification_outbox
  ADD CONSTRAINT chk_outbox_kind_requirements
  CHECK (
    (kind = 'BOOKING_CONFIRMED' AND reservation_id IS NOT NULL) OR
    (kind = 'SAVE_CUSTOMER_ID' AND customer_id IS NOT NULL AND depends_on_id IS NOT NULL) OR
    (kind IN ('VOUCHER_EMAIL', 'VOUCHER_AWARDED') AND customer_id IS NOT NULL)
  );

REVOKE ALL ON FUNCTION public.record_qualifying_booking_fact_for_reservation(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_qualifying_booking_fact_for_reservation(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_qualifying_booking_fact_for_reservation(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_qualifying_booking_fact_for_reservation(UUID) TO authenticated;

-- Backfill existing confirmed, checked-in, or completed reservations
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id FROM public.reservations
    WHERE status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED')
      AND customer_id IS NOT NULL
  LOOP
    PERFORM public.record_qualifying_booking_fact_for_reservation(r.id);
  END LOOP;
END;
$$;

COMMIT;

