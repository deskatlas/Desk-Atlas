-- Migration Down: 052_relax_audit_logs_actor_consistency_down.sql
-- Description: Revert audit_logs actor consistency constraint relaxation
-- Traceability: MS-102

BEGIN;

ALTER TABLE public.audit_logs
  DROP CONSTRAINT IF EXISTS audit_logs_system_actor_consistency;

ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_system_actor_consistency CHECK (
    (actor_role = 'SYSTEM' AND actor_user_id IS NULL)
    OR
    (actor_role IN ('ADMIN', 'STAFF') AND actor_user_id IS NOT NULL)
  );

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

COMMIT;

