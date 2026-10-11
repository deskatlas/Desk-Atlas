-- MS-35 / QAD-TC35: Canonicalize historical hotfix columns without rewriting history.
BEGIN;

ALTER TABLE public.business_settings
  ADD COLUMN IF NOT EXISTS facebook_url text,
  ADD COLUMN IF NOT EXISTS instagram_url text,
  ADD COLUMN IF NOT EXISTS twitter_url text,
  ADD COLUMN IF NOT EXISTS website_url text,
  ADD COLUMN IF NOT EXISTS booking_end_alert_minutes integer NOT NULL DEFAULT 5;

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS customer_contact_number varchar(30) NULL,
  ADD COLUMN IF NOT EXISTS booked_rate_per_hour numeric(10,2) NULL;

ALTER TABLE public.workspace_instances
  ADD COLUMN IF NOT EXISTS maintenance_note text NULL;

ALTER TABLE public.business_settings
  DROP CONSTRAINT IF EXISTS business_settings_booking_interval_bound,
  DROP CONSTRAINT IF EXISTS business_settings_booking_interval_positive;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'business_settings'
      AND c.conname = 'business_settings_booking_interval_bound'
  ) THEN
    ALTER TABLE public.business_settings
      ADD CONSTRAINT business_settings_booking_interval_bound
      CHECK (booking_interval_minutes >= 1 AND booking_interval_minutes <= 1440);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'business_settings'
      AND (
        c.conname = 'business_settings_booking_end_alert_bound'
        OR (c.contype = 'c' AND regexp_replace(pg_get_constraintdef(c.oid), '[[:space:]()]', '', 'g')
          = 'CHECKbooking_end_alert_minutes>=1ANDbooking_end_alert_minutes<=60')
      )
  ) THEN
    ALTER TABLE public.business_settings
      ADD CONSTRAINT business_settings_booking_end_alert_bound
      CHECK (booking_end_alert_minutes >= 1 AND booking_end_alert_minutes <= 60);
  END IF;
END $$;

UPDATE public.reservations
SET booked_rate_per_hour = rate_snapshot
WHERE booked_rate_per_hour IS NULL AND rate_snapshot IS NOT NULL;

DO $$
BEGIN
  IF to_regprocedure('public.publish_map_version(uuid,uuid)') IS NULL
    OR to_regprocedure('public.validate_map_element_integrity()') IS NULL
    OR to_regprocedure('public.current_actor_role()') IS NULL
    OR to_regprocedure('public.is_admin()') IS NULL
    OR to_regprocedure('public.is_staff_or_admin()') IS NULL THEN
    RAISE EXCEPTION 'MS-35 function catalog assertion failed';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.publish_map_version(uuid,uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.publish_map_version(uuid,uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.publish_map_version(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'MS-35 map publishing privilege assertion failed';
  END IF;
END $$;

COMMIT;
