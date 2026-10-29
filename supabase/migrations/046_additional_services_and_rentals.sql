-- Migration: 046_additional_services_and_rentals.sql
-- Description: Additional Services Catalog, Rental Pricing & Inventory Architecture, and Alert Settings (MS-88)

CREATE TABLE IF NOT EXISTS public.additional_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  service_type text NOT NULL CHECK (service_type IN ('rental', 'one_time')),
  hourly_rate numeric(10,2) NULL,
  daily_rate numeric(10,2) NULL,
  total_inventory integer NOT NULL DEFAULT 1,
  available_inventory integer NOT NULL DEFAULT 1,
  details text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Constraint: Rental services must have a positive hourly rate and positive inventory
  CONSTRAINT chk_rental_pricing_and_stock CHECK (
    (service_type = 'rental' AND hourly_rate IS NOT NULL AND hourly_rate > 0 AND total_inventory > 0 AND available_inventory >= 0 AND available_inventory <= total_inventory)
    OR
    (service_type = 'one_time' AND (hourly_rate IS NULL OR hourly_rate >= 0))
  ),

  -- Constraint: If daily rate is specified, it must be greater than or equal to hourly rate
  CONSTRAINT chk_daily_rate_greater_or_equal_hourly CHECK (
    daily_rate IS NULL OR hourly_rate IS NULL OR daily_rate >= hourly_rate
  )
);

-- Indexes for active service filtering and type lookups
CREATE INDEX IF NOT EXISTS idx_additional_services_type_active 
  ON public.additional_services (service_type, is_active);

-- Add rental_alert_minutes column to business_settings
ALTER TABLE public.business_settings
  ADD COLUMN IF NOT EXISTS rental_alert_minutes integer NOT NULL DEFAULT 5;

-- Constraint: Rental alert threshold between 1 and 60 minutes
ALTER TABLE public.business_settings
  DROP CONSTRAINT IF EXISTS chk_rental_alert_minutes_range;
ALTER TABLE public.business_settings
  ADD CONSTRAINT chk_rental_alert_minutes_range 
  CHECK (rental_alert_minutes >= 1 AND rental_alert_minutes <= 60);

-- Enable RLS
ALTER TABLE public.additional_services ENABLE ROW LEVEL SECURITY;

-- Policies:
-- SELECT is public for active services or authenticated users
CREATE POLICY "Public read access for active additional services"
  ON public.additional_services
  FOR SELECT
  USING (is_active = true OR auth.role() = 'authenticated');

-- Mutations restricted to authenticated users
CREATE POLICY "Admins full management access for additional services"
  ON public.additional_services
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Comments for schema documentation
COMMENT ON TABLE public.additional_services IS 
  'Auxiliary coworking services including hardware rentals and consumable business services.';
COMMENT ON COLUMN public.additional_services.service_type IS 
  'Discriminator between rental hardware (rental) and informational business services (one_time).';
COMMENT ON COLUMN public.additional_services.hourly_rate IS 
  'Mandatory hourly fee for rental items. Null for one-time services.';
COMMENT ON COLUMN public.additional_services.daily_rate IS 
  'Optional daily fee for rental items. Null for one-time services.';
COMMENT ON COLUMN public.additional_services.total_inventory IS 
  'Total owned quantity of rental hardware units.';
COMMENT ON COLUMN public.additional_services.available_inventory IS 
  'Current unassigned quantity of rental hardware units.';
COMMENT ON COLUMN public.business_settings.rental_alert_minutes IS 
  'Lead time in minutes before rental expiration when staff receives an on-screen alert (default 5).';

