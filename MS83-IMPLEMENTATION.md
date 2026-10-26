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

## Notification scheduling completion (October 26, 2026)

The subsequent maintainer request to complete delivery authorizes configuring the
existing admin production worker. The production queue was inspected read-only:
exhaustion jobs were PENDING with zero attempts. Sender credentials and the manual
worker secret existed, but no schedule was registered. Vercel's automatic cron
credential is `CRON_SECRET`, which the old route did not accept.

`apps/admin-portal/vercel.json` now schedules the existing worker every minute.
This requires Vercel Pro/Enterprise, confirmed for the connected admin project.
The route accepts `CRON_SECRET` for Vercel GET invocations and retains the independent
`REWARDS_WORKER_SECRET` for manual POST callers. Missing/wrong credentials fail
before queue access. Responses are uncached and unexpected failures expose no
provider, recipient or credential details. The outbox batch is ten jobs with a
120-second lease and a 60-second function budget, preserving leased retries and
provider idempotency. No customer project cron is registered.

Production configuration: set `CRON_SECRET` on the admin Vercel project, deploy
from the repository root with the linked project's Root Directory set to
`apps/admin-portal`, and retain sender/database/customer URL configuration.
Vercel automatically supplies `Authorization: Bearer <CRON_SECRET>` on scheduled
requests; no custom header configuration is needed. Manual callers continue to
use `REWARDS_WORKER_SECRET`. Never publish either secret to browser code.

Regression command: `pnpm test:ms83` includes the worker schedule/authentication
suite. Its initial run reproduced a missing cron file and HTTP 401 for the Vercel
credential; the fixed run passes all 17 MS-83 tests. Required monorepo checks and
actual deployment/queue observations are recorded in the completion result.

References: [Vercel cron authentication](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
and [plan scheduling limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

Local scheduling completion checks: `pnpm typecheck`, `pnpm lint` and `pnpm build`
passed. `pnpm test:ms83` passed 17 tests. The full suite reported 2,650 passing,
four failing, one expected failure and 43 skipped tests. The failures remain
MF-71/MF-78 survey expectations, MF-79 queue copy and MS-35 DrawSQL parity.
The CLI source bundle now excludes private Python runtime/artifact folders through
`.vercelignore`; this is separate from Git ignore behavior.

Production rollout: configured encrypted admin Production CRON_SECRET using the
connected Vercel account and deployed dpl_6Qt97F9fvWDVHarL31Vz1oGAzhGy to
https://admin.thedeskatlas.com. Vercel reports READY and registers the every-minute
worker definition on that deployment. Unauthenticated production invocation returns
401. The first workspace upload exceeded the CLI file count limit; the final
deployment used a clean 1,823-file source snapshot with archive mode.

Production acceptance: Vercel's scheduled invocation claimed all six pending
PAID_CANDIDATE_EXHAUSTED jobs. All six reached SENT after one attempt with no
recorded delivery error at 2026-10-25T18:22:40.843Z (October 26, 02:22 client time).
No manual bulk replay was performed. The actual cron registration and automatic
queue processing are now verified against production. SENT records provider
acceptance; recipient inbox placement is a separate provider event.

Read-only Resend verification after the scheduled run reports `last_event=delivered`
for the two newest exhaustion notifications, including the previously inspected
zero-attempt booking. This confirms provider-reported delivery beyond outbox SENT.

## Email CTA prefill amendment (October 26, 2026)

The maintainer requested that the email CTA prefill the registered email as well
as the booking reference and authorized another production deployment. The existing
tracking page already reads the `email` query parameter and submits reference/email
together. `buildReservationTrackingUrl` now accepts an optional recipient email,
normalizes and percent-encodes it, and the exhaustion/recovery-confirmation outbox
callers supply the persisted recipient. HTML escapes the query separator; text
preserves the working URL. This is prefill only, not an access token or mutation.
Tests exercise plus-address encoding, unchanged reference-only callers and the
actual rendered HTML/text produced through outbox retry. All 18 focused MS-83
tests pass. Already delivered messages retain their original links. No resend
or duplicate notification was requested or performed. Interactive browser checking
was unavailable because browser use is disabled in Work settings for this turn.

Email prefill deployed successfully to admin.thedeskatlas.com as
`dpl_5w1DTCspQMAGzggjcXWY8NdPAkxW` (READY). The active every-minute cron
remains registered on the new release. Typecheck, lint and all app builds passed.
All 18 MS-83 tests passed. The full suite reported 2,651 passing tests and the
same four existing failures (MF-71/MF-78, MF-79 and MS-35), with one expected
failure and 43 skipped. No live email was resent for this prefill change.

## Reservation-style rescheduling amendment (October 26, 2026)

The maintainer requested reservation-style clickable date/time selection in both
ordinary rescheduling and paid manual-resolution recovery. Both now reuse
ScheduleCalendarStep and its extracted ReservationTimeSlots presentation. Recovery
selects a desk of the original template on the shared map, chooses a day/time in
the reservation calendar, reviews the exact locked interval, then explicitly
confirms through the existing atomic recovery RPC. No guest/payment steps or
current price changes are introduced. The original duration is displayed as locked
and rate/package editing is hidden. Reposition retains its original interval.

Ordinary rescheduling loads the actual assigned workspace from published maps,
reuses the same calendar and time cards, and loads times from the protected
reschedule-availability route. That existing route excludes this reservation's
assignment when checking conflicts. Cutoff, single-use and advance-horizon rules
remain on existing server routes. A fresh availability check precedes review and
the original POST confirms the selected exact interval. Missing persisted schedule
or published workspace facts produce a support state rather than invented facts.

The shared time-card tests render real React markup, verify available-only buttons,
selected state, overnight end display, calendar navigation, exact duration and no
price/dropdown in reschedule mode. Ordinary reservation tier controls remain
covered. Tests resolve application aliases against the importing app so the real
shared presentation can be exercised without introducing a UI test dependency.

Reschedule UI verification: the final focused run passed 54 tests across seven
files. Typecheck, lint and the monorepo production build passed. The customer app
was built again after the final disabled-state and loading-state refinements and
passed. The full suite reported 2,654 passing tests, four existing failures
(MF-71/MF-78 survey expectations, MF-79 queue copy, MS-35 DrawSQL parity), one
expected failure and 43 skipped. Interactive browser use remains disabled in
Work settings; real React markup and domain regressions were tested locally.
The customer project deployment is separate from the admin scheduler deployment.

Customer scheduling UI deployed READY as `dpl_5ZPAbeWGFx91nMg4Uhv5Rn3efmX5`
and aliased to https://www.thedeskatlas.com. The public tracking page returns 200
and its served JavaScript includes the new locked-duration, Cancel reschedule
and Review reschedule controls. This is HTTP deployment evidence; it is not a
claim of an interactive live booking mutation. No booking was changed during QA.

## Unified recovery CTA amendment (October 26, 2026)

The maintainer requested combining the separate Reschedule and Reposition customer
actions. Tracking now presents one primary action, **Choose a new desk or time**,
with a separate **Request a refund** action. Supporting copy explains that the
customer may keep the original time or choose another available slot while keeping
the workspace type, duration and payment unchanged. The unified dialog groups the
booking-time preference inside the same map/calendar/review flow. Original-time
availability, past-start guards, atomic commands and audit classifications are
retained. Public buttons no longer expose the internal Reschedule/Reposition terms.

The exhaustion email uses the same unified CTA and two-option explanation in both
HTML and plain text. Already sent emails remain unchanged and no resend is made.
The maintainer amendment supersedes MS-83's original requirement to display three
separate remedies; it does not change allocation, payment or refund invariants.

Unified recovery validation: all 21 focused MS-83 tests passed. Monorepo typecheck,
lint and all four production builds passed. The full-suite run retains the four
known failures in MF-71/MF-78, MF-79 and MS-35. The primary CTA and helper copy
are aligned with the exhaustion email; no schema or business-policy change is
required. Original-time recovery remains governed by original-window checks, and
choosing a different slot retains the existing reschedule command.

Unified recovery deployed READY on both production projects: customer
`dpl_FXEfPLPW28qqTSdc1FxsAU8W3shW` at www.thedeskatlas.com and admin
`dpl_3iVqSoZipBszoFb5RJXdZDhExL3Z` at admin.thedeskatlas.com. The public
tracking page returns 200 and serves the unified CTA, original-time choice and
confirmation copy. The admin project retains its active every-minute cron on
the new release. The full suite finished with 2,654 passes and the same four
existing failures, one expected failure and 43 skipped. No email was resent and
no booking was changed during verification.

## Same-desk selection correction (October 26, 2026)

The maintainer clarified that an occupied original interval must disable that
time, not the physical desk. A regression reproduced the issue in the actual
recovery map selection predicate: original-time preference coupled desk selection
to interval availability. Recovery now keeps every active, published desk of the
original workspace type selectable in either time preference. Choosing a desk
whose original interval is unavailable opens its shared scheduling calendar.
Maintenance, inactive desks and other workspace types remain unavailable.

Reschedule time cards display reservation-conflicting slots as disabled and retain
selectable free slots on that same desk. Selection, review and SQL confirmation
still reject overlaps. The original-time command remains available only for a
free original interval. Loading original availability never produces a claim that
a time is taken; the calendar performs its own interval availability query.

Tests reproduce the previously disabled same desk, check maintenance/template
restrictions, verify occupied-time button disabling, and exercise real PostgreSQL
recovery on the same original desk at a new time while rejecting the taken time.

Same-desk validation passed: 25 focused tests, real PostgreSQL acceptance,
`pnpm typecheck`, `pnpm lint`, `pnpm build`, and `git diff --check`. The full
suite completed with 2,658 passing tests and the same four existing failures
(MF71/MF78 survey copy, MF79 admin payment notice, MS35 DrawSQL parity), one
expected failure and 43 skipped.

Customer production deployment `dpl_9BbAUip8SHTa7bhtUH5W9iWZtc5i` is READY at
https://www.thedeskatlas.com. Public `/track` returns 200 and its served JavaScript
includes the same-desk calendar guidance and desk-selection copy. Interactive
browser QA remains unavailable in this Work session. Verification did not change
a live booking or resend email. No admin deployment or database migration was
needed for this correction.

## Available times only (October 26, 2026)

The maintainer clarified PRD-F14 / MS83-R03/R04: both reschedule flows must
match reservation time selection exactly. Unavailable times are now omitted
from the shared calendar and time-card component. The same active desk remains
selectable and can be booked at another available time. Removed the temporary
unavailable-card option and updated the customer guidance and rendering test.

Available-only validation: all 25 focused MS83 tests, typecheck, lint, production
build and diff whitespace checks passed. The full suite had 2,657 passes and
five failures: the same four existing failures plus an MS05 cache-header test
timeout under concurrent checks. The separate MS05 rerun passed all five tests.

Customer deployment `dpl_9h2qP26EVHmnNtAisLGwWTEorqSZ` is READY at
https://www.thedeskatlas.com. Public tracking returns 200 and serves the updated
available-time guidance with the old occupied-time guidance removed. No live
booking was changed during verification. Interactive browser QA remains
unavailable in this Work session.
