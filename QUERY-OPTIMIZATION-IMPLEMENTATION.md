# Query optimization implementation

October 24, 2026. Local changes on dev, not deployed.

Authority: maintainer request to implement the next workload reductions, under
MS-35, PRD-F1-F4/F6/F9/F13/F15/F26/F27, SDD-C2/C5/C7/C12/C20-C24,
ERD-E6/E7/E10/E11/E13/E14/E24-E29 and QAD-TC2/4/7/14/35/44-46/48.

## Implemented

| Path | Change | Contract preserved |
|---|---|---|
| Activity feeds | Fetch event projections, reservation summaries, candidates, actor profiles and workspace names in batches. Twenty-event fixture falls from 142 requests to five. | Event order, actor metadata/profile fallback, re-entry and reschedule labels, missing-booking omission. No payment/history hydration or reconciliation writes. |
| Payment queues | Hydrate reservation, candidate, instance/template/floor data once per queue in ID batches. Twenty-item fixture falls from 101 requests to six. Applied to review, rejected and refunded lists. | FIFO/tie-breaking, main/alternative rank, amounts/discounts, refunds and private detail handling. Queue response still strips proof storage fields. |
| Admin, operational and occupancy lists | Embed candidate/payment children with explicit per-parent ordering in the existing reservation read. Fall back to existing separate reads only when supplied rows lack embedded children. | Public DTOs, existing 500/200 limits, top-level ordering, expiration/status filtering, occupancy boundary semantics and relocation details. No narrower DTO or pagination API introduced. |
| Dashboard composition | Deduplicate concurrent catalog loads within one repository. Invalidation fences in-flight cache population. | Existing TTL, reference-data shape and invalidation; no new cross-request inventory cache. |
| Template availability | Read scoped blocks and assigned bookings once per batch of up to 60 instances within the search request. Page complete windows using Content-Range, with deterministic ordering, to avoid silently dropping conflicts under server row caps. | Business-wide blocks, spot isolation, overlap boundaries, lead time and multi-day/operating-hour rules. Out-of-window reads use fresh repository calls. |
| No-Hold correction | Remove the pending-payment/review candidate query from blocking availability. | Enforces PRD-F4: only assigned CONFIRMED/CHECKED_IN bookings block inventory. Atomic allocation and Main/Alt1/Alt2 priority are unchanged. |
| Customer request control | Migration 039 removes tuple locks from check/progress reads only; mutation/admission locks remain. | Owner/session/generation binding, quotas, deadlines, cancellation and final checks. Poll cadence remains 250 ms so cancellation detection is not intentionally delayed. |
| Customer knowledge readers | Migration 040 removes duplicate chunk count/hash/manifest scans after the unchanged complete kb_customer_version_valid check. | Exact search ranking/thresholds and full integrity, publication, audience and generation validation. No approximate search, verification cache or weaker evidence contract. |
| Closure cleanup | Existing read-path reconciliation PATCHes require both the observed updated_at and an active impact flag. | Existing response projection and cleanup behavior; a stale poll cannot overwrite a newer reservation/closure mutation. Reconciliation is not moved into a new job system. |
| Audit filters | Preserve both created_at bounds rather than replacing the lower bound with the upper bound. | Inclusive date bounds, exact counts, current pagination and response schema. |

Request counts above come from regression fixtures, not production I/O
measurements. Batches beyond 60 IDs add bounded calls. Payment/report and list
state is read live; request-local hydration is discarded after each operation.

## Deliberate limits

Server-side reservation pagination, date-scoped financial aggregates and promo
analytics range pushdown are not introduced in this batch. They need separate
contracts for complete totals, current/previous periods, historical exports and
the current list caps. These remain mapped in DATABASE-WORKLOAD-MAP.md; they are
not claimed complete. Existing list status filters and report calculation rules
remain in place. No speculative indexes are added or dropped.

Production query plans and actual disk I/O savings remain unmeasured. Use the
read-only workload snapshot and equivalent traffic windows after deployment.

## Deployment and rollback

Apply migrations 037, 038, 039 then 040 after the existing forward sequence
through 036, before deploying the combined application changes from this chat.
Never execute `_down.sql` files as forward migrations.

039 preserves the installed 033 wrapper and changes only the inner implementation
(also supports the unwrapped 032 installation). Check/progress are MVCC reads;
uncommitted mutations become visible only after commit. Stage/cancel/release and
claims retain their existing locking. Both new migrations save exact prior
definitions in service-inaccessible backup functions. Unexpected definitions
abort transactionally. Function replacement may wait for active transactions.

October 25 hosted compatibility repair: the supplied function export has the
same full MS76 body under both `customer_assistant_control` and
`customer_assistant_control_ms76`, rather than the expected 033 wrapper. The
original 039 correctly aborted because it found two implementations. Revised
039 accepts this duplicate case only when the bodies and argument types are
identical, updates both and retains a separate exact rollback backup for each.
It preserves the installed quota/ownership behavior and does not reconstruct a
missing wrapper. Divergent duplicate bodies still abort before replacement.
The disposable PostgreSQL regression reproduces the original error, validates
both supported layouts and checks exact restoration of both duplicate bodies.
Use the revised 039 after a failed original attempt; 040 is unchanged.

Rollback 040 then 039 to restore their prior SQL implementations. Restore the
previous application and then roll back 038/037 only if reverting the earlier
batch too. No document content, embedding vectors, bookings or payment records
are rewritten by 039/040.

## Verification

- `pnpm exec vitest run tests/ms35-query-amplification.test.ts` exercises actual
  repository calls, queue/feed budgets, actor/event fields, joined child ordering,
  in-flight sharing, No-Hold, fresh availability batches, server-capped pagination,
  guarded closure cleanup and both audit date bounds.
- Existing actor attribution tests now model batched ID lookups, keeping their
  assertions intact.
- `python tests/disk-io-postgres.py` executes forward/down migrations against
  disposable PostgreSQL. It compares exact top-12 results across audiences,
  rejects tampered content/fingerprints/manifests/counts, checks that reads do not
  wait on row locks while mutations still do, verifies cancellation, owner
  isolation and expiry, and restores exact baseline function definitions.
- The SQL harness uses the established array vector adapter, not production
  pgvector. It certifies SQL behavior and parity, not production query plans,
  semantic recall or disk savings.
- Required gates: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.

Local results: typecheck, lint and production builds passed. Focused verification
passed 82 tests (two optional checks skipped). Full suite: 2,542 passed, 43 skipped
and the same four unrelated failures in DrawSQL parity, legacy payment sorting
and survey email expectations. Disposable SQL forward/down and concurrency
checks passed. No production migrations, benchmarks or deployments were run.

Embedded child ordering follows the existing foreign keys and
[PostgREST embedded resource ordering](https://docs.postgrest.org/en/v12/references/api/resource_embedding.html).
