-- Forward Migration: Automated Quarterly Retention Purge Stored Procedure
-- MS87-R02; PRD-F28, BRD-M6, SDD-C25, ERD-E10, ERD-E13, QAD-TC37
BEGIN;

-- 1. Allow retention purge worker to bypass prevent_reservation_delete via session setting
CREATE OR REPLACE FUNCTION public.prevent_reservation_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.retention_purge', true) = 'true' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Reservations are historical business records and may not be hard-deleted';
END;
$$;

-- 2. Allow retention purge worker to bypass prevent_payment_attempt_delete via session setting
CREATE OR REPLACE FUNCTION public.prevent_payment_attempt_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.retention_purge', true) = 'true' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Payment attempts are immutable historical records and may not be hard-deleted';
END;
$$;

-- 3. Stored procedure executing cascade deletion for reservations and transactional records on or before cutoff
CREATE OR REPLACE FUNCTION public.execute_quarterly_retention_purge(p_cutoff_timestamp timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_target_ids uuid[];
  v_res_count int := 0;
  v_pay_count int := 0;
  v_voucher_count int := 0;
BEGIN
  -- 1. Identify purge-eligible reservations created on or before cutoff where no candidate extends past cutoff
  SELECT array_agg(r.id)
  INTO v_target_ids
  FROM public.reservations r
  WHERE r.created_at <= p_cutoff_timestamp
    AND NOT EXISTS (
      SELECT 1
      FROM public.reservation_candidates rc
      WHERE rc.reservation_id = r.id
        AND rc.end_at > p_cutoff_timestamp
    );

  IF v_target_ids IS NULL OR array_length(v_target_ids, 1) IS NULL OR array_length(v_target_ids, 1) = 0 THEN
    RETURN jsonb_build_object(
      'purged_reservations_count', 0,
      'purged_payment_attempts_count', 0,
      'purged_vouchers_count', 0
    );
  END IF;

  -- 2. Activate retention purge session bypass for protected tables
  PERFORM set_config('app.retention_purge', 'true', true);

  -- 3. Nullify customer first_confirmed_reservation_id references (strictly retain profile facts)
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'first_confirmed_reservation_id') THEN
    UPDATE public.customers
    SET first_confirmed_reservation_id = NULL
    WHERE first_confirmed_reservation_id = ANY(v_target_ids);
  END IF;

  -- 4. Break circular foreign keys: nullify requested_voucher_id and applied_voucher_id on reservations
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'reservations') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'reservations' AND column_name = 'requested_voucher_id') THEN
      UPDATE public.reservations
      SET requested_voucher_id = NULL
      WHERE requested_voucher_id IS NOT NULL;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'reservations' AND column_name = 'applied_voucher_id') THEN
      UPDATE public.reservations
      SET applied_voucher_id = NULL
      WHERE applied_voucher_id IS NOT NULL;
    END IF;
  END IF;

  -- 5. Delete notification_outbox records referencing target reservations or vouchers
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'notification_outbox') THEN
    DELETE FROM public.notification_outbox
    WHERE reservation_id = ANY(v_target_ids)
       OR voucher_id IS NOT NULL;
  END IF;

  -- 6. Delete qualifying_booking_facts if present
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'qualifying_booking_facts') THEN
    DELETE FROM public.qualifying_booking_facts
    WHERE reservation_id = ANY(v_target_ids);
  END IF;

  -- 7. Delete reward_work & reward_processing_jobs references if present
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'reward_work') THEN
    DELETE FROM public.reward_work
    WHERE source_reservation_id = ANY(v_target_ids);
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'reward_processing_jobs') THEN
    DELETE FROM public.reward_processing_jobs
    WHERE source_reservation_id = ANY(v_target_ids);
  END IF;

  -- 8. Nullify rewards ledger references if present
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'customer_rewards_ledger') THEN
    UPDATE public.customer_rewards_ledger
    SET source_reservation_id = NULL
    WHERE source_reservation_id = ANY(v_target_ids);
  END IF;

  -- 9. Delete paid_candidate_recovery records
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'paid_candidate_recovery') THEN
    DELETE FROM public.paid_candidate_recovery
    WHERE reservation_id = ANY(v_target_ids);
  END IF;

  -- 10. Delete vouchers (all quarterly promotional/reward vouchers)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'vouchers') THEN
    WITH deleted_vouchers AS (
      DELETE FROM public.vouchers
      WHERE pending_reservation_id = ANY(v_target_ids)
         OR redeemed_reservation_id = ANY(v_target_ids)
         OR created_at <= p_cutoff_timestamp
      RETURNING id
    )
    SELECT count(*) INTO v_voucher_count FROM deleted_vouchers;
  END IF;

  -- 11. Delete payment_attempts (protected by prevent_payment_attempt_delete with bypass)
  WITH deleted_payments AS (
    DELETE FROM public.payment_attempts
    WHERE reservation_id = ANY(v_target_ids)
    RETURNING id
  )
  SELECT count(*) INTO v_pay_count FROM deleted_payments;

  -- 12. Delete reservation_candidates
  DELETE FROM public.reservation_candidates
  WHERE reservation_id = ANY(v_target_ids);

  -- 13. Delete reservations (protected by prevent_reservation_delete with bypass)
  WITH deleted_reservations AS (
    DELETE FROM public.reservations
    WHERE id = ANY(v_target_ids)
    RETURNING id
  )
  SELECT count(*) INTO v_res_count FROM deleted_reservations;

  -- 14. Reset session bypass
  PERFORM set_config('app.retention_purge', 'false', true);

  RETURN jsonb_build_object(
    'purged_reservations_count', v_res_count,
    'purged_payment_attempts_count', v_pay_count,
    'purged_vouchers_count', v_voucher_count
  );
END;
$$;

COMMENT ON FUNCTION public.execute_quarterly_retention_purge(timestamptz) IS
  'Purges historical reservations, candidates, payment attempts, vouchers, and child records on or before cutoff date while retaining customer profiles.';

COMMIT;
