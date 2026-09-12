-- ============================================================================
-- DeskAtlas - 001_schema.sql
-- Core Database Schema: Extensions, Types, Tables, Constraints, Indexes & Triggers
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------------
-- 1. Enum Types
-- ---------------------------------------------------------------------------

CREATE TYPE public.workspace_status AS ENUM (
  'ACTIVE',
  'UNAVAILABLE',
  'MAINTENANCE',
  'BROKEN',
  'INACTIVE'
);

CREATE TYPE public.map_version_status AS ENUM (
  'DRAFT',
  'PUBLISHED',
  'ARCHIVED'
);

CREATE TYPE public.map_element_role AS ENUM (
  'WORKSPACE',
  'STRUCTURE',
  'AMENITY',
  'INFORMATION',
  'EDITOR_AID'
);

CREATE TYPE public.reservation_source AS ENUM (
  'WEB',
  'KIOSK'
);

CREATE TYPE public.reservation_status AS ENUM (
  'PENDING_PAYMENT',
  'PAYMENT_UNDER_REVIEW',
  'PENDING_COUNTER_CONFIRMATION',
  'CONFIRMED',
  'NEEDS_MANUAL_RESOLUTION',
  'CHECKED_IN',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED'
);

CREATE TYPE public.payment_channel AS ENUM (
  'WEB',
  'KIOSK'
);

CREATE TYPE public.payment_status AS ENUM (
  'PENDING',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'CANCELLED'
);

CREATE TYPE public.refund_status AS ENUM (
  'NONE',
  'REQUIRED',
  'REFUNDED'
);

CREATE TYPE public.payment_method_type AS ENUM (
  'GCASH',
  'BANK',
  'CASH'
);

CREATE TYPE public.staff_role AS ENUM (
  'ADMIN',
  'STAFF'
);

CREATE TYPE public.audit_actor_role AS ENUM (
  'ADMIN',
  'STAFF',
  'SYSTEM'
);

CREATE TYPE public.block_scope AS ENUM (
  'BUSINESS',
  'WORKSPACE'
);

CREATE TYPE public.block_type AS ENUM (
  'CLOSURE',
  'MAINTENANCE',
  'MANUAL_UNAVAILABLE',
  'OTHER'
);

CREATE TYPE public.pricing_unit AS ENUM (
  'HOURLY'
);

-- ---------------------------------------------------------------------------
-- 2. Schema Helper Functions
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_reservation_reference()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = public
AS $$
  SELECT lpad(floor(random() * 1000000)::text, 6, '0');
$$;

-- ---------------------------------------------------------------------------
-- 3. Identity Tables
-- ---------------------------------------------------------------------------

CREATE TABLE public.staff_profiles (
  user_id uuid PRIMARY KEY,
  created_by_admin_id uuid NULL,
  role public.staff_role NOT NULL,
  display_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  is_super_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT staff_profiles_user_fk
    FOREIGN KEY (user_id)
    REFERENCES auth.users(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,

  CONSTRAINT staff_profiles_created_by_admin_fk
    FOREIGN KEY (created_by_admin_id)
    REFERENCES public.staff_profiles(user_id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,

  CONSTRAINT staff_profiles_display_name_nonblank
    CHECK (btrim(display_name) <> '')
);

CREATE TABLE public.staff_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  display_name text NOT NULL,
  role public.staff_role NOT NULL DEFAULT 'STAFF',
  temporary_password text NULL,
  verification_code text NOT NULL,
  token text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'PENDING',
  expires_at timestamptz NOT NULL,
  created_by_admin_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT staff_invitations_created_by_admin_fk
    FOREIGN KEY (created_by_admin_id)
    REFERENCES public.staff_profiles(user_id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,

  CONSTRAINT staff_invitations_status_check
    CHECK (status IN ('PENDING', 'CONFIRMED', 'EXPIRED', 'CANCELLED')),

  CONSTRAINT staff_invitations_email_nonblank
    CHECK (btrim(email) <> '' AND position('@' in email) > 0),

  CONSTRAINT staff_invitations_display_name_nonblank
    CHECK (btrim(display_name) <> '')
);

CREATE TABLE public.admin_password_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  email text NOT NULL,
  token text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'PENDING',
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz NULL,

  CONSTRAINT admin_password_resets_user_id_fk
    FOREIGN KEY (user_id)
    REFERENCES public.staff_profiles(user_id)
    ON UPDATE RESTRICT
    ON DELETE CASCADE,

  CONSTRAINT admin_password_resets_status_check
    CHECK (status IN ('PENDING', 'USED', 'EXPIRED')),

  CONSTRAINT admin_password_resets_email_nonblank
    CHECK (btrim(email) <> '' AND position('@' in email) > 0)
);

-- Role Resolution Helper Functions
CREATE OR REPLACE FUNCTION public.current_actor_role()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN 'ANON';
  END IF;

  SELECT role INTO v_role
  FROM public.staff_profiles
  WHERE user_id = auth.uid() AND is_active = true;

  RETURN COALESCE(v_role, 'ANON');
END;
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN (public.current_actor_role() = 'ADMIN');
END;
$$;

CREATE OR REPLACE FUNCTION public.is_staff_or_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_role text := public.current_actor_role();
BEGIN
  RETURN (v_role = 'ADMIN' OR v_role = 'STAFF');
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Configuration Tables
-- ---------------------------------------------------------------------------

CREATE TABLE public.business_settings (
  id smallint PRIMARY KEY DEFAULT 1,
  business_name text NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Manila',
  contact_email text,
  contact_phone text,
  booking_interval_minutes integer NOT NULL,
  payment_expiry_minutes integer NOT NULL DEFAULT 60,
  kiosk_timeout_minutes integer,
  landing_preview_photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_by_user_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT business_settings_singleton CHECK (id = 1),
  CONSTRAINT business_settings_business_name_nonblank CHECK (btrim(business_name) <> ''),
  CONSTRAINT business_settings_booking_interval_positive CHECK (booking_interval_minutes > 0),
  CONSTRAINT business_settings_booking_interval_day_bound CHECK (booking_interval_minutes <= 1440),
  CONSTRAINT business_settings_payment_expiry_positive CHECK (payment_expiry_minutes > 0),
  CONSTRAINT business_settings_kiosk_timeout_positive
    CHECK (kiosk_timeout_minutes IS NULL OR kiosk_timeout_minutes > 0),

  CONSTRAINT business_settings_updated_by_fk
    FOREIGN KEY (updated_by_user_id)
    REFERENCES public.staff_profiles(user_id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION public.get_business_timezone()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT timezone FROM public.business_settings WHERE id = 1),
    'Asia/Manila'
  );
$$;

CREATE TABLE public.operating_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_of_week smallint NOT NULL,
  opens_at time NOT NULL,
  closes_at time NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT operating_hours_day_of_week_valid CHECK (day_of_week BETWEEN 0 AND 6),
  CONSTRAINT operating_hours_same_day_interval CHECK (opens_at < closes_at)
);

-- ---------------------------------------------------------------------------
-- 5. Workspace and Floor Entities
-- ---------------------------------------------------------------------------

CREATE TABLE public.workspace_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  photo_path text,
  capacity integer NOT NULL,
  rate_amount numeric(10,2) NOT NULL,
  pricing_unit public.pricing_unit NOT NULL DEFAULT 'HOURLY',
  default_shape text NOT NULL,
  default_color text NOT NULL,
  default_style jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT workspace_templates_name_nonblank CHECK (btrim(name) <> ''),
  CONSTRAINT workspace_templates_capacity_positive CHECK (capacity > 0),
  CONSTRAINT workspace_templates_rate_nonnegative CHECK (rate_amount >= 0),
  CONSTRAINT workspace_templates_shape_nonblank CHECK (btrim(default_shape) <> ''),
  CONSTRAINT workspace_templates_color_nonblank CHECK (btrim(default_color) <> ''),
  CONSTRAINT workspace_templates_default_style_object
    CHECK (jsonb_typeof(default_style) = 'object')
);

CREATE TABLE public.floors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  floor_number integer,
  display_order integer NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT floors_name_nonblank CHECK (btrim(name) <> ''),
  CONSTRAINT floors_display_order_nonnegative CHECK (display_order >= 0)
);

CREATE TABLE public.workspace_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL,
  floor_id uuid NOT NULL,
  instance_code text NOT NULL,
  display_name text NOT NULL,
  operational_status public.workspace_status NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT workspace_instances_template_fk
    FOREIGN KEY (template_id)
    REFERENCES public.workspace_templates(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,

  CONSTRAINT workspace_instances_floor_fk
    FOREIGN KEY (floor_id)
    REFERENCES public.floors(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,

  CONSTRAINT workspace_instances_code_nonblank CHECK (btrim(instance_code) <> ''),
  CONSTRAINT workspace_instances_display_name_nonblank CHECK (btrim(display_name) <> '')
);

CREATE TABLE public.schedule_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope public.block_scope NOT NULL,
  workspace_instance_id uuid,
  block_type public.block_type NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  reason text,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT schedule_blocks_workspace_fk
    FOREIGN KEY (workspace_instance_id)
    REFERENCES public.workspace_instances(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,

  CONSTRAINT schedule_blocks_created_by_fk
    FOREIGN KEY (created_by_user_id)
    REFERENCES public.staff_profiles(user_id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,

  CONSTRAINT schedule_blocks_valid_interval CHECK (start_at < end_at),
  CONSTRAINT schedule_blocks_scope_workspace_consistency CHECK (
    (scope = 'BUSINESS' AND workspace_instance_id IS NULL)
    OR
    (scope = 'WORKSPACE' AND workspace_instance_id IS NOT NULL)
  )
);

-- ---------------------------------------------------------------------------
-- 6. Map Versioning Tables
-- ---------------------------------------------------------------------------

CREATE TABLE public.map_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_id uuid NOT NULL,
  version_number integer NOT NULL,
  status public.map_version_status NOT NULL DEFAULT 'DRAFT',
  canvas_width integer NOT NULL,
  canvas_height integer NOT NULL,
  grid_size integer NOT NULL,
  created_by_user_id uuid,
  published_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,

  CONSTRAINT map_versions_floor_fk
    FOREIGN KEY (floor_id)
    REFERENCES public.floors(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,

  CONSTRAINT map_versions_created_by_fk
    FOREIGN KEY (created_by_user_id)
    REFERENCES public.staff_profiles(user_id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,

  CONSTRAINT map_versions_published_by_fk
    FOREIGN KEY (published_by_user_id)
    REFERENCES public.staff_profiles(user_id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,

  CONSTRAINT map_versions_version_positive CHECK (version_number > 0),
  CONSTRAINT map_versions_canvas_width_positive CHECK (canvas_width > 0),
  CONSTRAINT map_versions_canvas_height_positive CHECK (canvas_height > 0),
  CONSTRAINT map_versions_grid_size_positive CHECK (grid_size > 0),
  CONSTRAINT map_versions_publish_metadata_consistency CHECK (
    (status = 'DRAFT' AND published_at IS NULL AND published_by_user_id IS NULL)
    OR
    (status IN ('PUBLISHED', 'ARCHIVED') AND published_at IS NOT NULL AND published_by_user_id IS NOT NULL)
  )
);

CREATE TABLE public.map_elements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  map_version_id uuid NOT NULL,
  element_role public.map_element_role NOT NULL,
  element_type text NOT NULL,
  workspace_instance_id uuid,
  x numeric NOT NULL,
  y numeric NOT NULL,
  width numeric NOT NULL,
  height numeric NOT NULL,
  rotation smallint NOT NULL DEFAULT 0,
  z_index integer NOT NULL DEFAULT 0,
  label text,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_locked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT map_elements_version_fk
    FOREIGN KEY (map_version_id)
    REFERENCES public.map_versions(id)
    ON UPDATE RESTRICT
    ON DELETE CASCADE,

  CONSTRAINT map_elements_workspace_fk
    FOREIGN KEY (workspace_instance_id)
    REFERENCES public.workspace_instances(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,

  CONSTRAINT map_elements_type_nonblank CHECK (btrim(element_type) <> ''),
  CONSTRAINT map_elements_x_nonnegative CHECK (x >= 0),
  CONSTRAINT map_elements_y_nonnegative CHECK (y >= 0),
  CONSTRAINT map_elements_width_positive CHECK (width > 0),
  CONSTRAINT map_elements_height_positive CHECK (height > 0),
  CONSTRAINT map_elements_rotation_supported CHECK (rotation IN (0, 90, 180, 270)),
  CONSTRAINT map_elements_properties_object CHECK (jsonb_typeof(properties) = 'object'),
  CONSTRAINT map_elements_workspace_role_consistency CHECK (
    (element_role = 'WORKSPACE' AND workspace_instance_id IS NOT NULL)
    OR
    (element_role <> 'WORKSPACE' AND workspace_instance_id IS NULL)
  )
);

-- ---------------------------------------------------------------------------
-- 7. Reservation Tables
-- ---------------------------------------------------------------------------

CREATE TABLE public.reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_code text NOT NULL DEFAULT public.generate_reservation_reference(),
  source public.reservation_source NOT NULL,
  customer_first_name text NOT NULL,
  customer_last_name text NOT NULL,
  customer_email text NOT NULL,
  status public.reservation_status NOT NULL,
  rate_snapshot numeric(10,2) NOT NULL,
  amount_due numeric(10,2) NOT NULL,
  currency char(3) NOT NULL DEFAULT 'PHP',
  booking_token_hash text,
  booking_token text,
  qr_issued_at timestamptz,
  qr_revoked_at timestamptz,
  resolution_notes text,
  resolved_by_user_id uuid,
  resolved_at timestamptz,
  cancellation_reason text,
  cancelled_by_user_id uuid,
  cancelled_at timestamptz,
  confirmed_at timestamptz,
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT reservations_resolved_by_fk
    FOREIGN KEY (resolved_by_user_id)
    REFERENCES public.staff_profiles(user_id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,

  CONSTRAINT reservations_cancelled_by_fk
    FOREIGN KEY (cancelled_by_user_id)
    REFERENCES public.staff_profiles(user_id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,

  CONSTRAINT reservations_reference_nonblank CHECK (btrim(reference_code) <> ''),
  CONSTRAINT reservations_first_name_nonblank CHECK (btrim(customer_first_name) <> ''),
  CONSTRAINT reservations_last_name_nonblank CHECK (btrim(customer_last_name) <> ''),
  CONSTRAINT reservations_rate_nonnegative CHECK (rate_snapshot >= 0),
  CONSTRAINT reservations_amount_nonnegative CHECK (amount_due >= 0),
  CONSTRAINT reservations_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT reservations_qr_pair CHECK (
    (booking_token_hash IS NULL AND qr_issued_at IS NULL)
    OR
    (booking_token_hash IS NOT NULL AND qr_issued_at IS NOT NULL)
  ),
  CONSTRAINT reservations_qr_revoke_order CHECK (
    qr_revoked_at IS NULL OR (qr_issued_at IS NOT NULL AND qr_revoked_at >= qr_issued_at)
  ),
  CONSTRAINT reservations_resolution_pair CHECK (
    (resolved_at IS NULL AND resolved_by_user_id IS NULL)
    OR
    (resolved_at IS NOT NULL AND resolved_by_user_id IS NOT NULL)
  ),
  CONSTRAINT reservations_cancellation_requirements CHECK (
    status <> 'CANCELLED'
    OR (cancelled_at IS NOT NULL AND cancellation_reason IS NOT NULL AND btrim(cancellation_reason) <> '')
  ),
  CONSTRAINT reservations_cancelled_qr_revoked CHECK (
    status <> 'CANCELLED'
    OR booking_token_hash IS NULL
    OR qr_revoked_at IS NOT NULL
  ),
  CONSTRAINT reservations_confirmed_timestamp CHECK (
    status NOT IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED')
    OR confirmed_at IS NOT NULL
  ),
  CONSTRAINT reservations_checked_in_timestamp CHECK (
    status NOT IN ('CHECKED_IN', 'COMPLETED')
    OR checked_in_at IS NOT NULL
  ),
  CONSTRAINT reservations_completed_timestamp CHECK (
    status <> 'COMPLETED'
    OR checked_out_at IS NOT NULL
  ),
  CONSTRAINT reservations_checkin_order CHECK (
    checked_in_at IS NULL OR confirmed_at IS NULL OR checked_in_at >= confirmed_at
  ),
  CONSTRAINT reservations_checkout_order CHECK (
    checked_out_at IS NULL OR checked_in_at IS NULL OR checked_out_at >= checked_in_at
  )
);

CREATE TABLE public.reservation_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL,
  rank smallint NOT NULL,
  workspace_instance_id uuid NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  is_assigned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT reservation_candidates_reservation_fk
    FOREIGN KEY (reservation_id)
    REFERENCES public.reservations(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,

  CONSTRAINT reservation_candidates_workspace_fk
    FOREIGN KEY (workspace_instance_id)
    REFERENCES public.workspace_instances(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,

  CONSTRAINT reservation_candidates_rank_valid CHECK (rank BETWEEN 0 AND 2),
  CONSTRAINT reservation_candidates_interval_valid CHECK (start_at < end_at),
  CONSTRAINT reservation_candidates_rank_unique UNIQUE (reservation_id, rank),
  CONSTRAINT reservation_candidates_instance_time_unique UNIQUE (reservation_id, workspace_instance_id, start_at),

  -- Strong physical double-book protection.
  -- [start,end) permits back-to-back bookings (e.g. 1-3 then 3-5).
  CONSTRAINT reservation_candidates_no_assigned_overlap
    EXCLUDE USING gist (
      workspace_instance_id WITH =,
      tstzrange(start_at, end_at, '[)') WITH &&
    )
    WHERE (is_assigned = true)
    DEFERRABLE INITIALLY IMMEDIATE
);

-- ---------------------------------------------------------------------------
-- 8. Payment Tables
-- ---------------------------------------------------------------------------

CREATE TABLE public.payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  method_type public.payment_method_type NOT NULL,
  display_name text NOT NULL,
  account_name text,
  account_number text,
  qr_image_path text,
  instructions text,
  allow_web boolean NOT NULL DEFAULT false,
  allow_kiosk boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT payment_methods_display_name_nonblank CHECK (btrim(display_name) <> ''),
  CONSTRAINT payment_methods_display_order_nonnegative CHECK (display_order >= 0),
  CONSTRAINT payment_methods_cash_not_web CHECK (method_type <> 'CASH' OR allow_web = false)
);

CREATE TABLE public.payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL,
  attempt_number integer NOT NULL,
  channel public.payment_channel NOT NULL,
  payment_method_id uuid,
  amount numeric(10,2) NOT NULL,
  status public.payment_status NOT NULL DEFAULT 'PENDING',
  token_hash text,
  expires_at timestamptz,
  proof_storage_path text,
  proof_submitted_at timestamptz,
  processed_by_user_id uuid,
  processed_at timestamptz,
  rejection_reason text,
  refund_status public.refund_status NOT NULL DEFAULT 'NONE',
  refund_notes text,
  refund_recorded_by_user_id uuid,
  refunded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT payment_attempts_reservation_fk
    FOREIGN KEY (reservation_id)
    REFERENCES public.reservations(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,

  CONSTRAINT payment_attempts_method_fk
    FOREIGN KEY (payment_method_id)
    REFERENCES public.payment_methods(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,

  CONSTRAINT payment_attempts_processed_by_fk
    FOREIGN KEY (processed_by_user_id)
    REFERENCES public.staff_profiles(user_id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,

  CONSTRAINT payment_attempts_refund_by_fk
    FOREIGN KEY (refund_recorded_by_user_id)
    REFERENCES public.staff_profiles(user_id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,

  CONSTRAINT payment_attempts_attempt_positive CHECK (attempt_number > 0),
  CONSTRAINT payment_attempts_amount_nonnegative CHECK (amount >= 0),
  CONSTRAINT payment_attempts_attempt_unique UNIQUE (reservation_id, attempt_number),

  CONSTRAINT payment_attempts_web_token_requirements CHECK (
    channel <> 'WEB'
    OR (token_hash IS NOT NULL AND expires_at IS NOT NULL)
  ),

  CONSTRAINT payment_attempts_kiosk_no_web_session CHECK (
    channel <> 'KIOSK'
    OR (
      token_hash IS NULL
      AND expires_at IS NULL
      AND proof_storage_path IS NULL
      AND proof_submitted_at IS NULL
    )
  ),

  CONSTRAINT payment_attempts_proof_pair CHECK (
    (proof_submitted_at IS NULL AND proof_storage_path IS NULL)
    OR
    (proof_submitted_at IS NOT NULL AND proof_storage_path IS NOT NULL)
  ),

  CONSTRAINT payment_attempts_web_proof_before_expiry CHECK (
    channel <> 'WEB'
    OR proof_submitted_at IS NULL
    OR proof_submitted_at < expires_at
  ),

  CONSTRAINT payment_attempts_under_review_web_only CHECK (
    status <> 'UNDER_REVIEW' OR channel = 'WEB'
  ),

  CONSTRAINT payment_attempts_rejected_web_only CHECK (
    status <> 'REJECTED' OR channel = 'WEB'
  ),

  CONSTRAINT payment_attempts_expired_web_only CHECK (
    status <> 'EXPIRED' OR channel = 'WEB'
  ),

  CONSTRAINT payment_attempts_web_review_has_proof CHECK (
    channel <> 'WEB'
    OR status NOT IN ('UNDER_REVIEW', 'APPROVED', 'REJECTED')
    OR (proof_storage_path IS NOT NULL AND proof_submitted_at IS NOT NULL)
  ),

  CONSTRAINT payment_attempts_rejection_reason_required CHECK (
    status <> 'REJECTED'
    OR (rejection_reason IS NOT NULL AND btrim(rejection_reason) <> '')
  ),

  CONSTRAINT payment_attempts_processing_metadata CHECK (
    status NOT IN ('APPROVED', 'REJECTED')
    OR (processed_by_user_id IS NOT NULL AND processed_at IS NOT NULL)
  ),

  CONSTRAINT payment_attempts_refund_metadata CHECK (
    (refund_status = 'NONE' AND refunded_at IS NULL AND refund_recorded_by_user_id IS NULL)
    OR
    (refund_status = 'REQUIRED' AND refunded_at IS NULL)
    OR
    (refund_status = 'REFUNDED' AND refunded_at IS NOT NULL AND refund_recorded_by_user_id IS NOT NULL)
  )
);

-- ---------------------------------------------------------------------------
-- 9. Audit Table
-- ---------------------------------------------------------------------------

CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  actor_role public.audit_actor_role NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT audit_logs_actor_fk
    FOREIGN KEY (actor_user_id)
    REFERENCES public.staff_profiles(user_id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,

  CONSTRAINT audit_logs_action_nonblank CHECK (btrim(action) <> ''),
  CONSTRAINT audit_logs_entity_type_nonblank CHECK (btrim(entity_type) <> ''),
  CONSTRAINT audit_logs_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT audit_logs_system_actor_consistency CHECK (
    (actor_role = 'SYSTEM' AND actor_user_id IS NULL)
    OR
    (actor_role IN ('ADMIN', 'STAFF') AND actor_user_id IS NOT NULL)
  )
);

-- ---------------------------------------------------------------------------
-- 10. Core Indexes and Uniqueness Rules
-- ---------------------------------------------------------------------------

-- Staff
CREATE INDEX idx_staff_profiles_role_active
  ON public.staff_profiles(role, is_active);

-- Workspace / floors
CREATE INDEX idx_workspace_templates_active
  ON public.workspace_templates(is_active);

CREATE UNIQUE INDEX uq_workspace_templates_name_ci
  ON public.workspace_templates(lower(name));

CREATE UNIQUE INDEX uq_floors_active_display_order
  ON public.floors(display_order)
  WHERE is_active = true;

CREATE INDEX idx_workspace_instances_template
  ON public.workspace_instances(template_id);

CREATE INDEX idx_workspace_instances_floor_status
  ON public.workspace_instances(floor_id, operational_status);

CREATE UNIQUE INDEX uq_workspace_instances_code_ci
  ON public.workspace_instances(lower(instance_code));

-- Availability
CREATE INDEX idx_operating_hours_day_active
  ON public.operating_hours(day_of_week, is_active);

CREATE INDEX idx_schedule_blocks_workspace_time
  ON public.schedule_blocks(workspace_instance_id, start_at, end_at)
  WHERE workspace_instance_id IS NOT NULL;

CREATE INDEX idx_schedule_blocks_scope_time
  ON public.schedule_blocks(scope, start_at, end_at);

CREATE INDEX idx_schedule_blocks_business_range_gist
  ON public.schedule_blocks
  USING gist (tstzrange(start_at, end_at, '[)'))
  WHERE scope = 'BUSINESS';

CREATE INDEX idx_schedule_blocks_workspace_range_gist
  ON public.schedule_blocks
  USING gist (workspace_instance_id, tstzrange(start_at, end_at, '[)'))
  WHERE scope = 'WORKSPACE';

-- Map
CREATE UNIQUE INDEX uq_map_versions_floor_version
  ON public.map_versions(floor_id, version_number);

CREATE INDEX idx_map_versions_floor_status
  ON public.map_versions(floor_id, status);

CREATE UNIQUE INDEX uq_map_versions_one_draft_per_floor
  ON public.map_versions(floor_id)
  WHERE status = 'DRAFT';

CREATE UNIQUE INDEX uq_map_versions_one_published_per_floor
  ON public.map_versions(floor_id)
  WHERE status = 'PUBLISHED';

CREATE INDEX idx_map_elements_version
  ON public.map_elements(map_version_id);

CREATE INDEX idx_map_elements_workspace_instance
  ON public.map_elements(workspace_instance_id)
  WHERE workspace_instance_id IS NOT NULL;

CREATE UNIQUE INDEX uq_map_elements_workspace_once_per_version
  ON public.map_elements(map_version_id, workspace_instance_id)
  WHERE workspace_instance_id IS NOT NULL;

CREATE UNIQUE INDEX uq_map_elements_kiosk_marker
  ON public.map_elements(map_version_id)
  WHERE element_type = 'KIOSK_YOU_ARE_HERE';

-- Reservations
CREATE UNIQUE INDEX uq_reservations_reference_code
  ON public.reservations(reference_code);

CREATE INDEX idx_reservations_customer_email_created
  ON public.reservations(lower(customer_email), created_at DESC);

CREATE INDEX idx_reservations_status_created
  ON public.reservations(status, created_at DESC);

CREATE UNIQUE INDEX uq_reservations_booking_token_hash
  ON public.reservations(booking_token_hash)
  WHERE booking_token_hash IS NOT NULL;

CREATE INDEX idx_reservation_candidates_workspace_time
  ON public.reservation_candidates(workspace_instance_id, start_at, end_at);

CREATE INDEX idx_reservation_candidates_reservation
  ON public.reservation_candidates(reservation_id);

CREATE UNIQUE INDEX uq_reservation_candidates_one_assigned
  ON public.reservation_candidates(reservation_id)
  WHERE is_assigned = true;

-- Payments
CREATE INDEX idx_payment_methods_active_order
  ON public.payment_methods(is_active, display_order);

CREATE UNIQUE INDEX uq_payment_methods_active_display_order
  ON public.payment_methods(display_order)
  WHERE is_active = true;

CREATE INDEX idx_payment_attempts_status_created
  ON public.payment_attempts(status, created_at DESC);

CREATE INDEX idx_payment_attempts_reservation
  ON public.payment_attempts(reservation_id, attempt_number);

CREATE UNIQUE INDEX uq_payment_attempts_token_hash
  ON public.payment_attempts(token_hash)
  WHERE token_hash IS NOT NULL;

CREATE UNIQUE INDEX uq_payment_attempts_proof_path
  ON public.payment_attempts(proof_storage_path)
  WHERE proof_storage_path IS NOT NULL;

CREATE INDEX idx_payment_attempts_pending_expiry
  ON public.payment_attempts(expires_at)
  WHERE channel = 'WEB' AND status = 'PENDING';

CREATE UNIQUE INDEX uq_payment_attempts_one_active_web
  ON public.payment_attempts(reservation_id)
  WHERE channel = 'WEB' AND status IN ('PENDING', 'UNDER_REVIEW');

CREATE UNIQUE INDEX uq_payment_attempts_one_approved
  ON public.payment_attempts(reservation_id)
  WHERE status = 'APPROVED';

-- Audit
CREATE INDEX idx_audit_logs_entity_created
  ON public.audit_logs(entity_type, entity_id, created_at DESC);

CREATE INDEX idx_audit_logs_actor_created
  ON public.audit_logs(actor_user_id, created_at DESC)
  WHERE actor_user_id IS NOT NULL;

CREATE INDEX idx_audit_logs_action_created
  ON public.audit_logs(action, created_at DESC);

-- ---------------------------------------------------------------------------
-- 11. updated_at Triggers
-- ---------------------------------------------------------------------------

CREATE TRIGGER trg_staff_profiles_updated_at
BEFORE UPDATE ON public.staff_profiles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_business_settings_updated_at
BEFORE UPDATE ON public.business_settings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_operating_hours_updated_at
BEFORE UPDATE ON public.operating_hours
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_workspace_templates_updated_at
BEFORE UPDATE ON public.workspace_templates
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_floors_updated_at
BEFORE UPDATE ON public.floors
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_workspace_instances_updated_at
BEFORE UPDATE ON public.workspace_instances
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_map_versions_updated_at
BEFORE UPDATE ON public.map_versions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_map_elements_updated_at
BEFORE UPDATE ON public.map_elements
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_reservations_updated_at
BEFORE UPDATE ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_reservation_candidates_updated_at
BEFORE UPDATE ON public.reservation_candidates
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_payment_methods_updated_at
BEFORE UPDATE ON public.payment_methods
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_payment_attempts_updated_at
BEFORE UPDATE ON public.payment_attempts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 12. Business Settings Timezone Validation Trigger
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.validate_business_timezone()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_timezone_names
    WHERE name = NEW.timezone
  ) THEN
    RAISE EXCEPTION 'Invalid IANA timezone: %', NEW.timezone;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_business_settings_timezone
BEFORE INSERT OR UPDATE OF timezone ON public.business_settings
FOR EACH ROW EXECUTE FUNCTION public.validate_business_timezone();

-- ---------------------------------------------------------------------------
-- 13. Operating-Hours Overlap Protection Trigger
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.prevent_operating_hours_overlap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  lock_a integer;
  lock_b integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.day_of_week <> NEW.day_of_week THEN
      lock_a := LEAST(OLD.day_of_week, NEW.day_of_week);
      lock_b := GREATEST(OLD.day_of_week, NEW.day_of_week);
      PERFORM pg_advisory_xact_lock(71001, lock_a);
      PERFORM pg_advisory_xact_lock(71001, lock_b);
    ELSE
      PERFORM pg_advisory_xact_lock(71001, NEW.day_of_week);
    END IF;
  ELSE
    PERFORM pg_advisory_xact_lock(71001, NEW.day_of_week);
  END IF;

  IF NEW.is_active AND EXISTS (
    SELECT 1
    FROM public.operating_hours oh
    WHERE oh.day_of_week = NEW.day_of_week
      AND oh.is_active = true
      AND oh.id IS DISTINCT FROM NEW.id
      AND NEW.opens_at < oh.closes_at
      AND NEW.closes_at > oh.opens_at
  ) THEN
    RAISE EXCEPTION 'Active operating-hours intervals may not overlap for weekday %', NEW.day_of_week;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_operating_hours_no_overlap
BEFORE INSERT OR UPDATE OF day_of_week, opens_at, closes_at, is_active
ON public.operating_hours
FOR EACH ROW EXECUTE FUNCTION public.prevent_operating_hours_overlap();

-- ---------------------------------------------------------------------------
-- 14. Workspace-Instance Identity Guard Trigger
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_workspace_instance_template()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.template_id IS DISTINCT FROM OLD.template_id THEN
    RAISE EXCEPTION 'workspace_instances.template_id is immutable; create a new physical instance instead';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_workspace_instances_template_immutable
BEFORE UPDATE OF template_id ON public.workspace_instances
FOR EACH ROW EXECUTE FUNCTION public.guard_workspace_instance_template();

-- ---------------------------------------------------------------------------
-- 15. Map-Version Lifecycle and Map-Element Integrity Triggers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_map_version_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  publisher_role public.staff_role;
  publisher_active boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'New map versions must start as DRAFT';
    END IF;
    RETURN NEW;
  END IF;

  -- Published/archived version geometry/config is immutable.
  IF OLD.status <> 'DRAFT' AND (
    NEW.floor_id IS DISTINCT FROM OLD.floor_id
    OR NEW.version_number IS DISTINCT FROM OLD.version_number
    OR NEW.canvas_width IS DISTINCT FROM OLD.canvas_width
    OR NEW.canvas_height IS DISTINCT FROM OLD.canvas_height
    OR NEW.grid_size IS DISTINCT FROM OLD.grid_size
  ) THEN
    RAISE EXCEPTION 'Published/archived map-version configuration is immutable';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status = 'DRAFT' AND NEW.status = 'PUBLISHED' THEN
      IF NEW.published_by_user_id IS NULL THEN
        RAISE EXCEPTION 'published_by_user_id is required when publishing a map';
      END IF;

      SELECT role, is_active
      INTO publisher_role, publisher_active
      FROM public.staff_profiles
      WHERE user_id = NEW.published_by_user_id;

      IF publisher_role IS DISTINCT FROM 'ADMIN' OR publisher_active IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Only an active ADMIN may publish a map version';
      END IF;

      NEW.published_at := COALESCE(NEW.published_at, now());

    ELSIF OLD.status = 'PUBLISHED' AND NEW.status = 'ARCHIVED' THEN
      -- Preserve original publisher and published_at.
      NULL;

    ELSE
      RAISE EXCEPTION 'Invalid map version status transition: % -> %', OLD.status, NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_map_versions_lifecycle
BEFORE INSERT OR UPDATE ON public.map_versions
FOR EACH ROW EXECUTE FUNCTION public.guard_map_version_lifecycle();

CREATE OR REPLACE FUNCTION public.prevent_non_draft_map_version_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Only DRAFT map versions may be deleted';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_map_versions_delete_guard
BEFORE DELETE ON public.map_versions
FOR EACH ROW EXECUTE FUNCTION public.prevent_non_draft_map_version_delete();

CREATE OR REPLACE FUNCTION public.validate_map_element_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_status public.map_version_status;
  v_floor_id uuid;
  v_canvas_width integer;
  v_canvas_height integer;
  v_workspace_floor uuid;
  v_version_id uuid;
BEGIN
  v_version_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.map_version_id ELSE NEW.map_version_id END;

  SELECT status, floor_id, canvas_width, canvas_height
    INTO v_status, v_floor_id, v_canvas_width, v_canvas_height
  FROM public.map_versions
  WHERE id = v_version_id;

  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Map version % does not exist', v_version_id;
  END IF;

  IF v_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Map elements may only be mutated inside a DRAFT map version';
  END IF;

  IF TG_OP <> 'DELETE' THEN
    IF NEW.x + NEW.width > v_canvas_width OR NEW.y + NEW.height > v_canvas_height THEN
      RAISE EXCEPTION 'Map element must remain inside canvas bounds';
    END IF;

    IF NEW.element_role = 'WORKSPACE' THEN
      SELECT floor_id
        INTO v_workspace_floor
      FROM public.workspace_instances
      WHERE id = NEW.workspace_instance_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Workspace instance % does not exist', NEW.workspace_instance_id;
      END IF;

      IF v_workspace_floor <> v_floor_id THEN
        RAISE EXCEPTION 'Workspace instance floor must match map-version floor';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_map_elements_integrity
BEFORE INSERT OR UPDATE OR DELETE ON public.map_elements
FOR EACH ROW EXECUTE FUNCTION public.validate_map_element_integrity();

-- ---------------------------------------------------------------------------
-- 16. Reservation Candidate-Set Validation Triggers
-- ---------------------------------------------------------------------------

-- Validates candidate set invariants (1-3 candidates, single rank-0 main, matching template, date, duration).
-- For finalized reservations (CONFIRMED, CHECKED_IN, COMPLETED, CANCELLED), candidate allocation has concluded.
-- Early checkout updates end_at on the assigned candidate to release physical inventory early while unassigned
-- alternatives retain original duration; candidate uniformity across inactive alternatives is therefore bypassed.
CREATE OR REPLACE FUNCTION public.assert_reservation_candidate_set(p_reservation_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_main_count integer;
  v_template_count integer;
  v_date_count integer;
  v_duration_count integer;
  v_timezone text;
  v_status public.reservation_status;
BEGIN
  IF p_reservation_id IS NULL THEN
    RETURN;
  END IF;

  SELECT status INTO v_status
  FROM public.reservations
  WHERE id = p_reservation_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Once a reservation is CONFIRMED, CHECKED_IN, COMPLETED, or CANCELLED,
  -- candidate allocation has already concluded. In particular, early checkout updates end_at
  -- on the assigned candidate to release physical inventory early, and admin operations
  -- may adjust schedule times. Candidate set uniformity across unassigned alternatives
  -- no longer applies.
  IF v_status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED') THEN
    RETURN;
  END IF;

  v_timezone := public.get_business_timezone();

  SELECT
    count(*),
    count(*) FILTER (WHERE rc.rank = 0),
    count(DISTINCT wi.template_id),
    count(DISTINCT ((rc.start_at AT TIME ZONE v_timezone)::date)),
    count(DISTINCT (rc.end_at - rc.start_at))
  INTO
    v_count,
    v_main_count,
    v_template_count,
    v_date_count,
    v_duration_count
  FROM public.reservation_candidates rc
  JOIN public.workspace_instances wi ON wi.id = rc.workspace_instance_id
  WHERE rc.reservation_id = p_reservation_id;

  IF v_count < 1 OR v_count > 3 THEN
    RAISE EXCEPTION 'Reservation % must have between 1 and 3 candidates', p_reservation_id;
  END IF;

  IF v_main_count <> 1 THEN
    RAISE EXCEPTION 'Reservation % must have exactly one Main candidate (rank 0)', p_reservation_id;
  END IF;

  IF v_template_count <> 1 THEN
    RAISE EXCEPTION 'All candidates for reservation % must use the same workspace template/tier', p_reservation_id;
  END IF;

  IF v_date_count <> 1 THEN
    RAISE EXCEPTION 'All candidates for reservation % must use the same local booking date', p_reservation_id;
  END IF;

  IF v_duration_count <> 1 THEN
    RAISE EXCEPTION 'All candidates for reservation % must have the same duration', p_reservation_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_reservation_candidate_set_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.assert_reservation_candidate_set(NEW.reservation_id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.assert_reservation_candidate_set(OLD.reservation_id);
  ELSE
    PERFORM public.assert_reservation_candidate_set(NEW.reservation_id);
    IF OLD.reservation_id IS DISTINCT FROM NEW.reservation_id THEN
      PERFORM public.assert_reservation_candidate_set(OLD.reservation_id);
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_reservation_candidates_set_valid
AFTER INSERT OR UPDATE OR DELETE ON public.reservation_candidates
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.validate_reservation_candidate_set_trigger();

-- ---------------------------------------------------------------------------
-- 17. Reservation Assignment-State Validation Triggers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assert_reservation_assignment_state(p_reservation_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_status public.reservation_status;
  v_assigned_count integer;
BEGIN
  IF p_reservation_id IS NULL THEN
    RETURN;
  END IF;

  SELECT status INTO v_status
  FROM public.reservations
  WHERE id = p_reservation_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT count(*) INTO v_assigned_count
  FROM public.reservation_candidates
  WHERE reservation_id = p_reservation_id
    AND is_assigned = true;

  IF v_status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED') THEN
    IF v_assigned_count <> 1 THEN
      RAISE EXCEPTION 'Reservation % in status % must have exactly one assigned candidate',
        p_reservation_id, v_status;
    END IF;
  ELSE
    IF v_assigned_count <> 0 THEN
      RAISE EXCEPTION 'Reservation % in status % must not retain an assigned candidate',
        p_reservation_id, v_status;
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_assignment_from_candidate_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.assert_reservation_assignment_state(NEW.reservation_id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.assert_reservation_assignment_state(OLD.reservation_id);
  ELSE
    PERFORM public.assert_reservation_assignment_state(NEW.reservation_id);
    IF OLD.reservation_id IS DISTINCT FROM NEW.reservation_id THEN
      PERFORM public.assert_reservation_assignment_state(OLD.reservation_id);
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_reservation_candidate_assignment_state
AFTER INSERT OR UPDATE OR DELETE ON public.reservation_candidates
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.validate_assignment_from_candidate_trigger();

CREATE OR REPLACE FUNCTION public.validate_assignment_from_reservation_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM public.assert_reservation_assignment_state(NEW.id);
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_reservation_status_assignment_state
AFTER INSERT OR UPDATE OF status ON public.reservations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.validate_assignment_from_reservation_trigger();

-- ---------------------------------------------------------------------------
-- 18. Reservation & Payment Immutability and Consistency Triggers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_reservation_core_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.reference_code IS DISTINCT FROM OLD.reference_code
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.rate_snapshot IS DISTINCT FROM OLD.rate_snapshot
     OR NEW.amount_due IS DISTINCT FROM OLD.amount_due
     OR NEW.currency IS DISTINCT FROM OLD.currency THEN
    RAISE EXCEPTION 'Reservation reference/source/price snapshot fields are immutable after creation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_reservations_core_immutable
BEFORE UPDATE OF reference_code, source, rate_snapshot, amount_due, currency
ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.guard_reservation_core_fields();

CREATE OR REPLACE FUNCTION public.prevent_reservation_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Reservations are historical business records and may not be hard-deleted';
END;
$$;

CREATE TRIGGER trg_reservations_no_delete
BEFORE DELETE ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.prevent_reservation_delete();

CREATE OR REPLACE FUNCTION public.validate_payment_attempt_business_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_source public.reservation_source;
  v_amount numeric(10,2);
  v_allow_web boolean;
  v_allow_kiosk boolean;
  v_method_active boolean;
  v_processor_role public.staff_role;
  v_processor_active boolean;
  v_refund_role public.staff_role;
  v_refund_active boolean;
BEGIN
  SELECT source, amount_due
    INTO v_source, v_amount
  FROM public.reservations
  WHERE id = NEW.reservation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation % does not exist', NEW.reservation_id;
  END IF;

  IF NEW.channel::text <> v_source::text THEN
    RAISE EXCEPTION 'Payment channel % must match reservation source %', NEW.channel, v_source;
  END IF;

  IF NEW.amount <> v_amount THEN
    RAISE EXCEPTION 'Payment attempt amount % must equal reservation amount_due %', NEW.amount, v_amount;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.reservation_id IS DISTINCT FROM OLD.reservation_id
       OR NEW.attempt_number IS DISTINCT FROM OLD.attempt_number
       OR NEW.channel IS DISTINCT FROM OLD.channel
       OR NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.token_hash IS DISTINCT FROM OLD.token_hash
       OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
      RAISE EXCEPTION 'Payment attempt identity/session fields are immutable; create a new attempt for resubmission';
    END IF;

    IF OLD.proof_storage_path IS NOT NULL AND (
      NEW.proof_storage_path IS DISTINCT FROM OLD.proof_storage_path
      OR NEW.proof_submitted_at IS DISTINCT FROM OLD.proof_submitted_at
    ) THEN
      RAISE EXCEPTION 'A submitted payment proof is immutable; create a new attempt for resubmission';
    END IF;
  END IF;

  IF NEW.payment_method_id IS NOT NULL THEN
    IF TG_OP = 'INSERT'
       OR (TG_OP = 'UPDATE' AND (
         NEW.payment_method_id IS DISTINCT FROM OLD.payment_method_id
         OR NEW.channel IS DISTINCT FROM OLD.channel
       )) THEN
      SELECT allow_web, allow_kiosk, is_active
        INTO v_allow_web, v_allow_kiosk, v_method_active
      FROM public.payment_methods
      WHERE id = NEW.payment_method_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment method % does not exist', NEW.payment_method_id;
      END IF;

      IF v_method_active IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Inactive payment method may not be selected for a new/current attempt';
      END IF;

      IF NEW.channel = 'WEB' AND v_allow_web IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Payment method is not enabled for WEB payments';
      END IF;
    END IF;
  END IF;

  IF NEW.status IN ('APPROVED', 'REJECTED') THEN
    SELECT role, is_active
      INTO v_processor_role, v_processor_active
    FROM public.staff_profiles
    WHERE user_id = NEW.processed_by_user_id;

    IF NOT FOUND OR v_processor_active IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Payment processor must be an active DeskAtlas staff profile';
    END IF;

    IF NEW.channel = 'WEB' AND v_processor_role <> 'ADMIN' THEN
      RAISE EXCEPTION 'Only ADMIN may approve/reject online WEB payment proof';
    END IF;

    IF NEW.channel = 'KIOSK' AND v_processor_role NOT IN ('ADMIN', 'STAFF') THEN
      RAISE EXCEPTION 'Only ADMIN or STAFF may confirm KIOSK payment';
    END IF;
  END IF;

  IF NEW.refund_status = 'REFUNDED' THEN
    SELECT role, is_active
      INTO v_refund_role, v_refund_active
    FROM public.staff_profiles
    WHERE user_id = NEW.refund_recorded_by_user_id;

    IF NOT FOUND OR v_refund_active IS DISTINCT FROM true OR v_refund_role <> 'ADMIN' THEN
      RAISE EXCEPTION 'Only an active ADMIN may record a refund as completed';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_payment_attempts_business_rules
BEFORE INSERT OR UPDATE ON public.payment_attempts
FOR EACH ROW EXECUTE FUNCTION public.validate_payment_attempt_business_rules();

CREATE OR REPLACE FUNCTION public.prevent_payment_attempt_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Payment attempts are immutable historical records and may not be hard-deleted';
END;
$$;

CREATE TRIGGER trg_payment_attempts_no_delete
BEFORE DELETE ON public.payment_attempts
FOR EACH ROW EXECUTE FUNCTION public.prevent_payment_attempt_delete();

-- ---------------------------------------------------------------------------
-- 19. Audit-Log Immutability and Actor Validation Triggers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.validate_audit_actor()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_role public.staff_role;
BEGIN
  IF NEW.actor_role = 'SYSTEM' THEN
    RETURN NEW;
  END IF;

  SELECT role INTO v_role
  FROM public.staff_profiles
  WHERE user_id = NEW.actor_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Audit actor must reference an existing DeskAtlas staff profile';
  END IF;

  IF NEW.actor_role::text <> v_role::text THEN
    RAISE EXCEPTION 'Audit actor_role % does not match staff role %', NEW.actor_role, v_role;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_audit_logs_actor_valid
BEFORE INSERT ON public.audit_logs
FOR EACH ROW EXECUTE FUNCTION public.validate_audit_actor();

CREATE OR REPLACE FUNCTION public.prevent_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only; UPDATE and DELETE are prohibited';
END;
$$;

CREATE TRIGGER trg_audit_logs_immutable
BEFORE UPDATE OR DELETE ON public.audit_logs
FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_log_mutation();

-- ---------------------------------------------------------------------------
-- 20. Enable Row Level Security (Deny by default)
-- ---------------------------------------------------------------------------

ALTER TABLE public.staff_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operating_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.floors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.map_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.map_elements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservation_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 21. Performance Indexes
-- ---------------------------------------------------------------------------

-- 1. Reservation Candidates & Availability Lookups
CREATE INDEX IF NOT EXISTS idx_reservation_candidates_availability 
  ON public.reservation_candidates (workspace_instance_id, start_at, end_at);

CREATE INDEX IF NOT EXISTS idx_reservation_candidates_assigned_window 
  ON public.reservation_candidates (start_at, end_at, is_assigned);

CREATE INDEX IF NOT EXISTS idx_reservation_candidates_reservation_id 
  ON public.reservation_candidates (reservation_id);

-- 2. Reservations Lookups & Lifecycle Filtering
CREATE INDEX IF NOT EXISTS idx_reservations_status_created 
  ON public.reservations (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reservations_reference_code 
  ON public.reservations (reference_code);

-- 3. Schedule Blocks & Maintenance/Closure Windows
CREATE INDEX IF NOT EXISTS idx_schedule_blocks_instance_window 
  ON public.schedule_blocks (workspace_instance_id, start_at, end_at, scope);

CREATE INDEX IF NOT EXISTS idx_schedule_blocks_business_window 
  ON public.schedule_blocks (start_at, end_at, scope);

-- 4. Published Map Versions & Floor Navigation
CREATE INDEX IF NOT EXISTS idx_map_versions_floor_status 
  ON public.map_versions (floor_id, status);

CREATE INDEX IF NOT EXISTS idx_map_elements_version_zindex 
  ON public.map_elements (map_version_id, z_index);

CREATE INDEX IF NOT EXISTS idx_map_elements_instance 
  ON public.map_elements (workspace_instance_id);

-- 5. Workspace Instances & Templates
CREATE INDEX IF NOT EXISTS idx_workspace_instances_template_status 
  ON public.workspace_instances (template_id, operational_status);

CREATE INDEX IF NOT EXISTS idx_workspace_instances_floor 
  ON public.workspace_instances (floor_id);

CREATE INDEX IF NOT EXISTS idx_workspace_templates_active 
  ON public.workspace_templates (is_active);

-- 6. Operating Hours & Floors Sorting
CREATE INDEX IF NOT EXISTS idx_operating_hours_day_active 
  ON public.operating_hours (day_of_week, is_active, opens_at);

CREATE INDEX IF NOT EXISTS idx_floors_active_display 
  ON public.floors (is_active, display_order, name);

-- 7. Staff Profiles Scoping & Superadmin
CREATE INDEX IF NOT EXISTS idx_staff_profiles_created_by_admin
  ON public.staff_profiles (created_by_admin_id);

CREATE INDEX IF NOT EXISTS idx_staff_profiles_is_super_admin
  ON public.staff_profiles (is_super_admin);

-- ---------------------------------------------------------------------------
-- 8. Essential Service Role & Schema Grants
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO postgres, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO postgres, service_role;

COMMIT;
