-- MF-148: Relax booking_interval_minutes lower bound from > 5 to >= 1
ALTER TABLE business_settings
  DROP CONSTRAINT IF EXISTS business_settings_booking_interval_bound;
ALTER TABLE business_settings
  DROP CONSTRAINT IF EXISTS business_settings_booking_interval_positive;
ALTER TABLE business_settings
  ADD CONSTRAINT business_settings_booking_interval_bound
    CHECK (booking_interval_minutes >= 1 AND booking_interval_minutes <= 1440);

-- MF-150: Add customer_contact_number to reservations
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS customer_contact_number varchar(30) NULL;


-- MF-149: Add booking_end_alert_minutes to business_settings
ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS booking_end_alert_minutes integer NOT NULL DEFAULT 5;
ALTER TABLE business_settings
  DROP CONSTRAINT IF EXISTS business_settings_booking_end_alert_bound;
ALTER TABLE business_settings
  ADD CONSTRAINT business_settings_booking_end_alert_bound
    CHECK (booking_end_alert_minutes >= 1 AND booking_end_alert_minutes <= 60);

-- MF-153: Add maintenance_note to workspace_instances
ALTER TABLE workspace_instances
  ADD COLUMN IF NOT EXISTS maintenance_note text NULL;

-- MF-155: Add booked_rate_per_hour snapshot to reservations
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS booked_rate_per_hour numeric(10,2) NULL;

-- Backfill existing reservations with rate_snapshot
UPDATE reservations
SET booked_rate_per_hour = rate_snapshot
WHERE booked_rate_per_hour IS NULL AND rate_snapshot IS NOT NULL;

-- MF-158: Note — storage bucket size limit configured via Supabase dashboard or storage policy
-- No SQL migration required for bucket size limit. Update via Supabase Storage bucket settings.

-- MF-165: Add social media links and website to business_settings
ALTER TABLE public.business_settings
  ADD COLUMN IF NOT EXISTS facebook_url TEXT,
  ADD COLUMN IF NOT EXISTS instagram_url TEXT,
  ADD COLUMN IF NOT EXISTS twitter_url TEXT,
  ADD COLUMN IF NOT EXISTS website_url TEXT;


