-- Migration: 006_spec1_guest_customer_identity.sql
-- Description: Feature Specification 1: Guest Customer Identity and Permanent Customer ID System (SPEC-1)
-- Traceability: SPEC-1, SDD-C13, PRD-F22, ERD-E10, ERD-E15, ERD-E21, QAD-TC36

BEGIN;

-- 1. Business settings cutover timestamp
ALTER TABLE public.business_settings
  ADD COLUMN IF NOT EXISTS rewards_cutover_at TIMESTAMPTZ DEFAULT now();

-- 2. Customers Table (ERD-E15)
CREATE TABLE IF NOT EXISTS public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_code TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone VARCHAR(30),
  first_confirmed_reservation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_customer_code_format CHECK (
    customer_code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$'
  ),
  CONSTRAINT chk_customer_email_normalized CHECK (
    email = lower(btrim(email)) AND length(email) <= 254 AND email ~* '^[a-zA-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$'
  ),
  CONSTRAINT chk_customer_first_name_nonblank CHECK (btrim(first_name) <> ''),
  CONSTRAINT chk_customer_last_name_nonblank CHECK (btrim(last_name) <> '')
);

-- Mutual foreign key with deferrable constraint
ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS fk_customers_first_reservation;

ALTER TABLE public.customers
  ADD CONSTRAINT fk_customers_first_reservation
  FOREIGN KEY (first_confirmed_reservation_id)
  REFERENCES public.reservations(id)
  ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;

-- Add customer_id reference to reservations (ERD-E10)
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.customers(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_reservations_customer_confirmed_id
  ON public.reservations(customer_id, confirmed_at, id);

-- Immutability triggers for customers
CREATE OR REPLACE FUNCTION public.trg_customers_immutability_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Customer identities are permanent and cannot be deleted';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id THEN
      RAISE EXCEPTION 'Customer id is immutable';
    END IF;
    IF NEW.customer_code <> OLD.customer_code THEN
      RAISE EXCEPTION 'Customer code is immutable';
    END IF;
    IF NEW.email <> OLD.email THEN
      RAISE EXCEPTION 'Customer email is immutable';
    END IF;
    IF NEW.first_confirmed_reservation_id <> OLD.first_confirmed_reservation_id THEN
      RAISE EXCEPTION 'first_confirmed_reservation_id is immutable';
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customers_immutability ON public.customers;
CREATE TRIGGER trg_customers_immutability
  BEFORE UPDATE OR DELETE ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_customers_immutability_guard();

-- 3. Notification Outbox Table (ERD-E21)
CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('BOOKING_CONFIRMED', 'SAVE_CUSTOMER_ID', 'VOUCHER_EMAIL')),
  customer_id UUID REFERENCES public.customers(id) ON DELETE RESTRICT,
  reservation_id UUID REFERENCES public.reservations(id) ON DELETE RESTRICT,
  voucher_id UUID,
  recipient_email TEXT NOT NULL,
  payload JSONB NOT NULL,
  depends_on_id UUID REFERENCES public.notification_outbox(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'SENT', 'RETRY', 'FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_until TIMESTAMPTZ,
  provider_message_id TEXT,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  CONSTRAINT chk_outbox_kind_requirements CHECK (
    (kind = 'BOOKING_CONFIRMED' AND reservation_id IS NOT NULL) OR
    (kind = 'SAVE_CUSTOMER_ID' AND customer_id IS NOT NULL AND depends_on_id IS NOT NULL) OR
    (kind = 'VOUCHER_EMAIL' AND customer_id IS NOT NULL)
  ),
  CONSTRAINT chk_outbox_sent_at CHECK (
    (status = 'SENT' AND sent_at IS NOT NULL) OR
    (status <> 'SENT')
  ),
  CONSTRAINT chk_outbox_no_self_dependency CHECK (
    depends_on_id IS NULL OR depends_on_id <> id
  )
);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_status_next
  ON public.notification_outbox(status, next_attempt_at);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_processing_lease
  ON public.notification_outbox(status, lease_until)
  WHERE status = 'PROCESSING';

-- Immutability triggers for notification_outbox
CREATE OR REPLACE FUNCTION public.trg_notification_outbox_immutability_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id THEN
      RAISE EXCEPTION 'Outbox id is immutable';
    END IF;
    IF NEW.dedupe_key <> OLD.dedupe_key THEN
      RAISE EXCEPTION 'Outbox dedupe_key is immutable';
    END IF;
    IF NEW.kind <> OLD.kind THEN
      RAISE EXCEPTION 'Outbox kind is immutable';
    END IF;
    IF NEW.recipient_email <> OLD.recipient_email THEN
      RAISE EXCEPTION 'Outbox recipient_email is immutable';
    END IF;
    IF NEW.payload <> OLD.payload THEN
      RAISE EXCEPTION 'Outbox payload is immutable';
    END IF;
    IF NEW.depends_on_id IS DISTINCT FROM OLD.depends_on_id THEN
      RAISE EXCEPTION 'Outbox depends_on_id is immutable';
    END IF;
    IF NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
      RAISE EXCEPTION 'Outbox customer_id is immutable';
    END IF;
    IF NEW.reservation_id IS DISTINCT FROM OLD.reservation_id THEN
      RAISE EXCEPTION 'Outbox reservation_id is immutable';
    END IF;
    IF NEW.voucher_id IS DISTINCT FROM OLD.voucher_id THEN
      RAISE EXCEPTION 'Outbox voucher_id is immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notification_outbox_immutability ON public.notification_outbox;
CREATE TRIGGER trg_notification_outbox_immutability
  BEFORE UPDATE ON public.notification_outbox
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notification_outbox_immutability_guard();

-- 4. Identity Resolution and Outbox Enqueue Stored Procedure
CREATE OR REPLACE FUNCTION public.process_confirmed_reservation_identity_and_outbox(
  p_reservation_id UUID,
  p_confirmed_at TIMESTAMPTZ
)
RETURNS public.customers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_reservation public.reservations%ROWTYPE;
  v_normalized_email TEXT;
  v_customer public.customers%ROWTYPE;
  v_is_new_customer BOOLEAN := false;
  v_attempts INTEGER := 0;
  v_random_bytes BYTEA;
  v_customer_code TEXT;
  v_byte_val INTEGER;
  v_char_idx INTEGER;
  v_booking_dedupe_key TEXT;
  v_booking_outbox_id UUID;
  v_save_id_dedupe_key TEXT;
  c_alphabet CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
BEGIN
  IF p_reservation_id IS NULL THEN
    RAISE EXCEPTION 'reservation_id is required';
  END IF;

  SELECT *
    INTO v_reservation
  FROM public.reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation % not found', p_reservation_id;
  END IF;

  IF v_reservation.status NOT IN ('CONFIRMED', 'CHECKED_IN') THEN
    RETURN NULL;
  END IF;

  v_normalized_email := lower(btrim(v_reservation.customer_email));

  -- Transaction advisory lock keyed by normalized email
  PERFORM pg_advisory_xact_lock(hashtext('customer_identity:' || v_normalized_email));

  -- Lookup existing customer
  SELECT *
    INTO v_customer
  FROM public.customers
  WHERE email = v_normalized_email
  FOR UPDATE;

  IF FOUND THEN
    v_is_new_customer := false;
  ELSE
    -- Generate unique 6-character customer code
    v_is_new_customer := true;
    WHILE v_attempts < 20 LOOP
      v_attempts := v_attempts + 1;
      v_random_bytes := gen_random_bytes(6);
      v_customer_code := '';
      FOR i IN 0..5 LOOP
        v_byte_val := get_byte(v_random_bytes, i);
        v_char_idx := (v_byte_val & 31) + 1;
        v_customer_code := v_customer_code || substr(c_alphabet, v_char_idx, 1);
      END LOOP;

      BEGIN
        INSERT INTO public.customers (
          id,
          customer_code,
          email,
          first_name,
          last_name,
          phone,
          first_confirmed_reservation_id,
          created_at,
          updated_at
        ) VALUES (
          gen_random_uuid(),
          v_customer_code,
          v_normalized_email,
          btrim(v_reservation.customer_first_name),
          btrim(v_reservation.customer_last_name),
          v_reservation.customer_contact_number,
          v_reservation.id,
          COALESCE(p_confirmed_at, now()),
          COALESCE(p_confirmed_at, now())
        )
        RETURNING * INTO v_customer;
        EXIT;
      EXCEPTION
        WHEN unique_violation THEN
          -- Email conflict check
          SELECT * INTO v_customer FROM public.customers WHERE email = v_normalized_email FOR UPDATE;
          IF FOUND THEN
            v_is_new_customer := false;
            EXIT;
          END IF;
          -- Code collision: retry loop
          IF v_attempts >= 20 THEN
            RAISE EXCEPTION 'Customer code generation exhausted after 20 attempts';
          END IF;
      END;
    END LOOP;
  END IF;

  -- Link reservation to customer
  UPDATE public.reservations
  SET customer_id = v_customer.id
  WHERE id = v_reservation.id
    AND customer_id IS DISTINCT FROM v_customer.id;

  -- 1. Insert normal Booking Confirmed outbox job
  v_booking_dedupe_key := 'booking-confirmed:' || v_reservation.id::text;

  INSERT INTO public.notification_outbox (
    id,
    dedupe_key,
    kind,
    customer_id,
    reservation_id,
    recipient_email,
    payload,
    depends_on_id,
    status,
    attempts,
    next_attempt_at,
    created_at
  ) VALUES (
    gen_random_uuid(),
    v_booking_dedupe_key,
    'BOOKING_CONFIRMED',
    v_customer.id,
    v_reservation.id,
    v_normalized_email,
    jsonb_build_object(
      'reservationId', v_reservation.id,
      'referenceCode', v_reservation.reference_code,
      'customerFirstName', v_reservation.customer_first_name,
      'customerLastName', v_reservation.customer_last_name,
      'customerEmail', v_normalized_email,
      'amountDue', v_reservation.amount_due,
      'currency', v_reservation.currency
    ),
    NULL,
    'PENDING',
    0,
    now(),
    now()
  )
  ON CONFLICT (dedupe_key) DO NOTHING
  RETURNING id INTO v_booking_outbox_id;

  IF v_booking_outbox_id IS NULL THEN
    SELECT id INTO v_booking_outbox_id
    FROM public.notification_outbox
    WHERE dedupe_key = v_booking_dedupe_key;
  END IF;

  -- 2. Only if creating the identity, insert Save Your Customer ID job depending on confirmation job
  IF v_is_new_customer THEN
    v_save_id_dedupe_key := 'save-customer-id:' || v_customer.id::text;

    INSERT INTO public.notification_outbox (
      id,
      dedupe_key,
      kind,
      customer_id,
      reservation_id,
      recipient_email,
      payload,
      depends_on_id,
      status,
      attempts,
      next_attempt_at,
      created_at
    ) VALUES (
      gen_random_uuid(),
      v_save_id_dedupe_key,
      'SAVE_CUSTOMER_ID',
      v_customer.id,
      v_reservation.id,
      v_normalized_email,
      jsonb_build_object(
        'customerId', v_customer.id,
        'customerCode', v_customer.customer_code,
        'customerEmail', v_normalized_email,
        'customerFirstName', v_customer.first_name,
        'customerLastName', v_customer.last_name
      ),
      v_booking_outbox_id,
      'PENDING',
      0,
      now(),
      now()
    )
    ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;

  RETURN v_customer;
END;
$$;

-- 5. Outbox Claim Procedure for Worker
CREATE OR REPLACE FUNCTION public.claim_due_notification_outbox_jobs(
  p_limit INTEGER DEFAULT 50,
  p_lease_seconds INTEGER DEFAULT 60
)
RETURNS SETOF public.notification_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT o.id
    FROM public.notification_outbox o
    WHERE (
      (o.status IN ('PENDING', 'RETRY') AND o.next_attempt_at <= now())
      OR
      (o.status = 'PROCESSING' AND o.lease_until IS NOT NULL AND o.lease_until <= now())
    )
    AND (
      o.depends_on_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.notification_outbox p
        WHERE p.id = o.depends_on_id
          AND p.status = 'SENT'
      )
    )
    ORDER BY o.next_attempt_at ASC, o.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT COALESCE(p_limit, 50)
  )
  UPDATE public.notification_outbox o
  SET
    status = 'PROCESSING',
    lease_until = now() + (COALESCE(p_lease_seconds, 60) || ' seconds')::interval,
    attempts = o.attempts + 1
  FROM candidates c
  WHERE o.id = c.id
  RETURNING o.*;
END;
$$;

-- 6. Outbox Requeue Procedure for Admins
CREATE OR REPLACE FUNCTION public.requeue_notification_outbox_job(
  p_job_id UUID
)
RETURNS public.notification_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.notification_outbox%ROWTYPE;
BEGIN
  SELECT *
    INTO v_job
  FROM public.notification_outbox
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Notification job % not found', p_job_id;
  END IF;

  IF v_job.status <> 'FAILED' THEN
    RAISE EXCEPTION 'Only FAILED notification jobs can be requeued (current status: %)', v_job.status;
  END IF;

  UPDATE public.notification_outbox
  SET
    status = 'PENDING',
    attempts = 0,
    next_attempt_at = now(),
    lease_until = NULL,
    last_error_code = NULL
  WHERE id = p_job_id
  RETURNING * INTO v_job;

  INSERT INTO public.audit_logs (
    actor_user_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    metadata
  ) VALUES (
    auth.uid(),
    'ADMIN',
    'notification_job_requeued',
    'notification_outbox',
    p_job_id,
    jsonb_build_object(
      'job_id', p_job_id,
      'kind', v_job.kind,
      'recipient_email', v_job.recipient_email
    )
  );

  RETURN v_job;
END;
$$;

-- 7. Hook into existing payment confirmation RPCs
-- In approve_online_payment_and_allocate:
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

    -- Ensure customer identity on replay and recover an assigned partial transition.
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

      -- Process customer identity and outbox atomically
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

-- In confirm_kiosk_payment_and_allocate:
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

    -- Ensure customer identity on replay
    PERFORM public.process_confirmed_reservation_identity_and_outbox(v_reservation.id, v_attempt.processed_at);
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

      -- Process customer identity and outbox atomically
      PERFORM public.process_confirmed_reservation_identity_and_outbox(v_reservation.id, p_processed_at);
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
      v_actor_role,
      'kiosk_counter_payment_confirmed',
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

-- 8. Row-Level Security & Grants
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.customers FROM PUBLIC;
REVOKE ALL ON public.customers FROM anon;
GRANT ALL ON public.customers TO service_role;

REVOKE ALL ON public.notification_outbox FROM PUBLIC;
REVOKE ALL ON public.notification_outbox FROM anon;
GRANT ALL ON public.notification_outbox TO service_role;

-- Authenticated Admin read policies
DROP POLICY IF EXISTS p_admin_customers_select ON public.customers;
CREATE POLICY p_admin_customers_select ON public.customers
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.staff_profiles sp
      WHERE sp.user_id = auth.uid()
        AND sp.role = 'ADMIN'
        AND sp.is_active = true
    )
  );

DROP POLICY IF EXISTS p_admin_outbox_select ON public.notification_outbox;
CREATE POLICY p_admin_outbox_select ON public.notification_outbox
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.staff_profiles sp
      WHERE sp.user_id = auth.uid()
        AND sp.role = 'ADMIN'
        AND sp.is_active = true
    )
  );

-- Function execution grants
REVOKE ALL ON FUNCTION public.process_confirmed_reservation_identity_and_outbox(UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_confirmed_reservation_identity_and_outbox(UUID, TIMESTAMPTZ) FROM anon;
GRANT EXECUTE ON FUNCTION public.process_confirmed_reservation_identity_and_outbox(UUID, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.process_confirmed_reservation_identity_and_outbox(UUID, TIMESTAMPTZ) TO authenticated;

REVOKE ALL ON FUNCTION public.claim_due_notification_outbox_jobs(INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_due_notification_outbox_jobs(INTEGER, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_due_notification_outbox_jobs(INTEGER, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.requeue_notification_outbox_job(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.requeue_notification_outbox_job(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.requeue_notification_outbox_job(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.requeue_notification_outbox_job(UUID) TO authenticated;

COMMIT;
