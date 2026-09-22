-- MF-181: Add configurable reschedule max advance limit to business_settings
ALTER TABLE public.business_settings
  ADD COLUMN IF NOT EXISTS reschedule_max_advance_value INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS reschedule_max_advance_unit TEXT NOT NULL DEFAULT 'DAYS';
