-- Migration 017: Create promotional_rates table

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'DAY_PASS' AND enumtypid = 'public.pricing_unit'::regtype) THEN
    ALTER TYPE public.pricing_unit ADD VALUE 'DAY_PASS';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'NIGHT_PASS' AND enumtypid = 'public.pricing_unit'::regtype) THEN
    ALTER TYPE public.pricing_unit ADD VALUE 'NIGHT_PASS';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.promotional_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  workspace_template_ids uuid[] NOT NULL,
  rate_type public.pricing_unit NOT NULL DEFAULT 'HOURLY',
  promotional_price numeric(10,2) NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT promotional_rates_name_nonblank CHECK (btrim(name) <> ''),
  CONSTRAINT promotional_rates_price_nonnegative CHECK (promotional_price >= 0),
  CONSTRAINT promotional_rates_valid_window CHECK (start_at < end_at)
);

CREATE INDEX IF NOT EXISTS idx_promotional_rates_window 
  ON public.promotional_rates(start_at, end_at, is_active);

-- Enable Row Level Security
ALTER TABLE public.promotional_rates ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS promotional_rates_read_policy ON public.promotional_rates;
DROP POLICY IF EXISTS promotional_rates_admin_policy ON public.promotional_rates;

-- Anonymous and authenticated users can view active promotions
CREATE POLICY promotional_rates_read_policy ON public.promotional_rates
  FOR SELECT TO anon, authenticated
  USING (is_active = true);

-- Only active administrators can create, update, or delete promotions
CREATE POLICY promotional_rates_admin_policy ON public.promotional_rates
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.staff_profiles
      WHERE user_id = auth.uid()
        AND role = 'ADMIN'
        AND is_active = true
    )
  );
