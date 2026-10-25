-- MS-81 / PRD-F13 / SDD-C12 / ERD-E1/E14 / QAD-TC23/35.
-- Exact supported bodies only; CREATE OR REPLACE preserves ownership and ACLs.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $ms81_guard$
DECLARE
  v_function pg_catalog.pg_proc%ROWTYPE;
BEGIN
  SELECT * INTO v_function FROM pg_catalog.pg_proc
  WHERE oid = to_regprocedure('public.admin_create_staff(uuid, text, text, text, public.staff_role)');
  IF NOT FOUND OR v_function.prosrc IS DISTINCT FROM $ms81_previous$
DECLARE
  v_trimmed_email text;
  v_trimmed_name text;
  v_new_user_id uuid;
  v_encrypted_pw text;
  v_actor_is_super_admin boolean := false;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Creating admin actor is required to create staff accounts';
  END IF;

  SELECT COALESCE(is_super_admin, false) INTO v_actor_is_super_admin
  FROM public.staff_profiles
  WHERE user_id = p_actor_user_id
    AND role = 'ADMIN'
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only active ADMIN profiles may create staff accounts';
  END IF;

  IF p_role = 'ADMIN' AND NOT v_actor_is_super_admin THEN
    RAISE EXCEPTION 'Only the Superadmin can create administrator accounts';
  END IF;

  v_trimmed_email := lower(btrim(p_email));
  v_trimmed_name := btrim(p_display_name);

  IF v_trimmed_email = '' OR position('@' in v_trimmed_email) = 0 THEN
    RAISE EXCEPTION 'A valid email address is required';
  END IF;

  IF v_trimmed_name = '' THEN
    RAISE EXCEPTION 'Display name cannot be blank';
  END IF;

  IF p_password IS NULL OR length(p_password) < 8 OR p_password !~ '[A-Z]' OR p_password !~ '[0-9]' OR p_password !~ '[^a-zA-Z0-9\s]' THEN
    RAISE EXCEPTION 'Password must be at least 8 characters long, contain at least 1 uppercase letter, 1 number, and 1 special character';
  END IF;

  IF p_role NOT IN ('ADMIN', 'STAFF') THEN
    RAISE EXCEPTION 'Role must be either ADMIN or STAFF';
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users WHERE email = v_trimmed_email) THEN
    RAISE EXCEPTION 'A user with email % already exists', v_trimmed_email;
  END IF;

  v_new_user_id := gen_random_uuid();
  v_encrypted_pw := extensions.crypt(p_password::text, extensions.gen_salt('bf'::text));

  INSERT INTO auth.users (
    id,
    instance_id,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    role,
    aud,
    confirmation_token
  )
  VALUES (
    v_new_user_id,
    '00000000-0000-0000-0000-000000000000',
    v_trimmed_email,
    v_encrypted_pw,
    now(),
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    jsonb_build_object('display_name', v_trimmed_name, 'role', p_role::text),
    now(),
    now(),
    'authenticated',
    'authenticated',
    encode(gen_random_bytes(32), 'hex')
  );

  INSERT INTO public.staff_profiles (
    user_id,
    created_by_admin_id,
    role,
    display_name,
    is_active,
    is_super_admin,
    created_at,
    updated_at
  )
  VALUES (
    v_new_user_id,
    p_actor_user_id,
    p_role,
    v_trimmed_name,
    true,
    false,
    now(),
    now()
  );

  INSERT INTO public.audit_logs (
    actor_user_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    metadata
  )
  VALUES (
    p_actor_user_id,
    'ADMIN',
    'CREATE_STAFF_ACCOUNT',
    'staff_profiles',
    v_new_user_id,
    jsonb_build_object(
      'email', v_trimmed_email,
      'role', p_role::text,
      'display_name', v_trimmed_name,
      'created_by_admin_id', p_actor_user_id
    )
  );

  RETURN QUERY
  SELECT
    p.user_id AS id,
    v_trimmed_email AS email,
    p.role,
    p.display_name,
    p.is_active,
    p.created_at,
    p.updated_at,
    NULL::timestamptz AS last_sign_in_at,
    p.created_by_admin_id,
    COALESCE(p.is_super_admin, false) AS is_super_admin
  FROM public.staff_profiles p
  WHERE p.user_id = v_new_user_id;
END;
$ms81_previous$
    OR v_function.proargnames IS DISTINCT FROM ARRAY['p_actor_user_id','p_email','p_password','p_display_name','p_role','id','email','role','display_name','is_active','created_at','updated_at','last_sign_in_at','created_by_admin_id','is_super_admin']::text[]
    OR NOT v_function.prosecdef OR v_function.provolatile <> 'v'
    OR v_function.pronargdefaults <> 0 OR v_function.proisstrict OR v_function.proleakproof
    OR v_function.proparallel <> 'u' OR v_function.prokind <> 'f'
    OR NOT v_function.proretset OR v_function.prorettype <> 'record'::regtype
    OR v_function.prolang <> (SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
    OR v_function.proconfig IS DISTINCT FROM ARRAY['search_path=public, auth, extensions']::text[]
    OR pg_get_function_result(v_function.oid) IS DISTINCT FROM 'TABLE(id uuid, email text, role staff_role, display_name text, is_active boolean, created_at timestamp with time zone, updated_at timestamp with time zone, last_sign_in_at timestamp with time zone, created_by_admin_id uuid, is_super_admin boolean)'
  THEN
    RAISE EXCEPTION 'MS81_UNSUPPORTED_DEFINITION: admin_create_staff';
  END IF;
  EXECUTE $ms81_replacement$CREATE OR REPLACE FUNCTION public.admin_create_staff(
  p_actor_user_id uuid,
  p_email text,
  p_password text,
  p_display_name text,
  p_role public.staff_role
)
RETURNS TABLE (
  id uuid,
  email text,
  role public.staff_role,
  display_name text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz,
  last_sign_in_at timestamptz,
  created_by_admin_id uuid,
  is_super_admin boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_trimmed_email text;
  v_trimmed_name text;
  v_new_user_id uuid;
  v_encrypted_pw text;
  v_actor_is_super_admin boolean := false;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Creating admin actor is required to create staff accounts';
  END IF;

  SELECT COALESCE(actor.is_super_admin, false) INTO v_actor_is_super_admin
  FROM public.staff_profiles actor
  WHERE actor.user_id = p_actor_user_id
    AND actor.role = 'ADMIN'
    AND actor.is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only active ADMIN profiles may create staff accounts';
  END IF;

  IF p_role = 'ADMIN' AND NOT v_actor_is_super_admin THEN
    RAISE EXCEPTION 'Only the Superadmin can create administrator accounts';
  END IF;

  v_trimmed_email := lower(btrim(p_email));
  v_trimmed_name := btrim(p_display_name);

  IF v_trimmed_email = '' OR position('@' in v_trimmed_email) = 0 THEN
    RAISE EXCEPTION 'A valid email address is required';
  END IF;

  IF v_trimmed_name = '' THEN
    RAISE EXCEPTION 'Display name cannot be blank';
  END IF;

  IF p_password IS NULL OR length(p_password) < 8 OR p_password !~ '[A-Z]' OR p_password !~ '[0-9]' OR p_password !~ '[^a-zA-Z0-9\s]' THEN
    RAISE EXCEPTION 'Password must be at least 8 characters long, contain at least 1 uppercase letter, 1 number, and 1 special character';
  END IF;

  IF p_role NOT IN ('ADMIN', 'STAFF') THEN
    RAISE EXCEPTION 'Role must be either ADMIN or STAFF';
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users existing_user WHERE existing_user.email = v_trimmed_email) THEN
    RAISE EXCEPTION 'A user with email % already exists', v_trimmed_email;
  END IF;

  v_new_user_id := gen_random_uuid();
  v_encrypted_pw := extensions.crypt(p_password::text, extensions.gen_salt('bf'::text));

  INSERT INTO auth.users (
    id,
    instance_id,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    role,
    aud,
    confirmation_token
  )
  VALUES (
    v_new_user_id,
    '00000000-0000-0000-0000-000000000000',
    v_trimmed_email,
    v_encrypted_pw,
    now(),
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    jsonb_build_object('display_name', v_trimmed_name, 'role', p_role::text),
    now(),
    now(),
    'authenticated',
    'authenticated',
    encode(gen_random_bytes(32), 'hex')
  );

  INSERT INTO public.staff_profiles (
    user_id,
    created_by_admin_id,
    role,
    display_name,
    is_active,
    is_super_admin,
    created_at,
    updated_at
  )
  VALUES (
    v_new_user_id,
    p_actor_user_id,
    p_role,
    v_trimmed_name,
    true,
    false,
    now(),
    now()
  );

  INSERT INTO public.audit_logs (
    actor_user_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    metadata
  )
  VALUES (
    p_actor_user_id,
    'ADMIN',
    'CREATE_STAFF_ACCOUNT',
    'staff_profiles',
    v_new_user_id,
    jsonb_build_object(
      'email', v_trimmed_email,
      'role', p_role::text,
      'display_name', v_trimmed_name,
      'created_by_admin_id', p_actor_user_id
    )
  );

  RETURN QUERY
  SELECT
    p.user_id AS id,
    v_trimmed_email AS email,
    p.role,
    p.display_name,
    p.is_active,
    p.created_at,
    p.updated_at,
    NULL::timestamptz AS last_sign_in_at,
    p.created_by_admin_id,
    COALESCE(p.is_super_admin, false) AS is_super_admin
  FROM public.staff_profiles p
  WHERE p.user_id = v_new_user_id;
END;
$$;$ms81_replacement$;
END;
$ms81_guard$;

DO $ms81_guard$
DECLARE
  v_function pg_catalog.pg_proc%ROWTYPE;
BEGIN
  SELECT * INTO v_function FROM pg_catalog.pg_proc
  WHERE oid = to_regprocedure('public.admin_update_staff(uuid, uuid, text, public.staff_role, boolean, text)');
  IF NOT FOUND OR v_function.prosrc IS DISTINCT FROM $ms81_previous$
DECLARE
  v_current_profile public.staff_profiles%ROWTYPE;
  v_action text := 'UPDATE_STAFF_ACCOUNT';
  v_actor_is_super_admin boolean := false;
BEGIN
  IF p_actor_user_id IS NOT NULL THEN
    SELECT (COALESCE(sp.is_super_admin, false) OR sp.created_by_admin_id IS NULL) INTO v_actor_is_super_admin
    FROM public.staff_profiles sp
    WHERE sp.user_id = p_actor_user_id
      AND sp.role = 'ADMIN'
      AND sp.is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Only active ADMIN profiles may manage staff accounts';
    END IF;
  END IF;

  SELECT * INTO v_current_profile
  FROM public.staff_profiles
  WHERE user_id = p_target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff member not found';
  END IF;

  -- Protection: Superadmin account cannot be demoted or deactivated
  IF v_current_profile.is_super_admin THEN
    IF p_role IS NOT NULL AND p_role <> 'ADMIN' THEN
      RAISE EXCEPTION 'Cannot demote the Superadmin account';
    END IF;
    IF p_is_active IS NOT NULL AND p_is_active = false THEN
      RAISE EXCEPTION 'Cannot deactivate the Superadmin account';
    END IF;
  END IF;

  -- Non-superadmin cannot manage other admin accounts
  IF v_current_profile.role = 'ADMIN' AND NOT v_actor_is_super_admin AND p_actor_user_id IS NOT NULL AND p_actor_user_id <> p_target_user_id THEN
    RAISE EXCEPTION 'Only the Superadmin can manage administrator accounts';
  END IF;

  -- Non-superadmin cannot promote to admin
  IF p_role = 'ADMIN' AND v_current_profile.role <> 'ADMIN' AND NOT v_actor_is_super_admin THEN
    RAISE EXCEPTION 'Only the Superadmin can promote accounts to administrator';
  END IF;

  IF p_display_name IS NOT NULL AND btrim(p_display_name) = '' THEN
    RAISE EXCEPTION 'Display name cannot be blank';
  END IF;

  IF p_new_password IS NOT NULL AND btrim(p_new_password) <> '' THEN
    IF length(p_new_password) < 8 OR p_new_password !~ '[A-Z]' OR p_new_password !~ '[0-9]' OR p_new_password !~ '[^a-zA-Z0-9\s]' THEN
      RAISE EXCEPTION 'Password must be at least 8 characters long, contain at least 1 uppercase letter, 1 number, and 1 special character';
    END IF;
    UPDATE auth.users
    SET
      encrypted_password = extensions.crypt(p_new_password::text, extensions.gen_salt('bf'::text)),
      updated_at = now()
    WHERE id = p_target_user_id;
  END IF;

  IF p_is_active IS NOT NULL AND p_is_active <> v_current_profile.is_active THEN
    IF p_is_active = false THEN
      v_action := 'DEACTIVATE_STAFF_ACCOUNT';
    ELSE
      v_action := 'REACTIVATE_STAFF_ACCOUNT';
    END IF;
  END IF;

  UPDATE public.staff_profiles
  SET
    display_name = COALESCE(btrim(p_display_name), display_name),
    role = COALESCE(p_role, role),
    is_active = COALESCE(p_is_active, is_active),
    updated_at = now()
  WHERE user_id = p_target_user_id;

  IF p_actor_user_id IS NOT NULL THEN
    INSERT INTO public.audit_logs (
      actor_user_id,
      actor_role,
      action,
      entity_type,
      entity_id,
      metadata
    )
    VALUES (
      p_actor_user_id,
      'ADMIN',
      v_action,
      'staff_profiles',
      p_target_user_id,
      jsonb_build_object(
        'previous_role', v_current_profile.role::text,
        'new_role', COALESCE(p_role::text, v_current_profile.role::text),
        'previous_display_name', v_current_profile.display_name,
        'new_display_name', COALESCE(btrim(p_display_name), v_current_profile.display_name),
        'previous_is_active', v_current_profile.is_active,
        'new_is_active', COALESCE(p_is_active, v_current_profile.is_active),
        'password_changed', (p_new_password IS NOT NULL AND btrim(p_new_password) <> ''),
        'created_by_admin_id', v_current_profile.created_by_admin_id
      )
    );
  END IF;

  RETURN QUERY
  SELECT
    p.user_id AS id,
    COALESCE(u.email, 'unknown@deskatlas.com')::text AS email,
    p.role,
    p.display_name,
    p.is_active,
    p.created_at,
    p.updated_at,
    u.last_sign_in_at,
    p.created_by_admin_id,
    COALESCE(p.is_super_admin, false) AS is_super_admin
  FROM public.staff_profiles p
  LEFT JOIN auth.users u ON u.id = p.user_id
  WHERE p.user_id = p_target_user_id;
END;
$ms81_previous$
    OR v_function.proargnames IS DISTINCT FROM ARRAY['p_actor_user_id','p_target_user_id','p_display_name','p_role','p_is_active','p_new_password','id','email','role','display_name','is_active','created_at','updated_at','last_sign_in_at','created_by_admin_id','is_super_admin']::text[]
    OR NOT v_function.prosecdef OR v_function.provolatile <> 'v'
    OR v_function.pronargdefaults <> 4 OR v_function.proisstrict OR v_function.proleakproof
    OR v_function.proparallel <> 'u' OR v_function.prokind <> 'f'
    OR pg_get_expr(v_function.proargdefaults, 0) IS DISTINCT FROM 'NULL::text, NULL::staff_role, NULL::boolean, NULL::text'
    OR NOT v_function.proretset OR v_function.prorettype <> 'record'::regtype
    OR v_function.prolang <> (SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
    OR v_function.proconfig IS DISTINCT FROM ARRAY['search_path=public, auth, extensions']::text[]
    OR pg_get_function_result(v_function.oid) IS DISTINCT FROM 'TABLE(id uuid, email text, role staff_role, display_name text, is_active boolean, created_at timestamp with time zone, updated_at timestamp with time zone, last_sign_in_at timestamp with time zone, created_by_admin_id uuid, is_super_admin boolean)'
  THEN
    RAISE EXCEPTION 'MS81_UNSUPPORTED_DEFINITION: admin_update_staff';
  END IF;
  EXECUTE $ms81_replacement$CREATE OR REPLACE FUNCTION public.admin_update_staff(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_display_name text DEFAULT NULL,
  p_role public.staff_role DEFAULT NULL,
  p_is_active boolean DEFAULT NULL,
  p_new_password text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  email text,
  role public.staff_role,
  display_name text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz,
  last_sign_in_at timestamptz,
  created_by_admin_id uuid,
  is_super_admin boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_current_profile public.staff_profiles%ROWTYPE;
  v_action text := 'UPDATE_STAFF_ACCOUNT';
  v_actor_is_super_admin boolean := false;
BEGIN
  IF p_actor_user_id IS NOT NULL THEN
    SELECT (COALESCE(sp.is_super_admin, false) OR sp.created_by_admin_id IS NULL) INTO v_actor_is_super_admin
    FROM public.staff_profiles sp
    WHERE sp.user_id = p_actor_user_id
      AND sp.role = 'ADMIN'
      AND sp.is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Only active ADMIN profiles may manage staff accounts';
    END IF;
  END IF;

  SELECT * INTO v_current_profile
  FROM public.staff_profiles
  WHERE user_id = p_target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff member not found';
  END IF;

  -- Protection: Superadmin account cannot be demoted or deactivated
  IF v_current_profile.is_super_admin THEN
    IF p_role IS NOT NULL AND p_role <> 'ADMIN' THEN
      RAISE EXCEPTION 'Cannot demote the Superadmin account';
    END IF;
    IF p_is_active IS NOT NULL AND p_is_active = false THEN
      RAISE EXCEPTION 'Cannot deactivate the Superadmin account';
    END IF;
  END IF;

  -- Non-superadmin cannot manage other admin accounts
  IF v_current_profile.role = 'ADMIN' AND NOT v_actor_is_super_admin AND p_actor_user_id IS NOT NULL AND p_actor_user_id <> p_target_user_id THEN
    RAISE EXCEPTION 'Only the Superadmin can manage administrator accounts';
  END IF;

  -- Non-superadmin cannot promote to admin
  IF p_role = 'ADMIN' AND v_current_profile.role <> 'ADMIN' AND NOT v_actor_is_super_admin THEN
    RAISE EXCEPTION 'Only the Superadmin can promote accounts to administrator';
  END IF;

  IF p_display_name IS NOT NULL AND btrim(p_display_name) = '' THEN
    RAISE EXCEPTION 'Display name cannot be blank';
  END IF;

  IF p_new_password IS NOT NULL AND btrim(p_new_password) <> '' THEN
    IF length(p_new_password) < 8 OR p_new_password !~ '[A-Z]' OR p_new_password !~ '[0-9]' OR p_new_password !~ '[^a-zA-Z0-9\s]' THEN
      RAISE EXCEPTION 'Password must be at least 8 characters long, contain at least 1 uppercase letter, 1 number, and 1 special character';
    END IF;
    UPDATE auth.users target_user
    SET
      encrypted_password = extensions.crypt(p_new_password::text, extensions.gen_salt('bf'::text)),
      updated_at = now()
    WHERE target_user.id = p_target_user_id;
  END IF;

  IF p_is_active IS NOT NULL AND p_is_active <> v_current_profile.is_active THEN
    IF p_is_active = false THEN
      v_action := 'DEACTIVATE_STAFF_ACCOUNT';
    ELSE
      v_action := 'REACTIVATE_STAFF_ACCOUNT';
    END IF;
  END IF;

  UPDATE public.staff_profiles target_profile
  SET
    display_name = COALESCE(btrim(p_display_name), target_profile.display_name),
    role = COALESCE(p_role, target_profile.role),
    is_active = COALESCE(p_is_active, target_profile.is_active),
    updated_at = now()
  WHERE user_id = p_target_user_id;

  IF p_actor_user_id IS NOT NULL THEN
    INSERT INTO public.audit_logs (
      actor_user_id,
      actor_role,
      action,
      entity_type,
      entity_id,
      metadata
    )
    VALUES (
      p_actor_user_id,
      'ADMIN',
      v_action,
      'staff_profiles',
      p_target_user_id,
      jsonb_build_object(
        'previous_role', v_current_profile.role::text,
        'new_role', COALESCE(p_role::text, v_current_profile.role::text),
        'previous_display_name', v_current_profile.display_name,
        'new_display_name', COALESCE(btrim(p_display_name), v_current_profile.display_name),
        'previous_is_active', v_current_profile.is_active,
        'new_is_active', COALESCE(p_is_active, v_current_profile.is_active),
        'password_changed', (p_new_password IS NOT NULL AND btrim(p_new_password) <> ''),
        'created_by_admin_id', v_current_profile.created_by_admin_id
      )
    );
  END IF;

  RETURN QUERY
  SELECT
    p.user_id AS id,
    COALESCE(u.email, 'unknown@deskatlas.com')::text AS email,
    p.role,
    p.display_name,
    p.is_active,
    p.created_at,
    p.updated_at,
    u.last_sign_in_at,
    p.created_by_admin_id,
    COALESCE(p.is_super_admin, false) AS is_super_admin
  FROM public.staff_profiles p
  LEFT JOIN auth.users u ON u.id = p.user_id
  WHERE p.user_id = p_target_user_id;
END;
$$;$ms81_replacement$;
END;
$ms81_guard$;
COMMIT;
