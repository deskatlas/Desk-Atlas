-- 006_guest_loyalty_and_rewards.sql
-- SPEC-1, SPEC-2, SPEC-3: Guest Customer Identity, Campaigns, Vouchers, and Rate Limiting
-- Traceability: ERD-E15, ERD-E16, ERD-E17, ERD-E18, ERD-E19, ERD-E20, ERD-E21, ERD-E22, ERD-E23

BEGIN;

-- 1. ERD-E15: customers
CREATE TABLE IF NOT EXISTS public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_code TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone VARCHAR(30),
  first_confirmed_reservation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. ERD-E16: campaigns
CREATE TABLE IF NOT EXISTS public.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED')),
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  revision INTEGER NOT NULL DEFAULT 1,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_campaign_dates CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at)
);

CREATE INDEX IF NOT EXISTS idx_campaigns_status_window
  ON public.campaigns (status, starts_at, ends_at);

-- 3. ERD-E17: campaign_rules
CREATE TABLE IF NOT EXISTS public.campaign_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE RESTRICT,
  label TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  supersedes_rule_id UUID REFERENCES public.campaign_rules(id) ON DELETE RESTRICT,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at TIMESTAMPTZ,
  rule_definition JSONB NOT NULL,
  reward_type TEXT NOT NULL CHECK (reward_type IN ('PERCENTAGE_DISCOUNT', 'FIXED_AMOUNT_DISCOUNT')),
  reward_value NUMERIC(10,2) NOT NULL,
  max_discount_amount NUMERIC(10,2),
  voucher_validity_days INTEGER NOT NULL DEFAULT 30 CHECK (voucher_validity_days >= 1 AND voucher_validity_days <= 365),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_rule_retired_window CHECK (retired_at IS NULL OR retired_at > effective_from)
);

CREATE INDEX IF NOT EXISTS idx_campaign_rules_window
  ON public.campaign_rules (campaign_id, effective_from, retired_at);

-- 4. ERD-E18: vouchers
CREATE TABLE IF NOT EXISTS public.vouchers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE RESTRICT,
  campaign_rule_id UUID NOT NULL REFERENCES public.campaign_rules(id) ON DELETE RESTRICT,
  promo_code TEXT NOT NULL UNIQUE,
  milestone_index INTEGER NOT NULL CHECK (milestone_index > 0),
  campaign_name_snapshot TEXT NOT NULL,
  reward_snapshot JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'USED', 'EXPIRED')),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  redeemed_at TIMESTAMPTZ,
  redeemed_reservation_id UUID,
  redeemed_discount_amount NUMERIC(10,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_voucher_customer_rule_milestone UNIQUE (customer_id, campaign_rule_id, milestone_index),
  CONSTRAINT chk_voucher_expiry CHECK (expires_at > issued_at)
);

CREATE INDEX IF NOT EXISTS idx_vouchers_customer_issued
  ON public.vouchers (customer_id, issued_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_vouchers_status_expires
  ON public.vouchers (status, expires_at);

-- 5. Add columns to reservations (ERD-E10 extension)
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.customers(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS requested_voucher_id UUID REFERENCES public.vouchers(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS applied_voucher_id UUID REFERENCES public.vouchers(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS gross_amount_due NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS promo_code_used TEXT,
  ADD COLUMN IF NOT EXISTS promo_quote_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS pricing_revision INTEGER NOT NULL DEFAULT 1;

-- Backfill gross_amount_due for existing reservations
UPDATE public.reservations
  SET gross_amount_due = amount_due
  WHERE gross_amount_due = 0 AND amount_due > 0;

CREATE INDEX IF NOT EXISTS idx_reservations_customer
  ON public.reservations (customer_id, confirmed_at, id);

-- Link first_confirmed_reservation_id foreign key on customers
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_customers_first_reservation'
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT fk_customers_first_reservation
      FOREIGN KEY (first_confirmed_reservation_id)
      REFERENCES public.reservations(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- Link redeemed_reservation_id foreign key on vouchers
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_vouchers_redeemed_reservation'
  ) THEN
    ALTER TABLE public.vouchers
      ADD CONSTRAINT fk_vouchers_redeemed_reservation
      FOREIGN KEY (redeemed_reservation_id)
      REFERENCES public.reservations(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- 6. ERD-E19: qualifying_booking_facts
CREATE TABLE IF NOT EXISTS public.qualifying_booking_facts (
  reservation_id UUID PRIMARY KEY REFERENCES public.reservations(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  confirmed_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL,
  workspace_type_id UUID REFERENCES public.workspace_templates(id) ON DELETE RESTRICT,
  net_paid_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  booked_minutes INTEGER NOT NULL,
  is_qualifying BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qualifying_facts_customer
  ON public.qualifying_booking_facts (customer_id, confirmed_at, reservation_id);

-- 7. ERD-E20: reward_processing_jobs
CREATE TABLE IF NOT EXISTS public.reward_processing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('EVALUATE_CUSTOMER', 'RECONCILE_CAMPAIGN')),
  customer_id UUID REFERENCES public.customers(id) ON DELETE RESTRICT,
  campaign_rule_id UUID REFERENCES public.campaign_rules(id) ON DELETE RESTRICT,
  campaign_id UUID REFERENCES public.campaigns(id) ON DELETE RESTRICT,
  source_reservation_id UUID REFERENCES public.reservations(id) ON DELETE RESTRICT,
  rule_ids_snapshot JSONB,
  cursor_customer_id UUID,
  evaluation_cutoff_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'DONE', 'RETRY', 'FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_until TIMESTAMPTZ,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_reward_jobs_status_next
  ON public.reward_processing_jobs (status, next_attempt_at);

-- 8. ERD-E21: notification_outbox
CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('BOOKING_CONFIRMED', 'SAVE_CUSTOMER_ID', 'VOUCHER_EMAIL')),
  customer_id UUID REFERENCES public.customers(id) ON DELETE RESTRICT,
  reservation_id UUID REFERENCES public.reservations(id) ON DELETE RESTRICT,
  voucher_id UUID REFERENCES public.vouchers(id) ON DELETE RESTRICT,
  recipient_email TEXT NOT NULL,
  payload JSONB NOT NULL,
  depends_on_id UUID REFERENCES public.notification_outbox(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'SENT', 'RETRY', 'FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_until TIMESTAMPTZ,
  provider_message_id TEXT,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_outbox_status_next
  ON public.notification_outbox (status, next_attempt_at);

-- 9. ERD-E22: customer_access_challenges
CREATE TABLE IF NOT EXISTS public.customer_access_challenges (
  token_hash TEXT PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  purpose TEXT NOT NULL DEFAULT 'REWARDS_ACCESS' CHECK (purpose = 'REWARDS_ACCESS'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_customer_challenges_expires
  ON public.customer_access_challenges (expires_at);

-- 10. ERD-E23: rate_limit_events
CREATE TABLE IF NOT EXISTS public.rate_limit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL CHECK (scope IN ('VERIFY_IP', 'VERIFY_EMAIL', 'CUSTOMER_TOKEN', 'PROMO_IP', 'PROMO_EMAIL', 'EMAIL_CUSTOMER', 'EMAIL_VOUCHER')),
  subject_hash TEXT NOT NULL,
  request_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_events_lookup
  ON public.rate_limit_events (scope, subject_hash, created_at);

-- Enable Row Level Security (RLS) on all new tables
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qualifying_booking_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reward_processing_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_access_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limit_events ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS by default. Authenticated staff/admins may read campaigns.
CREATE POLICY admin_staff_select_campaigns ON public.campaigns
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY admin_manage_campaigns ON public.campaigns
  FOR ALL TO authenticated
  USING (current_setting('request.jwt.claims', true)::jsonb->>'role' = 'admin')
  WITH CHECK (current_setting('request.jwt.claims', true)::jsonb->>'role' = 'admin');

CREATE POLICY admin_staff_select_rules ON public.campaign_rules
  FOR SELECT TO authenticated
  USING (true);

COMMIT;
