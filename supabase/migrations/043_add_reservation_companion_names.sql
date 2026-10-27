-- Forward Migration: Add companion_names array to reservations table
-- MS85-R06; PRD-F1/F2, BRD-M1/M6, SDD-C3/C11, ERD-E10, QAD-TC1/TC2/TC22
BEGIN;

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS companion_names text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.reservations.companion_names IS
  'Optional list of companion guest full names for multi-capacity spots (for front-desk records only).';

COMMIT;

