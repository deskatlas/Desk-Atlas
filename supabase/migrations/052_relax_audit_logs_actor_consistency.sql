-- Migration: 052_relax_audit_logs_actor_consistency.sql
-- Description: Relax audit_logs check constraint to permit customer self-service and flexible admin/staff audit actors
-- Traceability: MS-102, PRD-F9, PRD-F13, PRD-F14, SDD-C1, SDD-C6, SDD-C12, ERD-E10, ERD-E14, QAD-TC34, QAD-TC37

-- 1. Ensure public.audit_actor_role enum contains CUSTOMER and SUPERADMIN
-- In PostgreSQL, new enum values added via ALTER TYPE ... ADD VALUE must be committed before they can be referenced in check constraints.
ALTER TYPE public.audit_actor_role ADD VALUE IF NOT EXISTS 'CUSTOMER';
ALTER TYPE public.audit_actor_role ADD VALUE IF NOT EXISTS 'SUPERADMIN';

COMMIT;

-- 2. Relax check constraint on public.audit_logs
BEGIN;

ALTER TABLE public.audit_logs
  DROP CONSTRAINT IF EXISTS audit_logs_system_actor_consistency;

ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_system_actor_consistency CHECK (
    (actor_role = 'SYSTEM' AND actor_user_id IS NULL)
    OR
    (actor_role = 'CUSTOMER' AND actor_user_id IS NULL)
    OR
    (actor_role IN ('ADMIN', 'STAFF', 'SUPERADMIN'))
  );

-- 3. Update validate_audit_actor trigger function to support customer self-service and flexible admin actors
CREATE OR REPLACE FUNCTION public.validate_audit_actor()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_role public.staff_role;
BEGIN
  -- Customer self-service and system automation actors do not have a staff profile
  IF NEW.actor_role::text = 'SYSTEM' OR NEW.actor_role::text = 'CUSTOMER' THEN
    RETURN NEW;
  END IF;

  -- Allow administrative / staff actions without a user ID if actor_user_id is NULL
  IF NEW.actor_user_id IS NULL THEN
    IF NEW.actor_role::text IN ('ADMIN', 'SUPERADMIN') THEN
      RETURN NEW;
    ELSE
      RAISE EXCEPTION 'Audit actor must reference an existing DeskAtlas staff profile';
    END IF;
  END IF;

  SELECT role INTO v_role
  FROM public.staff_profiles
  WHERE user_id = NEW.actor_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Audit actor must reference an existing DeskAtlas staff profile';
  END IF;

  IF NEW.actor_role::text <> v_role::text THEN
    IF NOT (NEW.actor_role::text = 'SUPERADMIN' AND v_role::text = 'ADMIN') THEN
      RAISE EXCEPTION 'Audit actor_role % does not match staff role %', NEW.actor_role, v_role;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;

