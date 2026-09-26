-- Migration 015: Add max_advance_booking_days to business_settings
ALTER TABLE public.business_settings 
  ADD COLUMN IF NOT EXISTS max_advance_booking_days INTEGER NOT NULL DEFAULT 90;

-- Ensure positive constraint between 1 and 365 days
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_max_advance_booking_days_range'
  ) THEN
    ALTER TABLE public.business_settings
      ADD CONSTRAINT check_max_advance_booking_days_range
      CHECK (max_advance_booking_days >= 1 AND max_advance_booking_days <= 365);
  END IF;
END $$;

COMMENT ON COLUMN public.business_settings.max_advance_booking_days IS 
  'Maximum number of days in advance that customers can book reservations (e.g. 50, 80, 100 days).';
