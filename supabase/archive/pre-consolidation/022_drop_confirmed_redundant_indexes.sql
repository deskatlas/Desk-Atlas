-- MS-35 / QAD-TC35: Remove only catalog-verified redundant physical indexes.
-- Run without a transaction wrapper because DROP INDEX CONCURRENTLY cannot run in one.
DO $$
DECLARE
  candidate record;
BEGIN
  FOR candidate IN
    SELECT * FROM (VALUES
      ('idx_reservation_candidates_availability', 'idx_reservation_candidates_workspace_time'),
      ('idx_reservation_candidates_reservation_id', 'idx_reservation_candidates_reservation'),
      ('idx_reservations_reference_code', 'uq_reservations_reference_code')
    ) AS indexes(redundant_name, retained_name)
  LOOP
    IF to_regclass('public.' || candidate.redundant_name) IS NOT NULL THEN
      IF to_regclass('public.' || candidate.retained_name) IS NULL OR NOT EXISTS (
        SELECT 1
        FROM pg_index redundant
        JOIN pg_index retained
          ON retained.indexrelid = to_regclass('public.' || candidate.retained_name)
        WHERE redundant.indexrelid = to_regclass('public.' || candidate.redundant_name)
          AND redundant.indrelid = retained.indrelid
          AND retained.indisvalid AND retained.indisready
          AND redundant.indnatts = retained.indnatts
          AND redundant.indnkeyatts = retained.indnkeyatts
          AND (candidate.retained_name <> 'uq_reservations_reference_code' OR retained.indisunique)
          AND redundant.indkey = retained.indkey
          AND redundant.indclass = retained.indclass
          AND redundant.indcollation = retained.indcollation
          AND redundant.indoption = retained.indoption
          AND redundant.indexprs::text IS NOT DISTINCT FROM retained.indexprs::text
          AND redundant.indpred::text IS NOT DISTINCT FROM retained.indpred::text
          AND regexp_replace(
            (SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = candidate.redundant_name),
            '^CREATE (UNIQUE )?INDEX [^ ]+ ', 'CREATE INDEX '
          ) = regexp_replace(
            (SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = candidate.retained_name),
            '^CREATE (UNIQUE )?INDEX [^ ]+ ', 'CREATE INDEX '
          )
      ) THEN
        RAISE EXCEPTION 'MS-35 index proof failed for % against %',
          candidate.redundant_name, candidate.retained_name;
      END IF;
    END IF;
  END LOOP;
END $$;

DROP INDEX CONCURRENTLY IF EXISTS public.idx_reservation_candidates_availability;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_reservation_candidates_reservation_id;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_reservations_reference_code;
