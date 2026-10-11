-- MS-35 / QAD-TC35: Transactional fixture for a local disposable PostgreSQL 15/16 database.
BEGIN;
CREATE TEMP TABLE ms35_candidates (
  workspace_instance_id uuid NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  is_assigned boolean NOT NULL
);
INSERT INTO ms35_candidates
SELECT '00000000-0000-0000-0000-000000000001'::uuid,
  '2026-10-01'::timestamptz + n * interval '1 minute',
  '2026-10-01'::timestamptz + n * interval '1 minute' + interval '30 minutes',
  n % 100 = 0
FROM generate_series(1, 100000) AS n;
CREATE INDEX ms35_baseline_workspace_time ON ms35_candidates (workspace_instance_id, start_at, end_at);
ANALYZE ms35_candidates;
CREATE TEMP TABLE ms35_before AS
SELECT * FROM ms35_candidates WHERE workspace_instance_id = '00000000-0000-0000-0000-000000000001'
  AND is_assigned = true AND start_at < '2026-10-03' AND end_at > '2026-10-01';
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT * FROM ms35_candidates WHERE workspace_instance_id = '00000000-0000-0000-0000-000000000001'
  AND is_assigned = true AND start_at < '2026-10-03' AND end_at > '2026-10-01';
CREATE INDEX idx_rc_assigned_workspace_window ON ms35_candidates (workspace_instance_id, start_at, end_at)
  WHERE is_assigned = true;
ANALYZE ms35_candidates;
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT * FROM ms35_candidates WHERE workspace_instance_id = '00000000-0000-0000-0000-000000000001'
  AND is_assigned = true AND start_at < '2026-10-03' AND end_at > '2026-10-01';
DO $$
BEGIN
  IF EXISTS (
    (SELECT * FROM ms35_before EXCEPT SELECT * FROM ms35_candidates
      WHERE workspace_instance_id = '00000000-0000-0000-0000-000000000001'
      AND is_assigned = true AND start_at < '2026-10-03' AND end_at > '2026-10-01')
    UNION ALL
    (SELECT * FROM ms35_candidates WHERE workspace_instance_id = '00000000-0000-0000-0000-000000000001'
      AND is_assigned = true AND start_at < '2026-10-03' AND end_at > '2026-10-01'
      EXCEPT SELECT * FROM ms35_before)
  ) THEN RAISE EXCEPTION 'MS-35 query semantics changed'; END IF;
END $$;
SELECT 'MS35_SEMANTIC_PARITY_OK';
ROLLBACK;
