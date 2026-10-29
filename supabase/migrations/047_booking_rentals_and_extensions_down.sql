-- Rollback Migration: 047_booking_rentals_and_extensions_down.sql
-- Description: Rollback of Staff Operations Rental Desk and Extensions (MS-90)

DROP FUNCTION IF EXISTS public.extend_booking_rental(uuid, text, integer, uuid);
DROP FUNCTION IF EXISTS public.return_booking_rental(uuid, uuid);
DROP FUNCTION IF EXISTS public.assign_booking_rental(uuid, uuid, text, integer, text, uuid);
DROP TABLE IF EXISTS public.rental_extensions CASCADE;
DROP TABLE IF EXISTS public.booking_rentals CASCADE;

