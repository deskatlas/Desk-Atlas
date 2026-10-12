-- DeskAtlas: Campaigns, Rules, Vouchers, Qualifying Facts, and Reward Work Migration
-- Traceability: SPEC-2, PRD-F23, SDD-C14, ERD-E16 through ERD-E20, QAD-TC37
-- Non-destructive forward migration with pairing reversal instructions.

BEGIN;

-- 1. Campaigns Table (ERD-E16)
CREATE TABLE IF NOT EXISTS public.campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  starts_at timestamptz NULL,
  ends_at timestamptz NULL,
  activated_at timestamptz NULL,
  revision integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaigns_name_length CHECK (
    btrim(name) <> '' AND length(btrim(name)) <= 120
  ),
  CONSTRAINT campaigns_description_length CHECK (
    description IS NULL OR length(description) <= 2000
  ),
  CONSTRAINT campaigns_status_check CHECK (
    status IN ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED')
  ),
  CONSTRAINT campaigns_window_valid CHECK (
    starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at
  ),
  CONSTRAINT campaigns_revision_positive CHECK (revision >= 1),
  CONSTRAINT campaigns_created_by_fk
    FOREIGN KEY (created_by)
    REFERENCES public.staff_profiles(user_id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_campaigns_status_window
  ON public.campaigns (status, starts_at, ends_at);

-- 2. Campaign Rules Table (ERD-E17)
CREATE TABLE IF NOT EXISTS public.campaign_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  label text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  supersedes_rule_id uuid NULL,
  effective_from timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz NULL,
  rule_definition jsonb NOT NULL,
  reward_type text NOT NULL,
  reward_value numeric(10,2) NOT NULL,
  max_discount_amount numeric(10,2) NULL,
  voucher_validity_days integer NOT NULL DEFAULT 30,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_rules_label_length CHECK (
    btrim(label) <> '' AND length(btrim(label)) <= 120
  ),
  CONSTRAINT campaign_rules_version_positive CHECK (version >= 1),
  CONSTRAINT campaign_rules_window_valid CHECK (
    retired_at IS NULL OR retired_at > effective_from
  ),
  CONSTRAINT campaign_rules_reward_type_check CHECK (
    reward_type IN ('PERCENTAGE_DISCOUNT', 'FIXED_AMOUNT_DISCOUNT')
  ),
  CONSTRAINT campaign_rules_reward_value_check CHECK (
    (reward_type = 'PERCENTAGE_DISCOUNT' AND reward_value > 0 AND reward_value < 100) OR
    (reward_type = 'FIXED_AMOUNT_DISCOUNT' AND reward_value > 0)
  ),
  CONSTRAINT campaign_rules_max_discount_amount_check CHECK (
    (reward_type = 'PERCENTAGE_DISCOUNT' AND (max_discount_amount IS NULL OR max_discount_amount > 0)) OR
    (reward_type = 'FIXED_AMOUNT_DISCOUNT' AND max_discount_amount IS NULL)
  ),
  CONSTRAINT campaign_rules_validity_days_check CHECK (
    voucher_validity_days >= 1 AND voucher_validity_days <= 365
  ),
  CONSTRAINT campaign_rules_campaign_fk
    FOREIGN KEY (campaign_id)
    REFERENCES public.campaigns(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT campaign_rules_supersedes_fk
    FOREIGN KEY (supersedes_rule_id)
    REFERENCES public.campaign_rules(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_campaign_rules_lookup
  ON public.campaign_rules (campaign_id, effective_from, retired_at);

-- 3. Vouchers Table (ERD-E18)
CREATE TABLE IF NOT EXISTS public.vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  campaign_rule_id uuid NOT NULL,
  promo_code text NOT NULL,
  milestone_index integer NOT NULL,
  campaign_name_snapshot text NOT NULL,
  reward_snapshot jsonb NOT NULL,
  status text NOT NULL DEFAULT 'AVAILABLE',
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  redeemed_at timestamptz NULL,
  redeemed_reservation_id uuid NULL,
  redeemed_discount_amount numeric(10,2) NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_vouchers_promo_code UNIQUE (promo_code),
  CONSTRAINT uq_vouchers_customer_rule_milestone UNIQUE (customer_id, campaign_rule_id, milestone_index),
  CONSTRAINT vouchers_promo_code_format CHECK (
    length(promo_code) = 8 AND
    promo_code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$'
  ),
  CONSTRAINT vouchers_milestone_positive CHECK (milestone_index >= 1),
  CONSTRAINT vouchers_expiry_valid CHECK (expires_at > issued_at),
  CONSTRAINT vouchers_status_check CHECK (
    status IN ('AVAILABLE', 'USED', 'EXPIRED')
  ),
  CONSTRAINT vouchers_redeemed_fields_consistency CHECK (
    (status = 'USED' AND redeemed_at IS NOT NULL AND redeemed_reservation_id IS NOT NULL AND redeemed_discount_amount IS NOT NULL) OR
    (status <> 'USED' AND redeemed_at IS NULL AND redeemed_reservation_id IS NULL AND redeemed_discount_amount IS NULL)
  ),
  CONSTRAINT vouchers_redeemed_discount_nonnegative CHECK (
    redeemed_discount_amount IS NULL OR redeemed_discount_amount >= 0
  ),
  CONSTRAINT vouchers_customer_fk
    FOREIGN KEY (customer_id)
    REFERENCES public.customers(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT vouchers_campaign_fk
    FOREIGN KEY (campaign_id)
    REFERENCES public.campaigns(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT vouchers_rule_fk
    FOREIGN KEY (campaign_rule_id)
    REFERENCES public.campaign_rules(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT vouchers_redeemed_reservation_fk
    FOREIGN KEY (redeemed_reservation_id)
    REFERENCES public.reservations(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

-- Partial unique index: at most one voucher redeemed per reservation
CREATE UNIQUE INDEX IF NOT EXISTS uq_vouchers_redeemed_reservation
  ON public.vouchers (redeemed_reservation_id)
  WHERE redeemed_reservation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vouchers_customer_issued
  ON public.vouchers (customer_id, issued_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_vouchers_status_expires
  ON public.vouchers (status, expires_at);

-- 4. Qualifying Booking Facts Table (ERD-E19)
CREATE TABLE IF NOT EXISTS public.qualifying_booking_facts (
  reservation_id uuid PRIMARY KEY,
  customer_id uuid NOT NULL,
  confirmed_at timestamptz NOT NULL,
  source public.reservation_source NOT NULL,
  workspace_type_id uuid NOT NULL,
  net_paid_amount numeric(10,2) NOT NULL,
  booked_minutes integer NOT NULL,
  is_qualifying boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qbf_reservation_fk
    FOREIGN KEY (reservation_id)
    REFERENCES public.reservations(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT qbf_customer_fk
    FOREIGN KEY (customer_id)
    REFERENCES public.customers(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT qbf_workspace_type_fk
    FOREIGN KEY (workspace_type_id)
    REFERENCES public.workspace_templates(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT qbf_net_paid_nonnegative CHECK (net_paid_amount >= 0),
  CONSTRAINT qbf_booked_minutes_positive CHECK (booked_minutes > 0)
);

CREATE INDEX IF NOT EXISTS idx_qbf_customer_confirmed
  ON public.qualifying_booking_facts (customer_id, confirmed_at, reservation_id);

-- 5. Reward Work Table (ERD-E20)
CREATE TABLE IF NOT EXISTS public.reward_work (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key text NOT NULL,
  kind text NOT NULL,
  customer_id uuid NULL,
  campaign_rule_id uuid NULL,
  campaign_id uuid NULL,
  source_reservation_id uuid NULL,
  rule_ids_snapshot jsonb NULL,
  cursor_customer_id uuid NULL,
  evaluation_cutoff_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz NULL,
  last_error_code text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  CONSTRAINT uq_reward_work_dedupe_key UNIQUE (dedupe_key),
  CONSTRAINT reward_work_kind_check CHECK (
    kind IN ('EVALUATE_CUSTOMER', 'RECONCILE_CAMPAIGN')
  ),
  CONSTRAINT reward_work_status_check CHECK (
    status IN ('PENDING', 'PROCESSING', 'DONE', 'RETRY', 'FAILED')
  ),
  CONSTRAINT reward_work_attempts_nonnegative CHECK (attempts >= 0),
  CONSTRAINT reward_work_completed_at_check CHECK (
    (status = 'DONE' AND completed_at IS NOT NULL) OR
    (status <> 'DONE')
  ),
  CONSTRAINT reward_work_kind_requirements CHECK (
    (kind = 'EVALUATE_CUSTOMER' AND customer_id IS NOT NULL AND campaign_rule_id IS NOT NULL) OR
    (kind = 'RECONCILE_CAMPAIGN' AND campaign_id IS NOT NULL AND rule_ids_snapshot IS NOT NULL)
  ),
  CONSTRAINT reward_work_customer_fk
    FOREIGN KEY (customer_id)
    REFERENCES public.customers(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT reward_work_rule_fk
    FOREIGN KEY (campaign_rule_id)
    REFERENCES public.campaign_rules(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT reward_work_campaign_fk
    FOREIGN KEY (campaign_id)
    REFERENCES public.campaigns(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT reward_work_reservation_fk
    FOREIGN KEY (source_reservation_id)
    REFERENCES public.reservations(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_reward_work_status_next_attempt
  ON public.reward_work (status, next_attempt_at);

-- 6. Row Level Security Policies
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qualifying_booking_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reward_work ENABLE ROW LEVEL SECURITY;

-- Campaigns: Admin full access; Staff read only
DROP POLICY IF EXISTS p_campaigns_admin_all ON public.campaigns;
CREATE POLICY p_campaigns_admin_all ON public.campaigns
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS p_campaigns_staff_read ON public.campaigns;
CREATE POLICY p_campaigns_staff_read ON public.campaigns
  FOR SELECT
  TO authenticated
  USING (public.is_staff_or_admin());

-- Campaign Rules: Admin full access; Staff read only
DROP POLICY IF EXISTS p_campaign_rules_admin_all ON public.campaign_rules;
CREATE POLICY p_campaign_rules_admin_all ON public.campaign_rules
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS p_campaign_rules_staff_read ON public.campaign_rules;
CREATE POLICY p_campaign_rules_staff_read ON public.campaign_rules
  FOR SELECT
  TO authenticated
  USING (public.is_staff_or_admin());

-- Vouchers: Admin read; server operations manage issuance and redemption
DROP POLICY IF EXISTS p_vouchers_admin_read ON public.vouchers;
CREATE POLICY p_vouchers_admin_read ON public.vouchers
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- Qualifying Facts: Admin read
DROP POLICY IF EXISTS p_qbf_admin_read ON public.qualifying_booking_facts;
CREATE POLICY p_qbf_admin_read ON public.qualifying_booking_facts
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- Reward Work: Admin read
DROP POLICY IF EXISTS p_reward_work_admin_read ON public.reward_work;
CREATE POLICY p_reward_work_admin_read ON public.reward_work
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

COMMIT;

-- REVERSAL PROCEDURE (FOR DISPOSABLE TEST ENVIRONMENTS ONLY):
-- DROP POLICY IF EXISTS p_reward_work_admin_read ON public.reward_work;
-- DROP POLICY IF EXISTS p_qbf_admin_read ON public.qualifying_booking_facts;
-- DROP POLICY IF EXISTS p_vouchers_admin_read ON public.vouchers;
-- DROP POLICY IF EXISTS p_campaign_rules_staff_read ON public.campaign_rules;
-- DROP POLICY IF EXISTS p_campaign_rules_admin_all ON public.campaign_rules;
-- DROP POLICY IF EXISTS p_campaigns_staff_read ON public.campaigns;
-- DROP POLICY IF EXISTS p_campaigns_admin_all ON public.campaigns;
-- DROP TABLE IF EXISTS public.reward_work;
-- DROP TABLE IF EXISTS public.qualifying_booking_facts;
-- DROP TABLE IF EXISTS public.vouchers;
-- DROP TABLE IF EXISTS public.campaign_rules;
-- DROP TABLE IF EXISTS public.campaigns;
