-- Rollback Migration: 048_fix_booking_rentals_guest_customer_id_down.sql
-- Description: Rollback guest customer_id relaxation on booking_rentals

-- 1. Restore NOT NULL constraint on customer_id (only if no null rows exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.booking_rentals WHERE customer_id IS NULL
  ) THEN
    ALTER TABLE public.booking_rentals ALTER COLUMN customer_id SET NOT NULL;
  END IF;
END $$;

