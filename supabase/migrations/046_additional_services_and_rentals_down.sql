-- Migration: 046_additional_services_and_rentals_down.sql
-- Description: Rollback Additional Services Catalog, Rental Pricing & Inventory Architecture, and Alert Settings (MS-88)

ALTER TABLE public.business_settings 
  DROP CONSTRAINT IF EXISTS chk_rental_alert_minutes_range;
ALTER TABLE public.business_settings 
  DROP COLUMN IF EXISTS rental_alert_minutes;
DROP TABLE IF EXISTS public.additional_services CASCADE;

