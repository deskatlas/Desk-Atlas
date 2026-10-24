# DeskAtlas database workload map

October 24, 2026. Scope: small query changes with existing application behavior.
Traceability: MS-35, PRD-F1/F2/F6/F9/F13/F15/F26/F27, SDD-C2/C5/C7/C12/C20-C24,
ERD-E6/E7/E10/E11/E13/E14/E24-E29, QAD-TC2/7/14/35/44-46/48.

## Evidence boundary

Implementation follow-up: [query optimization changes](QUERY-OPTIMIZATION-IMPLEMENTATION.md)
records the next local batch, including measured fixture request budgets,
migrations 039/040, preserved contracts and explicit remaining scope. The table
below records the original findings; read the implementation record for status.

The implementation paths and polling rates below are verified from source.
Production query statistics, installed function definitions, compute size,
table sizes, cache behavior and disk metrics have not been collected. Priorities
are investigation priorities, not measured percentages of production disk usage.
Migrations 037 and 038 and the earlier application changes are local and must not
be assumed deployed. This follow-up preserves that work on dev.

## Query families and callers

Frequencies are per mounted, eligible browser tab or active request, excluding
initial loads, focus refreshes and events. A REST request is not a disk operation.

| ID | Caller and query family | Frequency / amplification | Existing work and risk | Smallest next change |
|---|---|---|---|---|
| Q01 | Dashboard and notification activity: `listOperationalActivity` | Dashboard load; notifications every 60 seconds; also staff activity requests | Fetches audit rows, then `loadOperationalReservation` for every event. Each event loads reservation, candidates, workspace/template/floor, history and payments. Repeated events for the same booking repeat the work. | Batch the required reservation summaries and metadata; retain actor, re-entry, reschedule and event ordering semantics. |
| Q02 | Urgent payment alerts: `listPaymentReviewQueue` | Every 30 seconds, even outside the payment screen; reviews also load on demand | One attempts query plus up to five metadata requests per review. With N valid reviews, typical maximum is `1 + 5N` REST requests per invocation. At N=20, that is about 101 per poll or 12,120 per hour per eligible tab. This is a call-count illustration, not measured disk traffic. | Hydrate queues in batches or a narrow join; do not alter canonical FIFO rank, refund state or allocation. |
| Q03 | Admin reservation list: `listAdminReservations` | Every 30 seconds on the reservation screen | Reads newest 500 full reservations, candidates and payment history in batches of 60, plus four catalog tables. Filtering and search happen afterward in TypeScript. At 500 rows, approximately `1 + 2*ceil(500/60) + 4 = 23` requests before closure work. | Push supported filters/projection and pagination into SQL after parity tests for status presentation and expiration. Do not silently replace the existing list contract. |
| Q04 | Occupancy and near-checkout: `listOccupancy`, `listOperationalReservations` | Map 20 seconds; kiosk occupancy 25 seconds; near-checkout 30 seconds; dashboard occupancy 60 seconds | Up to 200 reservations are fully hydrated before filtering booking windows. Candidates, payment history, relocation audits and catalog are loaded even for views needing a small occupancy or time summary. | Narrow reader returning the existing occupancy DTO and scoped window. Keep existing live checks and candidate priority. |
| Q05 | Report payments: `listReportPaymentAttempts` | Dashboard, notifications every 60 seconds and report requests | Existing code reads 500 full attempts, reservation metadata without an ID filter and all payment methods. It does the related reads even with zero attempts. PostgREST can also truncate the unfiltered reservation lookup. | Implemented in this follow-up: fetch only distinct linked IDs in batches of 60; stop after an empty attempts result. No schema change. |
| Q06 | Full dashboard/report snapshots: `getDashboardSnapshot`, `getAdminReportsSnapshot` | Initial loads and range changes, plus report-backed notification polling | Dashboard composes five readers in parallel. Reports filter dates after loading capped rows. More indexes cannot fix filtering that never reaches SQL; raising limits alone increases work. | Pass date bounds to narrow aggregate readers while preserving timezones, booking-date versus creation-date meaning, trend periods and report exports. |
| Q07 | Availability: `listTemplateAvailability`, `listBlockingReservations` | Booking searches, calendars and spot comparisons | For each bookable instance, reads schedule blocks and both assigned and pending reservation candidates. Work grows with workspace count. Existing assigned-workspace/time index is already present. | Batch instance IDs within the requested window. Prove live freshness and overlap semantics before replacing readers. |
| Q08 | Customer request control: `customer_assistant_control('check')` | Four checks per second while `CustomerRequestControl.run` is active, plus boundary checks | SQL uses `SELECT ... FOR UPDATE` even for check/progress. A 30-second operation can trigger about 120 extra RPCs. Tuple locking can contribute write activity and contention; measure WAL and locks, not just SELECT counts. | Consider a nonlocking read branch for check/progress; retain locks for mutations and explicit final cancellation/lease checks. Test cancellation, expiry and concurrent stages first. |
| Q09 | Assistant retrieval and evidence validation | Per chat question, query variant and evidence expansion | Hybrid ranking verifies documents and materializes vectors/text-search state. Up to four variants scan eligible chunks. Full content integrity checks occur in availability, retrieval and evidence readers. Customer readers add version verification. Exact search remains corpus-dependent after migration 038. | Measure temporary writes and nested SQL. Defer payloads as 038 does; reduce repeated verification only with a version/generation/epoch-bound contract. Do not introduce approximate retrieval without separate recall evidence. |
| Q10 | Knowledge worker claims | Two idle lanes; previously about two calls/second per worker | Eligible-job search runs with no uploads. Job tables grow with historical work. Existing status/next-attempt and running-lease indexes already exist. | Earlier local worker backoff caps idle waits at ten seconds. Validate claim plans with real job history before adding indexes. |
| Q11 | Closure alert and list reconciliation | Closure banners every 30 seconds; additional reads from list/detail screens | Some GET/list loaders issue fire-and-forget reservation PATCHes to clear orphaned closure flags. Concurrent polls can repeat a write before an earlier write commits. Updates trigger updated-at/assignment validation and Realtime/WAL work. | Move reconciliation to the existing closure mutation boundary or use a guarded idempotent update after dedicated closure tests. Read paths should eventually be pure. |
| Q12 | Audit log search: `listActivityLogs` | On-demand, paginated | Exact count, offset pagination and leading-wildcard action search. End-date filter currently overwrites the start-date filter in URLSearchParams, potentially widening the read and changing date semantics. Existing action/created and entity/id/created indexes are not missing. | Fix the two-bound predicate with explicit contract tests; assess counts and deep offsets before changing pagination or adding trigram indexes. |
| Q13 | Promo analytics data loaders | Every 60 seconds on analytics screen | Loads paginated source rows from reservations, candidates and reference tables, then calculates analytics in the application. Pagination bounds response size per request, not total workload. | Push the requested date range and eligible reservation IDs into the loader after analytics parity tests. |

## Source navigation

- Q01-Q06 and Q11: `packages/domain/src/services/reservationSupabaseRepository.ts`,
  methods `listOperationalActivity`, `loadOperationalReservation`,
  `listPaymentReviewQueue`, `loadPaymentReview`, `listAdminReservations`,
  `listOccupancy`, `listReportReservations`, `listReportPaymentAttempts`,
  `getClosureAlerts`.
- Composition: `packages/domain/src/services/adminDashboardService.ts`,
  `adminNotificationService.ts`, `reportsService.ts`.
- Q07: `packages/domain/src/services/availabilityService.ts` and
  `availabilitySupabaseRepository.ts`.
- Q08: `packages/server/src/assistant.ts`, `CustomerRequestControl.run`, and
  `supabase/migrations/032_ms76_customer_rag_foundations.sql`,
  `customer_assistant_control`; migration 033 wraps this implementation.
- Q09: migrations 023, 025, 028, 032 and 038; both assistant gateway readers.
- Q10: `services/rag/knowledge/worker.py` and the installed
  `kb_worker_command` wrapper chain beginning in migrations 016/021.
- Q12: `packages/domain/src/services/activityLogSupabaseRepository.ts`.
- Q13: `packages/domain/src/services/promoAnalyticsSupabaseRepository.ts`.

## Database structure and write amplification

The baseline already includes candidate/reservation lookup indexes, partial
assigned-window indexes, payment status/time indexes, payment reservation/attempt
indexes, audit indexes, GiST overlap protection, RLS and update/validation triggers.
Check the live catalog before concluding that an index is absent.

Migrations 015 and 016 declare two differently named unique partial indexes on
published knowledge versions. Map-element indexes on `(map_version_id,z_index)`
and `(map_version_id,z_index,id)` also overlap. These are catalog/workload review
items, not authorization to drop constraints or indexes. Check validity, backing
constraints, predicates, uniqueness and usage over a representative interval.

Updates and row locks can create WAL; maintenance also needs I/O. Review dead
tuple estimates, autovacuum timestamps and table/index/TOAST footprint before
blaming disk size. Dead tuples are not a direct bloat measurement. Zero index
scans since a reset does not prove an index is unnecessary.

There is a separate correctness finding in Q07: the repository returns pending
candidates and the slot-conflict predicate treats returned windows as conflicts.
That appears inconsistent with the No-Hold invariant. It is not removed as a
performance shortcut in this change; trace every caller and add No-Hold
regressions before reconciling it.

## Measurements to obtain next

Run `supabase/verification/disk_io_workload_snapshot.sql` with an existing
monitoring-capable PostgreSQL connection. It is a read-only operational script,
not a migration. It neither resets statistics nor runs expensive application
queries. It returns one JSON row and omits SQL text and customer records.

Capture two snapshots over the same representative 10-15 minute traffic window.
The connection must be able to read existing pg_stat_statements and monitoring
views; the script does not install extensions or grant permissions. With psql,
use an existing secure connection configuration and `-X -v ON_ERROR_STOP=1 -At -f
supabase/verification/disk_io_workload_snapshot.sql`. Export the SELECT JSON row.

For each query key `(dbid,userid,queryid,toplevel)`, calculate counter differences:

1. Delta calls divided by elapsed seconds gives request rate.
2. Delta shared blocks read estimates reads outside PostgreSQL shared buffers.
   The OS may still serve those reads from cache; these are not physical device
   IOPS and do not directly equal Supabase disk I/O billing or burst consumption.
3. Delta temporary blocks written identifies sort/hash/materialization spills.
4. Delta WAL bytes and dirtied blocks help identify write-heavy paths and row
   locking. Shared writes attributed to a statement are not all later checkpoint
   or background-writer I/O.
5. Delta total execution time divided by delta calls gives interval mean latency;
   do not subtract cumulative mean values. Output rows are not rows scanned.

Discard comparisons crossing database/statement stat resets, counter decreases,
deallocation of entries, or changed installed function/query identities. Query IDs
can change across major versions; group by family only for orientation.
Do not add top-level and nested statement counters together as if they were
independent device work; nested execution can also be included by its caller.

If pg_stat_statements.track is `top`, an RPC wrapper can hide its expensive
nested statements. Record that limitation. A deliberate separate monitoring
change to `all` may be useful, but this script does not alter database settings.
Zero read timing can mean track_io_timing is disabled, not zero I/O.

Correlate those deltas with Supabase disk I/O balance, IOPS/throughput, RAM, swap,
connections and workload timestamps. PostgreSQL cannot report host swap from
these views. If database blocks and temporary writes stay low while device I/O
is high, investigate memory swapping, WAL/checkpoints, backups and maintenance.

Use plain EXPLAIN first on the highest-impact SELECTs. Run EXPLAIN ANALYZE only
on bounded read-only queries in staging or a controlled representative workload.
Never EXPLAIN ANALYZE allocation, payment, worker or state-control RPCs against
production: it executes the function and can mutate data.

## Optimization sequence

1. Deploy and measure the already prepared 037/038 changes separately from this
   follow-up, so their effects remain attributable.
2. Ship Q05's bounded payment-report lookups after current checks. Public method
   signatures, 500-attempt limit, status rules, sorting and report shape remain.
   Missing reservation/method fallback behavior is retained. Large reports use
   more small ID batches in exchange for avoiding unrelated table rows.
3. Use live measurements to choose between Q01 activity hydration, Q02 queue
   hydration and Q03/Q04 live list/occupancy readers. These are the strongest
   remaining code-level amplification findings.
4. Address Q08 read locks and Q11 GET-triggered writes under explicit concurrency
   and cancellation/closure regressions.
5. Add or remove an index only with live catalog proof and a representative
   EXPLAIN plan. Never cache inventory, weaken RLS, skip audits, remove integrity
   verification or change allocation priority to achieve an apparent speedup.

## Verification commands

- `pnpm exec vitest run tests/ms35-payment-report-query-budget.test.ts tests/ms30-admin-dashboard-metrics-parity.test.ts tests/mf50-admin-notifications.test.ts tests/mf63-kiosk-cash-payment-method.test.ts`
- `python tests/disk-io-snapshot-postgres.py`
- Repository gates: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.

The payment-report query-budget test failed three cases before the change
(unfiltered metadata reads, empty-report reads, unbounded related-ID batches),
then passed with the existing dashboard, notification and kiosk cash tests.

Local results: 20 focused TypeScript tests passed; the profiler passed against
a disposable PostgreSQL instance with real pg_stat_statements. Typecheck, lint
and production builds passed. Full suite: 2,533 passed, 43 skipped, four unchanged
failures in the previously documented DrawSQL, payment queue sorting and survey
email tests. No production statistics were collected and nothing was deployed.

## Counter interpretation references

- [Supabase: inspect database performance](https://supabase.com/docs/guides/observability/inspect)
- [Supabase: pg_stat_statements](https://supabase.com/docs/guides/database/extensions/pg_stat_statements)
- [PostgreSQL 16: statement counters and nested statement tracking](https://www.postgresql.org/docs/16/pgstatstatements.html)
