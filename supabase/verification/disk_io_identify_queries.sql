-- MS-35 / PRD-F15 / SDD-C12: identify statements from the supplied workload window.
-- Read-only diagnostics. Does not execute the statements being inspected.
-- Output includes representative SQL; review for sensitive literals before sharing.
BEGIN READ ONLY;
SET LOCAL statement_timeout='15s';
SET LOCAL search_path=pg_catalog,extensions,public;
SELECT s.queryid::text AS queryid,
       r.rolname AS database_role,
       s.toplevel,
       s.calls,
       round(s.total_exec_time::numeric,2) AS cumulative_exec_ms,
       s.shared_blks_read,
       s.shared_blks_hit,
       s.temp_blks_written,
       s.query AS representative_sql
FROM pg_stat_statements s
LEFT JOIN pg_roles r ON r.oid=s.userid
WHERE s.dbid=(SELECT oid FROM pg_database WHERE datname=current_database())
  AND s.queryid IN (
    -3076875962393720596::bigint,
    2056498871200108277::bigint,
    -508585026218409098::bigint,
    -7821780334453251234::bigint,
    6393864278139404589::bigint
  )
ORDER BY s.temp_blks_written DESC,s.total_exec_time DESC;
ROLLBACK;
