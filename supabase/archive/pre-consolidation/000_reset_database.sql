-- ============================================================================
-- DeskAtlas - 000_reset_database.sql
-- Development / Testing Utility: Complete Schema & Storage Wipe
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Reset Public Schema
-- ----------------------------------------------------------------------------

DROP SCHEMA IF EXISTS public CASCADE;

CREATE SCHEMA public AUTHORIZATION postgres;

GRANT USAGE ON SCHEMA public
TO postgres, anon, authenticated, service_role;

GRANT ALL ON SCHEMA public
TO postgres, service_role;

-- ----------------------------------------------------------------------------
-- 2. Storage Note
-- ----------------------------------------------------------------------------
-- Direct deletion from storage.objects is blocked by Supabase (storage.protect_delete).
-- Buckets and policies will be upserted idempotently by 003_storage.sql.
-- If you need to clear uploaded files, delete them via the Supabase Dashboard
-- Storage tab or the Supabase Storage API.

