# Database disk I/O remediation

Maintainer-authorized implementation, October 23, 2026.

Traceability: MS-35, PRD-F6/F9/F26/F27, SDD-C5/C12/C20/C21/C24,
ERD-E10/E11/E13/E24-E29, QAD-TC35/44/45/46/48.

## Behavior

1. Idle ingestion and purge workers wait 1, 2, 4, 8, then at most 10 seconds
   between empty claims. Each lane resets after a successful claim. Shutdown
   interrupts the wait; the existing five-second error delay remains. New jobs
   can wait up to approximately ten seconds plus request/processing latency.
2. The internal assistant status endpoint calls `assistant_knowledge_status`.
   This actor-scoped metadata query only controls button visibility. It does not
   certify content integrity. Actual questions continue using the unchanged full
   availability, retrieval and evidence checks. A corrupt document can leave the
   button visible while an actual question fails closed. No document content is
   exposed by status.
3. Admin badges use one authenticated `admin_badge_counts` aggregate. Counts use
   database time, latest payment attempt, assigned/main candidate priority,
   expiration and refund rules. Results are not restricted to the newest 500
   reservations. The endpoint returns no-store responses and fails closed on
   authentication, database or response-contract errors.
4. Hybrid search retains exact semantic/lexical ranking, thresholds, limits,
   permissions and integrity checks. It builds content JSON only after selecting
   each branch's top twelve IDs. The materialized versions projection omits large
   manifests. This does not introduce approximate nearest-neighbor retrieval or
   claim that the lexical GIN indexes now serve computed ranking expressions.
   Full corpus verification and exact vector scoring still have a cost.

Booking allocation, inventory availability, payment mutations and audit records
are unchanged. No new dependencies, inventory caches or automatic index drops.

## Deployment and rollback

Apply forward migrations `037_admin_badge_counts.sql` and
`038_assistant_disk_io.sql` after the existing forward migrations through 036,
before deploying the updated admin app. Never include `_down.sql` files in the
forward migration runner. No reset or historical migration changes are needed.

Migration 038 transforms the installed function bodies so the current audience
amendments survive. It aborts transactionally if the expected body markers differ.
The original hybrid functions are retained as service-inaccessible
`*_io_baseline` functions for exact rollback. It does not rewrite documents or
re-embed vectors. Both migrations take normal function-definition locks and can
wait for active transactions; deploy during a quiet period.

Deploy the worker code separately and restart its processes to enable backoff.
Restore the previous app before applying 038_down then 037_down. The down
migrations restore the exact original hybrid definitions and remove the new RPCs.
Do not drop the new RPCs while the updated app is serving requests.

## Verification

- `pnpm exec vitest run tests/ms35-disk-io-badge-counts.test.ts tests/ms45-assistant-availability.test.ts tests/ms45-assistant-lifecycle.test.ts tests/ms55-hybrid-gateway.test.ts`
- `services/rag/.venv-service/Scripts/python.exe -m pytest services/rag/tests/test_ms52.py -q`
- `python tests/disk-io-postgres.py`
- Required repository gates: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.

The SQL harness creates a disposable local database and uses the established
array vector adapter. It verifies actual SQL execution, result parity, tampering,
audiences, privileges and rollback; it does not certify production pgvector query
plans or embedding quality. It never reads application credentials.

Compare production query calls, shared blocks read, temporary blocks written,
cache hit rate, RAM/swap and disk I/O balance under equivalent traffic after
deployment. Physical disk savings depend on the working set and cache behavior;
local correctness tests cannot establish a production percentage improvement.

## Local results

- `pnpm typecheck`, `pnpm lint` and `pnpm build` passed for all workspace apps.
- Focused TypeScript verification: 54 passed across seven suites.
- Worker verification: four Python tests passed.
- Disposable PostgreSQL verification passed, including more than 500 bookings,
  exact top-12 hybrid parity with a 40-chunk fixture, content tampering, audiences,
  service-only privileges and exact function restoration after rollback.
- The full TypeScript suite reports 2,530 passed, 43 skipped and four failures in unchanged tests:
  `ms35-supabase-consolidation` (DrawSQL parity),
  `mf79-admin-payments-proof-order` (legacy payment queue sorting expectation),
  `mf78-transactional-email-refinements` and
  `mf71-transactional-email-lifecycle` (survey email expectations).
  Their tested schema diagram, payment component and email implementation were
  not modified by this repair.

No production migrations or deployments were performed.

October 24 follow-up: [database workload map](DATABASE-WORKLOAD-MAP.md) traces
13 query families and adds a read-only statistics snapshot. A narrow report
optimization now fetches only linked reservation/payment-method IDs and skips
those reads when there are no payments. No additional migration is required.

The subsequent [next optimization batch](QUERY-OPTIMIZATION-IMPLEMENTATION.md)
adds queue/feed batching, embedded list reads, live availability batches and
migrations 039/040. See that record for the complete combined deployment order
and current verification results.
