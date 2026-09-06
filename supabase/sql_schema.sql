CREATE TABLE "users" (
  "id" uuid PRIMARY KEY,
  "email" text,
  "created_at" timestamptz DEFAULT (now())
);

CREATE TYPE "workspace_status" AS ENUM (
  'ACTIVE',
  'UNAVAILABLE',
  'MAINTENANCE',
  'BROKEN',
  'INACTIVE'
);

CREATE TYPE "map_version_status" AS ENUM (
  'DRAFT',
  'PUBLISHED',
  'ARCHIVED'
);

CREATE TYPE "map_element_role" AS ENUM (
  'WORKSPACE',
  'STRUCTURE',
  'AMENITY',
  'INFORMATION',
  'EDITOR_AID'
);

CREATE TYPE "reservation_source" AS ENUM (
  'WEB',
  'KIOSK'
);

CREATE TYPE "reservation_status" AS ENUM (
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

CREATE TYPE "payment_channel" AS ENUM (
  'WEB',
  'KIOSK'
);

CREATE TYPE "payment_status" AS ENUM (
  'PENDING',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'CANCELLED'
);

CREATE TYPE "refund_status" AS ENUM (
  'NONE',
  'REQUIRED',
  'REFUNDED'
);

CREATE TYPE "payment_method_type" AS ENUM (
  'GCASH',
  'BANK',
  'CASH'
);

CREATE TYPE "staff_role" AS ENUM (
  'ADMIN',
  'STAFF'
);

CREATE TYPE "audit_actor_role" AS ENUM (
  'ADMIN',
  'STAFF',
  'SYSTEM'
);

CREATE TYPE "block_scope" AS ENUM (
  'BUSINESS',
  'WORKSPACE'
);

CREATE TYPE "block_type" AS ENUM (
  'CLOSURE',
  'MAINTENANCE',
  'MANUAL_UNAVAILABLE',
  'OTHER'
);

CREATE TYPE "pricing_unit" AS ENUM (
  'HOURLY'
);

-- ---------------------------------------------------------------------------
-- 2. Application Tables
-- ---------------------------------------------------------------------------

CREATE TABLE "staff_profiles" (
  "user_id" uuid PRIMARY KEY,
  "role" staff_role NOT NULL,
  "display_name" text NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT (now()),
  "updated_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "business_settings" (
  "id" smallint PRIMARY KEY DEFAULT 1,
  "business_name" text NOT NULL,
  "timezone" text NOT NULL DEFAULT 'Asia/Manila',
  "contact_email" text,
  "contact_phone" text,
  "booking_interval_minutes" integer NOT NULL,
  "payment_expiry_minutes" integer NOT NULL DEFAULT 60,
  "kiosk_timeout_minutes" integer,
  "landing_preview_photos" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "updated_by_user_id" uuid,
  "updated_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "operating_hours" (
  "id" uuid PRIMARY KEY DEFAULT (gen_random_uuid()),
  "day_of_week" smallint NOT NULL,
  "opens_at" time NOT NULL,
  "closes_at" time NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT (now()),
  "updated_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "workspace_templates" (
  "id" uuid PRIMARY KEY DEFAULT (gen_random_uuid()),
  "name" text NOT NULL,
  "description" text,
  "photo_path" text,
  "capacity" integer NOT NULL,
  "rate_amount" numeric(10,2) NOT NULL,
  "pricing_unit" pricing_unit NOT NULL DEFAULT 'HOURLY',
  "default_shape" text NOT NULL,
  "default_color" text NOT NULL,
  "default_style" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT (now()),
  "updated_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "floors" (
  "id" uuid PRIMARY KEY DEFAULT (gen_random_uuid()),
  "name" text NOT NULL,
  "floor_number" integer,
  "display_order" integer NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT (now()),
  "updated_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "workspace_instances" (
  "id" uuid PRIMARY KEY DEFAULT (gen_random_uuid()),
  "template_id" uuid NOT NULL,
  "floor_id" uuid NOT NULL,
  "instance_code" text NOT NULL,
  "display_name" text NOT NULL,
  "operational_status" workspace_status NOT NULL DEFAULT 'ACTIVE',
  "created_at" timestamptz NOT NULL DEFAULT (now()),
  "updated_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "schedule_blocks" (
  "id" uuid PRIMARY KEY DEFAULT (gen_random_uuid()),
  "scope" block_scope NOT NULL,
  "workspace_instance_id" uuid,
  "block_type" block_type NOT NULL,
  "start_at" timestamptz NOT NULL,
  "end_at" timestamptz NOT NULL,
  "reason" text,
  "created_by_user_id" uuid,
  "created_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "map_versions" (
  "id" uuid PRIMARY KEY DEFAULT (gen_random_uuid()),
  "floor_id" uuid NOT NULL,
  "version_number" integer NOT NULL,
  "status" map_version_status NOT NULL DEFAULT 'DRAFT',
  "canvas_width" integer NOT NULL,
  "canvas_height" integer NOT NULL,
  "grid_size" integer NOT NULL,
  "created_by_user_id" uuid,
  "published_by_user_id" uuid,
  "created_at" timestamptz NOT NULL DEFAULT (now()),
  "updated_at" timestamptz NOT NULL DEFAULT (now()),
  "published_at" timestamptz
);

CREATE TABLE "map_elements" (
  "id" uuid PRIMARY KEY DEFAULT (gen_random_uuid()),
  "map_version_id" uuid NOT NULL,
  "element_role" map_element_role NOT NULL,
  "element_type" text NOT NULL,
  "workspace_instance_id" uuid,
  "x" numeric NOT NULL,
  "y" numeric NOT NULL,
  "width" numeric NOT NULL,
  "height" numeric NOT NULL,
  "rotation" smallint NOT NULL DEFAULT 0,
  "z_index" integer NOT NULL DEFAULT 0,
  "label" text,
  "properties" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "is_locked" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT (now()),
  "updated_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "reservations" (
  "id" uuid PRIMARY KEY DEFAULT (gen_random_uuid()),
  "reference_code" text NOT NULL,
  "source" reservation_source NOT NULL,
  "customer_first_name" text NOT NULL,
  "customer_last_name" text NOT NULL,
  "customer_email" text NOT NULL,
  "status" reservation_status NOT NULL,
  "rate_snapshot" numeric(10,2) NOT NULL,
  "amount_due" numeric(10,2) NOT NULL,
  "currency" char(3) NOT NULL DEFAULT 'PHP',
  "booking_token_hash" text,
  "qr_issued_at" timestamptz,
  "qr_revoked_at" timestamptz,
  "resolution_notes" text,
  "resolved_by_user_id" uuid,
  "resolved_at" timestamptz,
  "cancellation_reason" text,
  "cancelled_by_user_id" uuid,
  "cancelled_at" timestamptz,
  "confirmed_at" timestamptz,
  "checked_in_at" timestamptz,
  "checked_out_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT (now()),
  "updated_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "reservation_candidates" (
  "id" uuid PRIMARY KEY DEFAULT (gen_random_uuid()),
  "reservation_id" uuid NOT NULL,
  "rank" smallint NOT NULL,
  "workspace_instance_id" uuid NOT NULL,
  "start_at" timestamptz NOT NULL,
  "end_at" timestamptz NOT NULL,
  "is_assigned" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT (now()),
  "updated_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "payment_methods" (
  "id" uuid PRIMARY KEY DEFAULT (gen_random_uuid()),
  "method_type" payment_method_type NOT NULL,
  "display_name" text NOT NULL,
  "account_name" text,
  "account_number" text,
  "qr_image_path" text,
  "instructions" text,
  "allow_web" boolean NOT NULL DEFAULT false,
  "allow_kiosk" boolean NOT NULL DEFAULT false,
  "is_active" boolean NOT NULL DEFAULT true,
  "display_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT (now()),
  "updated_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "payment_attempts" (
  "id" uuid PRIMARY KEY DEFAULT (gen_random_uuid()),
  "reservation_id" uuid NOT NULL,
  "attempt_number" integer NOT NULL,
  "channel" payment_channel NOT NULL,
  "payment_method_id" uuid,
  "amount" numeric(10,2) NOT NULL,
  "status" payment_status NOT NULL DEFAULT 'PENDING',
  "token_hash" text,
  "expires_at" timestamptz,
  "proof_storage_path" text,
  "proof_submitted_at" timestamptz,
  "processed_by_user_id" uuid,
  "processed_at" timestamptz,
  "rejection_reason" text,
  "refund_status" refund_status NOT NULL DEFAULT 'NONE',
  "refund_notes" text,
  "refund_recorded_by_user_id" uuid,
  "refunded_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT (now()),
  "updated_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT (gen_random_uuid()),
  "actor_user_id" uuid,
  "actor_role" audit_actor_role NOT NULL,
  "action" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT (now())
);

-- ---------------------------------------------------------------------------
-- 3. Foreign Key Constraints
-- ---------------------------------------------------------------------------

ALTER TABLE "staff_profiles"
  ADD CONSTRAINT "staff_profiles_user_fk"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id");

ALTER TABLE "business_settings"
  ADD CONSTRAINT "business_settings_updated_by_fk"
  FOREIGN KEY ("updated_by_user_id") REFERENCES "staff_profiles" ("user_id");

ALTER TABLE "workspace_instances"
  ADD CONSTRAINT "workspace_instances_template_fk"
  FOREIGN KEY ("template_id") REFERENCES "workspace_templates" ("id");

ALTER TABLE "workspace_instances"
  ADD CONSTRAINT "workspace_instances_floor_fk"
  FOREIGN KEY ("floor_id") REFERENCES "floors" ("id");

ALTER TABLE "schedule_blocks"
  ADD CONSTRAINT "schedule_blocks_workspace_fk"
  FOREIGN KEY ("workspace_instance_id") REFERENCES "workspace_instances" ("id");

ALTER TABLE "schedule_blocks"
  ADD CONSTRAINT "schedule_blocks_created_by_fk"
  FOREIGN KEY ("created_by_user_id") REFERENCES "staff_profiles" ("user_id");

ALTER TABLE "map_versions"
  ADD CONSTRAINT "map_versions_floor_fk"
  FOREIGN KEY ("floor_id") REFERENCES "floors" ("id");

ALTER TABLE "map_versions"
  ADD CONSTRAINT "map_versions_created_by_fk"
  FOREIGN KEY ("created_by_user_id") REFERENCES "staff_profiles" ("user_id");

ALTER TABLE "map_versions"
  ADD CONSTRAINT "map_versions_published_by_fk"
  FOREIGN KEY ("published_by_user_id") REFERENCES "staff_profiles" ("user_id");

ALTER TABLE "map_elements"
  ADD CONSTRAINT "map_elements_version_fk"
  FOREIGN KEY ("map_version_id") REFERENCES "map_versions" ("id");

ALTER TABLE "map_elements"
  ADD CONSTRAINT "map_elements_workspace_fk"
  FOREIGN KEY ("workspace_instance_id") REFERENCES "workspace_instances" ("id");

ALTER TABLE "reservations"
  ADD CONSTRAINT "reservations_resolved_by_fk"
  FOREIGN KEY ("resolved_by_user_id") REFERENCES "staff_profiles" ("user_id");

ALTER TABLE "reservations"
  ADD CONSTRAINT "reservations_cancelled_by_fk"
  FOREIGN KEY ("cancelled_by_user_id") REFERENCES "staff_profiles" ("user_id");

ALTER TABLE "reservation_candidates"
  ADD CONSTRAINT "reservation_candidates_reservation_fk"
  FOREIGN KEY ("reservation_id") REFERENCES "reservations" ("id");

ALTER TABLE "reservation_candidates"
  ADD CONSTRAINT "reservation_candidates_workspace_fk"
  FOREIGN KEY ("workspace_instance_id") REFERENCES "workspace_instances" ("id");

ALTER TABLE "payment_attempts"
  ADD CONSTRAINT "payment_attempts_reservation_fk"
  FOREIGN KEY ("reservation_id") REFERENCES "reservations" ("id");

ALTER TABLE "payment_attempts"
  ADD CONSTRAINT "payment_attempts_method_fk"
  FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods" ("id");

ALTER TABLE "payment_attempts"
  ADD CONSTRAINT "payment_attempts_processed_by_fk"
  FOREIGN KEY ("processed_by_user_id") REFERENCES "staff_profiles" ("user_id");

ALTER TABLE "payment_attempts"
  ADD CONSTRAINT "payment_attempts_refund_by_fk"
  FOREIGN KEY ("refund_recorded_by_user_id") REFERENCES "staff_profiles" ("user_id");

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_actor_fk"
  FOREIGN KEY ("actor_user_id") REFERENCES "staff_profiles" ("user_id");
