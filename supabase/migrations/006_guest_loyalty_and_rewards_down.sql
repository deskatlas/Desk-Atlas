-- 006_guest_loyalty_and_rewards_down.sql
-- Non-destructive reversal script for testing environments

BEGIN;

DROP TABLE IF EXISTS public.rate_limit_events CASCADE;
DROP TABLE IF EXISTS public.customer_access_challenges CASCADE;
DROP TABLE IF EXISTS public.notification_outbox CASCADE;
DROP TABLE IF EXISTS public.reward_processing_jobs CASCADE;
DROP TABLE IF EXISTS public.qualifying_booking_facts CASCADE;

ALTER TABLE public.reservations
  DROP CONSTRAINT IF EXISTS fk_reservations_requested_voucher,
  DROP CONSTRAINT IF EXISTS fk_reservations_applied_voucher,
  DROP COLUMN IF EXISTS requested_voucher_id,
  DROP COLUMN IF EXISTS applied_voucher_id,
  DROP COLUMN IF EXISTS gross_amount_due,
  DROP COLUMN IF EXISTS discount_amount,
  DROP COLUMN IF EXISTS promo_code_used,
  DROP COLUMN IF EXISTS promo_quote_snapshot,
  DROP COLUMN IF EXISTS pricing_revision,
  DROP COLUMN IF EXISTS customer_id;

DROP TABLE IF EXISTS public.vouchers CASCADE;
DROP TABLE IF EXISTS public.campaign_rules CASCADE;
DROP TABLE IF EXISTS public.campaigns CASCADE;
DROP TABLE IF EXISTS public.customers CASCADE;

COMMIT;
