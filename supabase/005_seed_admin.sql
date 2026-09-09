-- ============================================================================
-- DeskAtlas - 005_seed_business_settings.sql
-- Default Business Settings Seed (Admin is initialized exclusively via Google OAuth setup)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Default Business Settings Seed
-- ----------------------------------------------------------------------------

INSERT INTO public.business_settings (
  id,
  business_name,
  timezone,
  booking_interval_minutes,
  payment_expiry_minutes,
  kiosk_timeout_minutes,
  landing_preview_photos
) VALUES (
  1,
  'DeskAtlas Manila',
  'Asia/Manila',
  30,
  60,
  5,
  '[]'::jsonb
) ON CONFLICT (id) DO UPDATE
SET
  business_name = EXCLUDED.business_name,
  timezone = EXCLUDED.timezone,
  booking_interval_minutes = EXCLUDED.booking_interval_minutes,
  payment_expiry_minutes = EXCLUDED.payment_expiry_minutes,
  kiosk_timeout_minutes = EXCLUDED.kiosk_timeout_minutes;
