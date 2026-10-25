# MS-83 paid candidate exhaustion recovery

October 26, 2026. Local implementation of PRD-F6/F14, SDD-C3/C5/C11,
DSD-UI1/UI6, ERD-E6/E7/E11/E13 and QAD-TC1/2/7/10/12/14/23/24.

Paid, unassigned candidate exhaustion now creates a durable recovery episode and
one notification outbox event in the payment transaction. Verified tracking offers
Reschedule, Reposition and Refund. These commands preserve identity, reference,
paid amount and voluntary reschedule count. Ordinary rescheduling and in-session
relocation retain their existing routes and guards.

## Contracts

| Boundary | Implementation |
| --- | --- |
| Eligibility | Migration 042 captures approved payment plus the allocation transition with no assignment or closure impact. Legacy backfill additionally requires persisted candidate-exhaustion audit evidence. Original candidates, Main interval and template are snapshotted. Missing/inconsistent facts remain support-only. |
| Guest access | `/api/track/recovery` requires reference and registered email for both reads and mutations. SQL compares the complete normalized email exactly. Commands bind the episode to that same reservation. No account or Customer ID is required. Same-origin JSON, strict field validation and existing shared IP/email abuse counters apply. |
| Recovery | One service-role-only RPC locks payments, reservation and episode; rechecks paid state, template, exact duration, published active workspace, floors, operating hours, blocks and horizons; then commits one explicit assignment and confirmation. Existing exclusion and deferred integrity constraints remain active. There is no REST fallback or automatic additional candidate. |
| History | Original candidates remain in the episode snapshot and recovery audit. The explicitly selected existing candidate is reused when possible; otherwise Main becomes the new assignment. Unassigned alternatives are retained and never evaluated as implicit fallbacks. |
| Access pass | A fresh opaque random token and SHA-256 hash are created within successful confirmation. The existing booking access service controls validity against committed state and interval. No pass is created for unresolved bookings or refunds. |
| Refund | Atomically commits `CANCELLED` and approved payment `refund_status=REQUIRED`, clears booking access and adds customer attribution to audit metadata. Payment evidence is preserved. Existing refund-eligible administrator filters apply. No disbursement or `REFUNDED` transition is performed. |
| Notification | The existing outbox worker handles `PAID_CANDIDATE_EXHAUSTED`, including failures/retries. Episode identity is the dedupe key and provider idempotency key. Direct manual-resolution dispatches were removed from all four HTTP payment callers. Recovery confirmation uses the existing booking-confirmed identity/outbox producer with an enriched immutable payload. Webhook failures are no longer reported as successful delivery for these templates. |
| Map | ReservationPage and recovery share ReservationMap, including geometry, structures, floors, zoom, status colors and desk controls. Recovery overlays interval availability, disables other templates and offers an accessible desk selector plus the same details modal. It skips identity entry and new payment. |
| Interrupted result | No automatic mutation replay. The UI reads authoritative recovery state after a failed response; if this read also fails it blocks another mutation until tracking is refreshed. |

The current database has no reservation/candidate rate-type column. Recovery
therefore preserves exact persisted elapsed duration and conservatively preserves
configured day/night pass clock windows when the original interval matches them.
It never fabricates a historical rate type or reprices from today's catalog.

## Verification

`pnpm test:ms83` runs behavioral schema, domain, HTTP and delivery tests. The
disposable PostgreSQL suite runs with `pnpm test:ms83:postgres`, using the existing
local PostgreSQL fixture convention and synthetic identities only. It never reads
application database configuration or changes hosted data.

| Acceptance area | Local evidence |
| --- | --- |
| TC01 | Real payment allocation RPC still picks the first available submitted rank. Actual exhaustion creates recovery without a booking token. |
| TC02 | HTML/text remedies and tracking CTA; one outbox identity, provider key retained through failed send/retry; rejected webhook is a failure. Real received email remains pending. |
| TC03/08 | Missing email, forged economic/state fields, wrong owner, mismatched episode, cross-origin request, shared rate exhaustion and non-service database roles are rejected. |
| TC04/06 | Real SQL preserves exact duration, amount and ordinary allowance; a past original interval rejects Reposition and accepts future service-recovery rescheduling. |
| TC05/12 | Synthetic loopback browser fixture verifies tracking, shared map, details review, explicit replacement confirmation and status refresh. The final 390px browser check verifies contained map scrolling, Already paid details, locked Reschedule duration/derived end, explicit Refund confirmation and truthful pending-refund tracking. The fixture never forwards API calls to a database. Full hosted journeys and failure combinations remain staging acceptance. |
| TC07/10 | Real concurrent recovery submissions and recovery/refund contention, exclusion conflict, injected audit failures for both assignment and refund, and transaction rollback are tested. Broader deployed administrator/customer contention remains staging acceptance. |
| TC09 | Real cancellation, pending refund obligation, repeat safety and absent refund-completion metadata are tested. |
| TC11 | Real opaque token/hash issuance, immutable confirmation payload, assignment and status are tested; focused ordinary reschedule/payment/map regressions pass. |

Final local checks:

- `pnpm typecheck`: passed across all workspace projects.
- `pnpm lint`: passed, with zero failures in the configured boundary checks.
- `pnpm build`: passed for all four Next.js apps.
- Focused behavioral and regression run: 65 tests passed across eight files,
  including MS-83, ordinary rescheduling, booking access, relocation and shared map checks.
- `pnpm test:ms83`: 12 focused schema/domain/route/email/access tests passed.
- `pnpm test:ms83:postgres`: passed, including reversible empty-schema migration,
  retained-history rollback rejection and injected transaction failures.
- Full `pnpm test` run: 2,624 passed, four failed, one expected failure and 43 skipped.
  The four failures are survey email expectations (MF-71/MF-78), payment queue copy
  (MF-79), and DrawSQL parity (MS-35). The affected survey renderer and SQL schema
  sources are unchanged from HEAD. The final access-end-boundary test was added
  after that full run and passes in the subsequent 65-test focused run.
- Browser: desktop tracking/map/details/recovery refresh, then final 390px map,
  paid details, Reschedule review and Refund-to-pending cancellation verified with
  synthetic API fixtures. This is presentation evidence, not hosted delivery proof.
- `git diff --check`: passed.

The map extraction source tests now inspect ReservationMap. The manual-resolution
email test expects the truthful Original Template label. Raw local check logs are
preserved in ignored `docs/verification/ms83/`. Documentation under `docs/` is
already ignored by repository policy; this tracked record retains the implementation
and deployment contract independently.

## Deployment and rollback

1. Reconcile actual installed schema and forward migrations through 041. Migration
   042 requires the customer identity/outbox foundation and the current allocation
   functions. Do not run consolidated schema/reset files against an existing database.
2. Drain payment approval and recovery traffic during the coordinated cutover.
   Install compatible outbox workers and all four payment callers, apply the
   reviewed `042_paid_candidate_recovery.sql`, then reopen traffic. This avoids
   overlapping old direct email dispatch with new durable events.
3. Configure `REWARDS_RATE_LIMIT_SECRET`, the existing ingress-overwritten
   `CUSTOMER_ASSISTANT_TRUSTED_IP_HEADER`, transactional sender credentials and
   `TRACKING_BASE_URL` or `DESKATLAS_PUBLIC_APP_URL`. The existing rewards outbox
   worker must run. `BOOKING_ACCESS_BASE_URL` is optional; its default is the
   customer origin followed by `/api/booking`. Require webhook consumers to honor
   the supplied idempotency identity.
4. Verify actual PostgREST execution, guest email-to-tracking access, published
   multi-floor availability, administrator refund queue visibility, received mail,
   browser refresh/reopen and deployed administrator/customer races in staging.
   Local synthetic UI/API tests are separate from these gates.
5. On application rollback, keep compatible outbox readers and the schema while
   paid recovery history or jobs exist. The paired down migration refuses to erase
   that history. An empty schema can be reversed and re-applied in the disposable
   database test. Never blindly replay a timed-out mutation.

No hosted schema application, live email delivery, refund disbursement or deployment
has been performed as part of this implementation.
