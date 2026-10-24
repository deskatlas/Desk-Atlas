-- MS-35 / SDD-C12/C20/C24 / QAD-TC35/44-46.
-- Read-only operational snapshot, not a migration. Run twice during equivalent
-- traffic and compare counter deltas by dbid, userid, queryid and toplevel.
-- Requires pg_stat_statements to already be installed and a monitoring role.
-- No query text, customer records, stat resets, EXPLAIN ANALYZE, or DDL.
BEGIN READ ONLY;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='2s';
SET LOCAL search_path=pg_catalog,extensions,public;
WITH statements AS MATERIALIZED (
 SELECT dbid,userid,queryid::text AS queryid,toplevel,calls,rows,
  round(total_exec_time::numeric,2) total_exec_ms,
  round(mean_exec_time::numeric,2) mean_exec_ms,
  shared_blks_hit,shared_blks_read,shared_blks_dirtied,shared_blks_written,
  temp_blks_read,temp_blks_written,
  round(shared_blks_read::numeric*current_setting('block_size')::numeric/1048576,2) shared_read_mb,
  round(temp_blks_written::numeric*current_setting('block_size')::numeric/1048576,2) temp_written_mb,
  coalesce((to_jsonb(s)->>'wal_bytes')::numeric,0) wal_bytes,
  CASE WHEN query ~* '(assistant|customer)_search_hybrid' THEN 'assistant_hybrid'
   WHEN query ~* '(assistant|customer)_knowledge_(availability|status)' THEN 'assistant_availability'
   WHEN query ~* 'kb_worker_command' THEN 'knowledge_worker'
   WHEN query ~* 'customer_assistant_control' THEN 'customer_request_control'
   WHEN query ~* 'admin_badge_counts' THEN 'admin_badges'
   WHEN query ~* 'reservation_candidates' THEN 'reservation_candidates'
   WHEN query ~* 'payment_attempts' THEN 'payment_attempts'
   WHEN query ~* 'audit_logs' THEN 'audit_logs'
   WHEN query ~* 'kb_chunks' THEN 'knowledge_chunks'
   WHEN query ~* 'reservations' THEN 'reservations'
   ELSE 'other' END AS query_family
 FROM pg_stat_statements s
 WHERE dbid=(SELECT oid FROM pg_database WHERE datname=current_database())
  AND calls>0 AND userid IS NOT NULL
  AND query NOT LIKE '%AS disk_io_snapshot%'
), tables AS MATERIALIZED (
 SELECT schemaname,relname,n_live_tup,n_dead_tup,n_tup_ins,n_tup_upd,n_tup_del,n_tup_hot_upd,
  seq_scan,seq_tup_read,idx_scan,last_autovacuum,last_autoanalyze,
  pg_total_relation_size(relid) total_bytes
 FROM pg_stat_user_tables
), indexes AS MATERIALIZED (
 SELECT s.schemaname,s.relname,s.indexrelname,s.idx_scan,pg_relation_size(s.indexrelid) bytes,
  i.indisunique,i.indisprimary,i.indisvalid,i.indisready,
  EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conindid=s.indexrelid) backs_constraint
 FROM pg_stat_user_indexes s JOIN pg_index i ON i.indexrelid=s.indexrelid
)
SELECT jsonb_build_object(
 'captured_at',clock_timestamp(),'database',current_database(),'server_version',current_setting('server_version'),
 'stats_reset',(SELECT stats_reset FROM pg_stat_database WHERE datname=current_database()),
 'statement_stats',(SELECT to_jsonb(info) FROM pg_stat_statements_info info),
 'settings',(SELECT jsonb_object_agg(name,setting) FROM pg_settings WHERE name IN
  ('block_size','shared_buffers','work_mem','effective_cache_size','track_io_timing','pg_stat_statements.track','max_connections','autovacuum')),
 'database_counters',(SELECT jsonb_build_object('blks_read',blks_read,'blks_hit',blks_hit,
  'temp_bytes',temp_bytes,'temp_files',temp_files,'deadlocks',deadlocks,
  'blk_read_time_ms',blk_read_time,'blk_write_time_ms',blk_write_time)
  FROM pg_stat_database WHERE datname=current_database()),
 'top_shared_reads',(SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') FROM
  (SELECT * FROM statements ORDER BY shared_blks_read DESC,total_exec_ms DESC LIMIT 25) q),
 'top_temp_writes',(SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') FROM
  (SELECT * FROM statements WHERE temp_blks_written>0 ORDER BY temp_blks_written DESC LIMIT 25) q),
 'top_calls',(SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') FROM
  (SELECT * FROM statements ORDER BY calls DESC LIMIT 25) q),
 'top_wal',(SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') FROM
  (SELECT * FROM statements WHERE wal_bytes>0 ORDER BY wal_bytes DESC LIMIT 25) q),
 'tables',(SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') FROM
  (SELECT * FROM tables ORDER BY total_bytes DESC LIMIT 40) t),
 'indexes',(SELECT coalesce(jsonb_agg(to_jsonb(i)),'[]') FROM
  (SELECT * FROM indexes ORDER BY bytes DESC LIMIT 80) i),
 'connections',(SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]') FROM
  (SELECT state,wait_event_type,wait_event,count(*) connections FROM pg_stat_activity
   WHERE datname=current_database() AND pid<>pg_backend_pid()
   GROUP BY state,wait_event_type,wait_event) c),
 'blocked_sessions',(SELECT coalesce(jsonb_agg(to_jsonb(b)),'[]') FROM
  (SELECT pid,wait_event_type,wait_event,pg_blocking_pids(pid) blocking_pids,
    extract(epoch FROM clock_timestamp()-xact_start)::bigint transaction_age_seconds
   FROM pg_stat_activity WHERE datname=current_database() AND cardinality(pg_blocking_pids(pid))>0) b)
) AS disk_io_snapshot;
ROLLBACK;
