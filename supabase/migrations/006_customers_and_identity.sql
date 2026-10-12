-- DeskAtlas: Customer Identity and Notification Outbox Migration
-- Traceability: SPEC-1, PRD-F22, SDD-C13, ERD-E15, ERD-E21, QAD-TC36
-- Non-destructive forward migration with pairing reversal instructions.

BEGIN;

-- 1. Create customers table (ERD-E15)
CREATE TABLE IF NOT EXISTS public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_code text NOT NULL,
  email text NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  phone varchar(30) NULL,
  first_confirmed_reservation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_customers_customer_code UNIQUE (customer_code),
  CONSTRAINT uq_customers_email UNIQUE (email),
  CONSTRAINT customers_code_format CHECK (
    length(customer_code) = 6 AND
    customer_code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$'
  ),
  CONSTRAINT customers_email_format CHECK (
    btrim(email) <> '' AND
    position('@' in email) > 0 AND
    length(email) <= 254 AND
    email = lower(btrim(email))
  ),
  CONSTRAINT customers_first_name_nonblank CHECK (btrim(first_name) <> ''),
  CONSTRAINT customers_last_name_nonblank CHECK (btrim(last_name) <> '')
);

-- Foreign key from customers to reservations (first_confirmed_reservation_id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customers_first_reservation_fk'
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_first_reservation_fk
      FOREIGN KEY (first_confirmed_reservation_id)
      REFERENCES public.reservations(id)
      ON UPDATE RESTRICT
      ON DELETE RESTRICT;
  END IF;
END $$;

-- 2. Add customer_id to reservations table (ERD-E10 Extension)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reservations' AND column_name = 'customer_id'
  ) THEN
    ALTER TABLE public.reservations
      ADD COLUMN customer_id uuid NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reservations_customer_fk'
  ) THEN
    ALTER TABLE public.reservations
      ADD CONSTRAINT reservations_customer_fk
      FOREIGN KEY (customer_id)
      REFERENCES public.customers(id)
      ON UPDATE RESTRICT
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_reservations_customer_confirmed
  ON public.reservations (customer_id, confirmed_at, id)
  WHERE customer_id IS NOT NULL;

-- 3. Create notification outbox table (ERD-E21)
CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key text NOT NULL,
  kind text NOT NULL,
  customer_id uuid NULL,
  reservation_id uuid NULL,
  voucher_id uuid NULL,
  recipient_email text NOT NULL,
  payload jsonb NOT NULL,
  depends_on_id uuid NULL,
  status text NOT NULL DEFAULT 'PENDING',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz NULL,
  provider_message_id text NULL,
  last_error_code text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz NULL,
  CONSTRAINT uq_notification_outbox_dedupe_key UNIQUE (dedupe_key),
  CONSTRAINT notification_outbox_kind_check CHECK (
    kind IN ('BOOKING_CONFIRMED', 'SAVE_CUSTOMER_ID', 'VOUCHER_EMAIL')
  ),
  CONSTRAINT notification_outbox_status_check CHECK (
    status IN ('PENDING', 'PROCESSING', 'SENT', 'RETRY', 'FAILED')
  ),
  CONSTRAINT notification_outbox_attempts_nonnegative CHECK (attempts >= 0),
  CONSTRAINT notification_outbox_sent_at_check CHECK (
    (status = 'SENT' AND sent_at IS NOT NULL) OR
    (status <> 'SENT')
  ),
  CONSTRAINT notification_outbox_customer_fk
    FOREIGN KEY (customer_id)
    REFERENCES public.customers(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT notification_outbox_reservation_fk
    FOREIGN KEY (reservation_id)
    REFERENCES public.reservations(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT notification_outbox_depends_on_fk
    FOREIGN KEY (depends_on_id)
    REFERENCES public.notification_outbox(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_status_next_attempt
  ON public.notification_outbox (status, next_attempt_at);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_processing_lease
  ON public.notification_outbox (status, lease_until)
  WHERE status = 'PROCESSING';

-- 4. Row Level Security
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;

-- Customers policies: Staff/Admin read only; mutations through secure server operations
DROP POLICY IF EXISTS p_customers_admin_all ON public.customers;
CREATE POLICY p_customers_admin_all ON public.customers
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS p_customers_staff_read ON public.customers;
CREATE POLICY p_customers_staff_read ON public.customers
  FOR SELECT
  TO authenticated
  USING (public.is_staff_or_admin());

-- Notification Outbox policies: Admin view only; worker runs as service_role
DROP POLICY IF EXISTS p_notification_outbox_admin_read ON public.notification_outbox;
CREATE POLICY p_notification_outbox_admin_read ON public.notification_outbox
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

COMMIT;

-- REVERSAL PROCEDURE (FOR DISPOSABLE TEST ENVIRONMENTS ONLY):
-- DROP POLICY IF EXISTS p_notification_outbox_admin_read ON public.notification_outbox;
-- DROP POLICY IF EXISTS p_customers_staff_read ON public.customers;
-- DROP POLICY IF EXISTS p_customers_admin_all ON public.customers;
-- DROP TABLE IF EXISTS public.notification_outbox;
-- ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_customer_fk;
-- ALTER TABLE public.reservations DROP COLUMN IF EXISTS customer_id;
-- DROP TABLE IF EXISTS public.customers;
