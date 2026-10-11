-- ============================================================================
-- DeskAtlas - 003_storage.sql
-- Storage Buckets Initialization and Access Policies
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Initialize Storage Buckets
-- ----------------------------------------------------------------------------

-- Workspace images (Public - 5MB limit)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'workspace-images',
  'workspace-images',
  true,
  5242880,
  ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

-- Workspace templates (Public)
INSERT INTO storage.buckets (id, name, public)
VALUES ('workspace-templates', 'workspace-templates', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Payment QR codes (Public)
INSERT INTO storage.buckets (id, name, public)
VALUES ('payment-qr-codes', 'payment-qr-codes', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Payment proofs (Private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('payment-proofs', 'payment-proofs', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- Business policies (Public - strictly PDF - 10MB limit)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'business-policies',
  'business-policies',
  true,
  10485760,
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET
  public = true,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['application/pdf'];

-- ----------------------------------------------------------------------------
-- 2. Storage Objects Access Policies
-- ----------------------------------------------------------------------------

-- Public read for workspace-images
DROP POLICY IF EXISTS "Public Access for Workspace Images" ON storage.objects;
DROP POLICY IF EXISTS p_storage_workspace_images_public_read ON storage.objects;
CREATE POLICY p_storage_workspace_images_public_read
  ON storage.objects FOR SELECT
  USING (bucket_id = 'workspace-images');

-- Upload for workspace-images
DROP POLICY IF EXISTS "Allow service_role and authenticated upload" ON storage.objects;
DROP POLICY IF EXISTS p_storage_workspace_images_upload ON storage.objects;
CREATE POLICY p_storage_workspace_images_upload
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'workspace-images');

-- Public read for templates, payment QR codes, and business policies
DROP POLICY IF EXISTS p_storage_templates_public_read ON storage.objects;
CREATE POLICY p_storage_templates_public_read
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id IN ('workspace-templates', 'payment-qr-codes', 'business-policies'));

-- Admin write for templates, payment QR codes, and business policies
DROP POLICY IF EXISTS p_storage_templates_admin_write ON storage.objects;
CREATE POLICY p_storage_templates_admin_write
  ON storage.objects FOR ALL
  TO authenticated
  USING (bucket_id IN ('workspace-templates', 'payment-qr-codes', 'business-policies') AND public.is_admin())
  WITH CHECK (bucket_id IN ('workspace-templates', 'payment-qr-codes', 'business-policies') AND public.is_admin());

-- Guest insert for payment proofs
DROP POLICY IF EXISTS p_storage_proofs_guest_insert ON storage.objects;
CREATE POLICY p_storage_proofs_guest_insert
  ON storage.objects FOR INSERT
  TO public
  WITH CHECK (bucket_id = 'payment-proofs');

-- Admin read for payment proofs (Private)
DROP POLICY IF EXISTS p_storage_proofs_admin_read ON storage.objects;
CREATE POLICY p_storage_proofs_admin_read
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'payment-proofs' AND public.is_admin());
