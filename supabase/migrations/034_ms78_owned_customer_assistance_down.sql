BEGIN;
DROP FUNCTION IF EXISTS public.customer_assistance_owned_bookings(uuid, uuid, boolean, timestamptz, uuid);
COMMIT;
