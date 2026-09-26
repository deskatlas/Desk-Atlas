-- Migration 016: Add closure impact fields to reservations
-- Traceability: MS-09 (Closure Collision & Customer Relocation Resolution)

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS closure_exception_id UUID REFERENCES closure_exceptions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_closure_impacted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS closure_impact_status TEXT CHECK (
    closure_impact_status IN (
      'AFFECTED_PENDING_ACTION',
      'CUSTOMER_RESOLVED',
      'STAFF_RESOLVED',
      'MANUAL_RESOLUTION_REQUIRED'
    )
  ),
  ADD COLUMN IF NOT EXISTS closure_notified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS manual_resolution_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_reservations_closure_impact 
  ON reservations (is_closure_impacted, closure_impact_status) 
  WHERE is_closure_impacted = true;

COMMENT ON COLUMN reservations.is_closure_impacted IS 
  'True if the reservation interval collides with a scheduled business closure or holiday exception.';
COMMENT ON COLUMN reservations.closure_impact_status IS 
  'Lifecycle resolution state for reservations impacted by facility closures.';
