-- MS-35 / QAD-TC35: Verified B-tree aid for assigned candidate REST predicates.
-- Run without a transaction wrapper because CREATE INDEX CONCURRENTLY cannot run in one.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rc_assigned_workspace_window
  ON public.reservation_candidates (workspace_instance_id, start_at, end_at)
  WHERE is_assigned = true;
