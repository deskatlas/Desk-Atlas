-- Migration: 006_spec1_guest_customer_identity_down.sql
-- Description: Non-destructive reversal procedure for SPEC-1 guest customer identity and notification outbox
-- Traceability: SPEC-1 Section 4

BEGIN;

-- 1. Revoke public/authenticated execution of SPEC-1 RPCs
REVOKE EXECUTE ON FUNCTION public.process_confirmed_reservation_identity_and_outbox(UUID, TIMESTAMPTZ) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.requeue_notification_outbox_job(UUID) FROM authenticated;

-- 2. Restore confirmation RPCs to baseline without process_confirmed_reservation_identity_and_outbox hook
-- In an unused test database, tables and columns may be dropped if strictly necessary:
-- ALTER TABLE public.reservations DROP COLUMN IF EXISTS customer_id;
-- DROP TABLE IF EXISTS public.notification_outbox CASCADE;
-- DROP TABLE IF EXISTS public.customers CASCADE;

COMMIT;
