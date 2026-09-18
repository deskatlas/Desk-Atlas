-- ============================================================================
-- DeskAtlas - 004_security_and_rls.sql
-- Permissions, Grants, RLS Helper Functions & Table Row Level Security Policies
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Schema Grants & Permissions
-- ----------------------------------------------------------------------------

-- Grant schema usage
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON SCHEMA public TO postgres, service_role;

-- Grant table permissions
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO anon;

-- Grant sequence permissions
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, anon;

-- Grant routine/function execution
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO postgres, service_role;
GRANT EXECUTE ON ALL ROUTINES IN SCHEMA public TO authenticated, anon;

-- Set default privileges for any future tables/sequences/routines
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO authenticated, anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON ROUTINES TO authenticated, anon;

-- ----------------------------------------------------------------------------
-- 2. RLS Role Resolution Helper Functions
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.current_actor_role()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
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
AS $$
DECLARE
  v_role text := public.current_actor_role();
BEGIN
  RETURN (v_role = 'ADMIN' OR v_role = 'STAFF');
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Table RLS Policies
-- ----------------------------------------------------------------------------

-- staff_profiles
ALTER TABLE public.staff_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_staff_profiles_admin_all ON public.staff_profiles;
CREATE POLICY p_staff_profiles_admin_all ON public.staff_profiles
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS p_staff_profiles_self_read ON public.staff_profiles;
CREATE POLICY p_staff_profiles_self_read ON public.staff_profiles
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- staff_invitations
ALTER TABLE public.staff_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_staff_invitations_admin_all ON public.staff_invitations;
CREATE POLICY p_staff_invitations_admin_all ON public.staff_invitations
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS p_staff_invitations_anon_token_read ON public.staff_invitations;
CREATE POLICY p_staff_invitations_anon_token_read ON public.staff_invitations
  FOR SELECT
  TO anon, authenticated
  USING (status = 'PENDING');

-- admin_password_resets
ALTER TABLE public.admin_password_resets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_admin_password_resets_admin_all ON public.admin_password_resets;
CREATE POLICY p_admin_password_resets_admin_all ON public.admin_password_resets
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS p_admin_password_resets_anon_token_read ON public.admin_password_resets;
CREATE POLICY p_admin_password_resets_anon_token_read ON public.admin_password_resets
  FOR SELECT
  TO anon, authenticated
  USING (status = 'PENDING');

-- workspace_templates
ALTER TABLE public.workspace_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_workspace_templates_public_read ON public.workspace_templates;
CREATE POLICY p_workspace_templates_public_read ON public.workspace_templates
  FOR SELECT
  TO public
  USING (is_active = true OR public.is_staff_or_admin());

DROP POLICY IF EXISTS p_workspace_templates_admin_write ON public.workspace_templates;
CREATE POLICY p_workspace_templates_admin_write ON public.workspace_templates
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- custom_structure_templates
ALTER TABLE public.custom_structure_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_custom_structure_templates_public_read ON public.custom_structure_templates;
CREATE POLICY p_custom_structure_templates_public_read ON public.custom_structure_templates
  FOR SELECT
  TO public
  USING (is_active = true OR public.is_staff_or_admin());

DROP POLICY IF EXISTS p_custom_structure_templates_admin_all ON public.custom_structure_templates;
CREATE POLICY p_custom_structure_templates_admin_all ON public.custom_structure_templates
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- workspace_instances
ALTER TABLE public.workspace_instances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_workspace_instances_public_read ON public.workspace_instances;
CREATE POLICY p_workspace_instances_public_read ON public.workspace_instances
  FOR SELECT
  TO public
  USING (true);

DROP POLICY IF EXISTS p_workspace_instances_staff_update ON public.workspace_instances;
CREATE POLICY p_workspace_instances_staff_update ON public.workspace_instances
  FOR UPDATE
  TO authenticated
  USING (public.is_staff_or_admin())
  WITH CHECK (public.is_staff_or_admin());

DROP POLICY IF EXISTS p_workspace_instances_admin_all ON public.workspace_instances;
CREATE POLICY p_workspace_instances_admin_all ON public.workspace_instances
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- floors
ALTER TABLE public.floors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_floors_public_read ON public.floors;
CREATE POLICY p_floors_public_read ON public.floors
  FOR SELECT
  TO public
  USING (is_active = true OR public.is_staff_or_admin());

DROP POLICY IF EXISTS p_floors_admin_all ON public.floors;
CREATE POLICY p_floors_admin_all ON public.floors
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- map_versions
ALTER TABLE public.map_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_map_versions_public_published_read ON public.map_versions;
CREATE POLICY p_map_versions_public_published_read ON public.map_versions
  FOR SELECT
  TO public
  USING (status = 'PUBLISHED' OR public.is_admin());

DROP POLICY IF EXISTS p_map_versions_admin_all ON public.map_versions;
CREATE POLICY p_map_versions_admin_all ON public.map_versions
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- map_elements
ALTER TABLE public.map_elements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_map_elements_public_read ON public.map_elements;
CREATE POLICY p_map_elements_public_read ON public.map_elements
  FOR SELECT
  TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.map_versions mv
      WHERE mv.id = map_elements.map_version_id
        AND (mv.status = 'PUBLISHED' OR public.is_admin())
    )
  );

DROP POLICY IF EXISTS p_map_elements_admin_all ON public.map_elements;
CREATE POLICY p_map_elements_admin_all ON public.map_elements
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- reservations & reservation_candidates
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservation_candidates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_reservations_insert_guest ON public.reservations;
CREATE POLICY p_reservations_insert_guest ON public.reservations
  FOR INSERT
  TO public
  WITH CHECK (true);

DROP POLICY IF EXISTS p_reservations_staff_read ON public.reservations;
CREATE POLICY p_reservations_staff_read ON public.reservations
  FOR SELECT
  TO authenticated
  USING (public.is_staff_or_admin());

DROP POLICY IF EXISTS p_reservations_admin_all ON public.reservations;
CREATE POLICY p_reservations_admin_all ON public.reservations
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS p_candidates_insert_guest ON public.reservation_candidates;
CREATE POLICY p_candidates_insert_guest ON public.reservation_candidates
  FOR INSERT
  TO public
  WITH CHECK (true);

DROP POLICY IF EXISTS p_candidates_staff_read ON public.reservation_candidates;
CREATE POLICY p_candidates_staff_read ON public.reservation_candidates
  FOR SELECT
  TO authenticated
  USING (public.is_staff_or_admin());

-- payment_attempts
ALTER TABLE public.payment_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_payment_attempts_insert_guest ON public.payment_attempts;
CREATE POLICY p_payment_attempts_insert_guest ON public.payment_attempts
  FOR INSERT
  TO public
  WITH CHECK (true);

DROP POLICY IF EXISTS p_payment_attempts_staff_read ON public.payment_attempts;
CREATE POLICY p_payment_attempts_staff_read ON public.payment_attempts
  FOR SELECT
  TO authenticated
  USING (public.is_staff_or_admin());

DROP POLICY IF EXISTS p_payment_attempts_admin_all ON public.payment_attempts;
CREATE POLICY p_payment_attempts_admin_all ON public.payment_attempts
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- audit_logs
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_audit_logs_admin_read ON public.audit_logs;
CREATE POLICY p_audit_logs_admin_read ON public.audit_logs
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS p_audit_logs_insert_all ON public.audit_logs;
CREATE POLICY p_audit_logs_insert_all ON public.audit_logs
  FOR INSERT
  TO public
  WITH CHECK (true);

-- operating_hours, schedule_blocks, payment_methods, business_settings
ALTER TABLE public.operating_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_operating_hours_read ON public.operating_hours;
CREATE POLICY p_operating_hours_read ON public.operating_hours FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS p_schedule_blocks_read ON public.schedule_blocks;
CREATE POLICY p_schedule_blocks_read ON public.schedule_blocks FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS p_payment_methods_read ON public.payment_methods;
CREATE POLICY p_payment_methods_read ON public.payment_methods FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS p_business_settings_read ON public.business_settings;
CREATE POLICY p_business_settings_read ON public.business_settings FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS p_settings_admin_write_hours ON public.operating_hours;
CREATE POLICY p_settings_admin_write_hours ON public.operating_hours FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS p_settings_admin_write_blocks ON public.schedule_blocks;
CREATE POLICY p_settings_admin_write_blocks ON public.schedule_blocks FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS p_settings_admin_write_methods ON public.payment_methods;
CREATE POLICY p_settings_admin_write_methods ON public.payment_methods FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS p_settings_admin_write_business ON public.business_settings;
CREATE POLICY p_settings_admin_write_business ON public.business_settings FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
