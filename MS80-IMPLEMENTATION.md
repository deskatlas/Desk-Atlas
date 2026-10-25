# MS-80 implementation and verification

Date: October 25, 2026. Base checkout: `98016ed`.
Traceability: BRD-M1/M2/M6; PRD-F9/F10/F12/F14; SDD-C2/C3/C10/C12;
ERD-E6/E7/E10/E11; QAD-TC20/22/24/35; MS80-TC01 through TC08.

The maintainer authorized implementation after the original specification-only
planning task. Application changes are local. No hosted database or deployment
was modified. No migration or new dependency is required.

## Delivered behavior

- Reservation closure alerts, staff lists/details, admin lists/details and guest
  tracking project metadata from business `CLOSURE` schedule blocks. Unsupported
  reservation closure reason/date columns are absent from all reads and writes.
- Valid candidate windows use all live overlapping blocks, including when a
  linked block is deleted or changed. A missing schedule uses only a surviving
  linked block for metadata and retains its impact flag. Missing reasons and
  unavailable metadata remain null. No historical reason is synthesized.
- Overlap is half open. Closure dates use `business_settings.timezone`, with
  the existing `Asia/Manila` default for an absent setting. Overnight windows
  display a date range; an exact midnight end excludes the following day.
- Successful non-overlap cleanup uses the observed `updated_at` plus active
  impact predicates. A lost update retains the visible alert. Reconciliation
  reports only rows returned by a successful guarded update and audits them.
  Missing schedules and failed prerequisite reads never resolve impacts.
- Closure list hydration remains batched. Alerts use three reads independent
  of reservation count: blocks, venue timezone and embedded reservations.
  Existing bounded list/catalog reads remain in place. Cleanup writes remain
  proportional to genuine stale impact rows.
- Candidate labels use display name, instance code, template name, then workspace
  ID. Missing relations do not fail mapping; rank ordering and times are retained.
- Alert filters use actual pending reservation enum values instead of the
  unsupported `PENDING` value. This read does not allocate or hold inventory.
- All four existing admin/staff closure routes keep their success DTO and failure
  status. Failed reads return a generic retry error; content-free server logs
  retain SQLSTATE when supplied. Dashboard polling keeps its 30-second interval,
  retains the last successful result and displays an unavailable message after
  failure. The shared closure banner labels unknown reasons honestly.
- Existing access boundaries, guest lookup filters, QR handling, payment
  confirmation and Main -> Alt 1 -> Alt 2 allocation are unchanged.

## Local verification

`pnpm test:ms80` passes 67 tests and covers normalized metadata, overnight/timezone boundaries, null
links/reasons, multiple blocks, candidate fallbacks, detail/tracking/list paths,
dependency failures, stale cleanup, route responses and established closure
lifecycle/query-budget regressions.

`pnpm test:ms80:postgres` initializes an isolated temporary PostgreSQL cluster on
loopback port 55480. It never reads application database configuration. It applies
the current baseline to one new database and the archived baseline plus original
closure migration to another. Both reproduce SQLSTATE 42703 for the original
columns and accept the repaired embedded projections compiled into real SQL.
It checks enum filters, closure FK deletion behavior, stale-update rejection and
clean/upgrade parity for the affected columns. This is PostgreSQL catalog/query
evidence, not hosted PostgREST or RLS acceptance.

Repository verification: `pnpm typecheck`, `pnpm lint` and `pnpm build` pass.
The full `pnpm test` run reports 2,578 passed, 43 skipped and four failures in
untouched code/test areas:

| Suite | Failure |
|---|---|
| `mf71-transactional-email-lifecycle` | Booking-ended email subject punctuation expectation |
| `mf78-transactional-email-refinements` | Same email subject punctuation expectation |
| `mf79-admin-payments-proof-order` | Source assertion expects client sorting code |
| `ms35-supabase-consolidation` | DrawSQL export lacks `overdue_notified_at` |

## Release and rollback

No schema forward or rollback operation is needed. Deploy the domain package
with the admin/staff applications and shared banner. A compatible rollback must
retain the corrected projection/column contract and failure visibility; restoring
the old invalid queries is unsafe. No populated metadata is dropped or backfilled.

Hosted application revision, applied migration inventory, deployed columns/FK/
function definitions, actual PostgREST requests, normal-role browser acceptance
and staging traffic without 42703 remain pending. Compare those read-only facts
with the normalized contract before release. The two disposable fixtures verify
affected contract parity, not all historical production migrations. MS-81 and
MS-82 combined operational acceptance remain separate.
