# MS-82 implementation and verification

Date: October 25, 2026. Traceability: BRD-M1/M2/M5/M6; PRD-F4/F6/F9/F13;
SDD-C2/C5/C12; ERD-E10/E11/E13/E14; QAD-TC7/10/14/23/35; MS82-TC01-TC08.

The maintainer authorized implementation after the original specification-only
plan. Existing MS-80/MS-81 working changes are retained. No hosted database,
configuration, accounts or deployment were modified. No dependency or migration
is introduced.

## Delivered behavior and scope

Inspection found no deadline on the reservation repository's shared REST boundary.
Availability's shared boundary supplied its existing 10-second timeout only when
a caller also supplied a signal. Both boundaries now use `databaseRequest` with
a 10,000 ms budget covering fetch and response body consumption. Availability
continues to combine caller/request signals. Earlier caller cancellation wins.
Timers and cancellation listeners are removed on completion or failure; deadline
expiry aborts the underlying fetch. No client/pool is created by this helper.

The allowance is exactly one attempt, zero retries and zero backoff delay.
Recovery uses the next existing caller-owned read/poll after readiness. No
automatic loop, queue, cache or extra polling is added. A transport-call deadline
is not an end-to-end route deadline: multi-query operations can take longer.
Existing outer deadlines still apply when supplied. No database statement
timeout or platform timeout is adjusted.

Connection failures, shutdown SQLSTATEs 57P01/57P03, connection-class 08 errors
and gateway 502/503/504 produce a sanitized interruption error. It retains only
kind, optional validated SQLSTATE and whether the commit outcome may be unknown.
Raw network errors, causes and gateway payloads are not attached. Permanent
SQL/schema failures and 57014 keep their existing repository error contract and
are never retried. Statement timeout and deliberate server cancellation cannot
be distinguished by SQLSTATE alone.

Every dispatched non-GET/HEAD request, including POST RPC reads, is conservatively
marked as potentially committed after a lost response. Payment approval's real
repository method is tested with an injected commit followed by response loss:
one dispatch, one simulated commit, no successful result and no blind replay.
This does not prove every multi-step workflow is atomic. Existing direct fetch
calls outside these two shared boundaries and staff-management fallbacks remain
outside this repair. Interrupted booking/payment operations require an
authoritative read through existing reservation/payment identifiers before an
operator makes another decision. If that read is unavailable, leave the outcome
unresolved for manual reconciliation. No new mutation recovery policy is added.

Closure routes recognize validated structured SQLSTATEs in content-free logs,
retain MS-80's generic non-success responses and dashboards retain
the last successful result with an unavailable indication. Failed availability
reads propagate failure; they do not substitute an empty successful inventory.
The unconditional business-settings fallback projection is removed: an outage,
schema error or cancellation now propagates after one query. Occupancy details
also propagate a failed schedule-block read instead of replacing it with an
empty block list. No changes are made to RLS, allocation order, inventory holds,
auth or QR rules.

## Incident evidence and dispositions

`python scripts/ms82-incident-summary.py <source-path>` reads an export locally
and prints only fixed incident labels, inferred codes, counts and normalized UTC
timestamps. It never prints SQL, headers, paths, users or raw messages. Matching
is exact; unrecognized records are counted without assuming they are errors.
It does not infer deployment identity, causes or recovery from generic messages.

Running against the supplied October 22 export reproduced 1,000 records and the
MS-80/MS-81 counts: 771 closure-column, two workspace-column and three staff
ambiguity events. The remaining classified events are recorded below. There
are 163 unclassified records, including successful operational/catalog events.
The exported level does not control classification.

| Class | Evidence (UTC, October 22) | Disposition and missing evidence |
|---|---|---|
| Shutdown | Request 16:57:38.196; eight terminations 16:57:38.214-16:57:38.222; 44 rejections 16:57:39.050-16:59:06.860 | Shutdown sequence established; initiator and service recovery unresolved. Need platform maintenance/deployment history and readiness after rejection. No readiness event is present in this export. |
| Client reset | Five events 14:50:22.206-18:42:21.610 | Unresolved. Need correlated request cancellation/worker lifecycle and recurrence evidence before classifying as expected or a leak. |
| Standby EOF | One event 19:43:43.691 | Unresolved. Need replication/platform health and subsequent recovery; no data loss or replication change inferred. |
| Statement timeout | One event 14:23:29.417 | Unresolved. Need query fingerprint, role, active deadline, locks, row counts, frequency and comparable plans/timings. No index or timeout tuning justified. |
| User cancellation | One event 14:32:26.936 | Unresolved. Need request IDs and client/dashboard/deadline cancellation context. Not classified as expected without evidence. |
| Successful catalog query | Specification records 11,735.107 ms at 16:55:26.488 | Separate performance observation. Need repeated comparable catalog timings/load; not attributed to the earlier timed-out statement. The summary intentionally does not export arbitrary statement text. |

Actual deployed revision and applied migrations are unknown. Local git history
and SQL files cannot establish hosted deployment. October 23-25 workload repairs
postdate this export; this record does not claim those repairs failed in service.

## Local verification

The focused suite `pnpm test:ms82` passes 84 tests with MS-81's one expected
failure. It exercises real repository seams, synthetic
failure responses, deadline/cancellation handling, and a real loopback HTTP
connection reset followed by recovery. It also includes MS-80 closure contracts,
MS-81 staff RPC regressions, MS-35 query budgets, payment and security tests.
`pnpm test:ms82:incident` checks independent cancellation classification,
unknown readiness/attribution, allowlisted output and malformed timestamps.
Local HTTP interruption is transport evidence, not a Supabase outage simulation.

`pnpm test:ms82:postgres` passes on a fresh temporary loopback cluster on port
55482. It independently reproduces statement-timeout 57014, explicit-cancel
57014 and session-termination 57P01, proves a new read succeeds after each,
then performs a fast shutdown, verifies reads fail, restarts and verifies
readiness. It never reads application database configuration and does not
modify a hosted cluster. SQL and HTTP evidence are separate; a real Supabase
PostgREST interruption exercise remains pending.

`pnpm test:ms82:incident` passes three tests. Both `pnpm test:ms80:postgres`
and `pnpm test:ms81:postgres` pass against temporary local PostgreSQL clusters,
reproducing original 42703/42702 and verifying the repairs, SQL authorization,
atomic rollback, migration guards and contract parity. These are real database
checks, not hosted PostgREST or application authorization acceptance.

`pnpm typecheck`, `pnpm lint`, `pnpm build` and `git diff --check` pass. Output
is retained under `outputs/ms82-*.log`. The final full run (`pnpm run test
--maxWorkers=4`, all configured suites) reports 2,613
passed, one expected failure, 43 skipped and four failures. These are the existing
MS-81-recorded failures: MF-71/MF-78 booking-ended email punctuation, MF-79
client sorting source expectation and MS-35 DrawSQL `overdue_notified_at`.
An earlier concurrent-build run also hit MS-05's 20-second import timeout; its
isolated rerun and the subsequent full run pass. The full suite is not reported as green.
The focused and final full results include the final deadline/cleanup and
availability failure-propagation cases. Final full output is retained in
`outputs/ms82-test-final.log`.

## Release, rollback and remaining gates

Deploy the domain package with dependent applications after reviewing the actual
hosted migration inventory and the MS-80/MS-81 release requirements. MS-82 adds
no SQL. Never use a reset, consolidated clean baseline or glob including down
files as a hosted upgrade. Rollback replaces the application/domain code only;
it must retain MS-80 query corrections, honest failure states, MS-35 workload
protections and existing booking/payment records. It performs no data rollback.

MS82-TC07 remains blocked for release by MS-81's separately documented forged
actor authorization and nontransactional fallback findings. Its expected-failure
test is evidence of an open defect, not successful security acceptance.

Still required: actual Supabase/PostgREST/Auth behavior; installed revision,
migration/function/ACL inventory; incident/request correlation; real disposable
or staging database shutdown through PostgREST; normal-role allowed/denied staff
requests after the authorization repair; and at least 30 minutes of representative
staging traffic after readiness. Record operation/request counts, SQLSTATE errors,
latency, retry attempts and comparable query volume while repeatedly exercising
closure alerts, candidates and allowed/denied staff operations. Require zero
target 42703/42702 errors. An idle log or synthetic transport test cannot satisfy
this gate. Equivalent deployed traffic is required for hosted confirmation.

MS82-TC01/05/06 remain partial where external attribution is missing. MS82-TC02
has local HTTP and disposable PostgreSQL evidence; combined PostgREST
interruption remains pending.
MS82-TC03/04/08 have focused local evidence within the boundaries described above.
No unresolved service-impacting incident is described as fixed.
