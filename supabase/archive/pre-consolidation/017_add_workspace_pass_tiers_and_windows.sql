-- Migration 017: Add Pass Windows to business_settings and Pass Tiers to workspace_templates
-- Traceability: MS-11 (Workspace Pass Pricing & Operating Windows)

-- 1. Extend business_settings with Pass Window configurations
ALTER TABLE public.business_settings
  ADD COLUMN IF NOT EXISTS day_pass_start_time text NOT NULL DEFAULT '07:00',
  ADD COLUMN IF NOT EXISTS day_pass_end_time text NOT NULL DEFAULT '23:30',
  ADD COLUMN IF NOT EXISTS night_pass_start_time text NOT NULL DEFAULT '20:00',
  ADD COLUMN IF NOT EXISTS night_pass_end_time text NOT NULL DEFAULT '07:00';

-- 2. Extend workspace_templates with Pass Pricing options
ALTER TABLE public.workspace_templates
  ADD COLUMN IF NOT EXISTS has_day_pass boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS day_pass_price numeric(10,2) NULL,
  ADD COLUMN IF NOT EXISTS has_night_pass boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS night_pass_price numeric(10,2) NULL,
  ADD COLUMN IF NOT EXISTS has_whole_day_pass boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS whole_day_pass_price numeric(10,2) NULL,
  ADD COLUMN IF NOT EXISTS has_half_day_pass boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS half_day_pass_price numeric(10,2) NULL;

-- 3. Add integrity constraints
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_day_pass_price_positive') THEN
    ALTER TABLE public.workspace_templates
      ADD CONSTRAINT check_day_pass_price_positive
        CHECK (has_day_pass = false OR (day_pass_price IS NOT NULL AND day_pass_price >= 0));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_night_pass_price_positive') THEN
    ALTER TABLE public.workspace_templates
      ADD CONSTRAINT check_night_pass_price_positive
        CHECK (has_night_pass = false OR (night_pass_price IS NOT NULL AND night_pass_price >= 0));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_whole_day_pass_price_positive') THEN
    ALTER TABLE public.workspace_templates
      ADD CONSTRAINT check_whole_day_pass_price_positive
        CHECK (has_whole_day_pass = false OR (whole_day_pass_price IS NOT NULL AND whole_day_pass_price >= 0));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_half_day_pass_price_positive') THEN
    ALTER TABLE public.workspace_templates
      ADD CONSTRAINT check_half_day_pass_price_positive
        CHECK (has_half_day_pass = false OR (half_day_pass_price IS NOT NULL AND half_day_pass_price >= 0));
  END IF;
END $$;
