-- Down Migration: Drop companion_names array from reservations table
-- MS85-R06; PRD-F1/F2, BRD-M1/M6, SDD-C3/C11, ERD-E10, QAD-TC1/TC2/TC22
BEGIN;

ALTER TABLE public.reservations
  DROP COLUMN IF EXISTS companion_names;

COMMIT;

