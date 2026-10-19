-- MS-69: Customer Advance Reservation Reminders, Attendance Reconfirmation, Admin Cancellation Receipts, and Multi-Trigger Push Alerts
-- Traceability: PRD-F5, PRD-F6, SDD-C4, SDD-C5, SDD-C11, DSD-UI11, ERD-E2, ERD-E10, ERD-E11, ERD-E13, QAD-TC50, MS69-TC01..14
BEGIN;

ALTER TABLE public.business_settings
  ADD COLUMN IF NOT EXISTS customer_reminder_advance_value integer NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS customer_reminder_advance_unit text NOT NULL DEFAULT 'HOURS'
    CHECK (customer_reminder_advance_unit IN ('HOURS', 'DAYS'));

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS attendance_reconfirmed_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_reservations_reminder_sent
  ON public.reservations(reminder_sent_at);

CREATE INDEX IF NOT EXISTS idx_reservations_attendance_reconfirmed
  ON public.reservations(attendance_reconfirmed_at);

COMMIT;
