-- ============================================================================
-- DeskAtlas - 017_seed_default_payment_methods.sql
-- Seed default payment methods: GCash (Web+Kiosk), Bank (Web only), Cash (Kiosk only)
-- ============================================================================

INSERT INTO public.payment_methods (
  id,
  method_type,
  display_name,
  account_name,
  account_number,
  instructions,
  allow_web,
  allow_kiosk,
  is_active,
  display_order
) VALUES 
  ('a0000000-0000-0000-0000-000000000001', 'GCASH', 'GCash', 'DeskAtlas Coworking', '09171234567', 'Send the exact amount and upload the receipt screenshot.', true, true, true, 1),
  ('a0000000-0000-0000-0000-000000000002', 'BANK', 'BDO Bank Transfer', 'DeskAtlas Coworking', '1234567890', 'Include your reservation reference in the transfer notes.', true, false, true, 2),
  ('a0000000-0000-0000-0000-000000000003', 'CASH', 'Cash', NULL, NULL, 'Proceed to the counter and pay the exact amount in cash.', false, true, true, 3)
ON CONFLICT (id) DO NOTHING;
