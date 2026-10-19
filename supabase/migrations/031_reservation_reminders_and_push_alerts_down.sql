-- MS-69 Down Migration: Revert reservation reminders and attendance reconfirmation columns
BEGIN;

DROP INDEX IF EXISTS public.idx_reservations_attendance_reconfirmed;
DROP INDEX IF EXISTS public.idx_reservations_reminder_sent;

ALTER TABLE public.reservations
  DROP COLUMN IF EXISTS attendance_reconfirmed_at,
  DROP COLUMN IF EXISTS reminder_sent_at;

ALTER TABLE public.business_settings
  DROP COLUMN IF EXISTS customer_reminder_advance_value,
  DROP COLUMN IF EXISTS customer_reminder_advance_unit;

COMMIT;
