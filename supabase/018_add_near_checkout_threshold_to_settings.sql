-- Migration 018: Add near_checkout_threshold_minutes to business_settings

ALTER TABLE public.business_settings
  ADD COLUMN IF NOT EXISTS near_checkout_threshold_minutes INTEGER NOT NULL DEFAULT 15;

-- Ensure threshold is between 5 and 60 minutes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_near_checkout_threshold_range'
  ) THEN
    ALTER TABLE public.business_settings
      ADD CONSTRAINT check_near_checkout_threshold_range
      CHECK (near_checkout_threshold_minutes >= 5 AND near_checkout_threshold_minutes <= 60);
  END IF;
END $$;

COMMENT ON COLUMN public.business_settings.near_checkout_threshold_minutes IS
  'Minutes before reservation checkout time when near-checkout alerts and overview counters trigger (default: 15).';
