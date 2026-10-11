-- Migration: 013_enable_realtime_replication.sql
-- Description: Enables Supabase Realtime replication on high-frequency tables (reservations, payment_attempts, workspace_instances)
-- Traceability: MS-05 (Vercel Active CPU Remediation - Phase 3)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'reservations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE reservations;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'payment_attempts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE payment_attempts;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'workspace_instances'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE workspace_instances;
  END IF;
END $$;
