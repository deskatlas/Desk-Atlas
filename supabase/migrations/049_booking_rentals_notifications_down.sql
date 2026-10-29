-- Migration: 049_booking_rentals_notifications_down.sql
-- Description: Revert notification tracking timestamps for rental confirmation and ending alert emails

DROP INDEX IF EXISTS public.idx_booking_rentals_end_alert;

ALTER TABLE public.booking_rentals
  DROP COLUMN IF EXISTS confirmation_sent_at,
  DROP COLUMN IF EXISTS end_alert_sent_at;

