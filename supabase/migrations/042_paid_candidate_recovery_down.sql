-- MS83: disable recovery entry points/workers before rollback. Never erase paid history.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.paid_candidate_recovery) OR EXISTS
    (SELECT 1 FROM public.notification_outbox WHERE kind = 'PAID_CANDIDATE_EXHAUSTED')
  THEN RAISE EXCEPTION 'Retained recovery history requires migration 042; roll back application only'; END IF;
END $$;
DROP TRIGGER paid_recovery_confirmation_payload ON public.notification_outbox;
DROP FUNCTION public.paid_recovery_confirmation_payload();
DROP TRIGGER capture_paid_candidate_exhaustion ON public.reservations;
DROP FUNCTION public.capture_paid_candidate_exhaustion();
DROP FUNCTION public.recover_paid_reservation(text,text,uuid,text,uuid,timestamptz);
DROP FUNCTION public.read_paid_candidate_recovery(text,text);
DROP TABLE public.paid_candidate_recovery;
ALTER TABLE public.notification_outbox DROP CONSTRAINT notification_outbox_kind_check;
ALTER TABLE public.notification_outbox ADD CONSTRAINT notification_outbox_kind_check
  CHECK (kind IN ('BOOKING_CONFIRMED','SAVE_CUSTOMER_ID','VOUCHER_EMAIL'));
ALTER TABLE public.notification_outbox DROP CONSTRAINT chk_outbox_kind_requirements;
ALTER TABLE public.notification_outbox ADD CONSTRAINT chk_outbox_kind_requirements CHECK (
  (kind = 'BOOKING_CONFIRMED' AND reservation_id IS NOT NULL) OR
  (kind = 'SAVE_CUSTOMER_ID' AND customer_id IS NOT NULL AND depends_on_id IS NOT NULL) OR
  (kind = 'VOUCHER_EMAIL' AND customer_id IS NOT NULL));
COMMIT;
