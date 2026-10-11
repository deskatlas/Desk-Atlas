-- MF-176: Add reschedule_count column to reservations table
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS reschedule_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.reservations.reschedule_count
  IS 'Tracks how many times this reservation has been rescheduled.';
