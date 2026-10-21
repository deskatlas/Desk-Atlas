# MS-78 implementation evidence
> October 21 maintainer amendment: public and verified knowledge classifications are combined into CUSTOMER. Both customer modes use this general knowledge; private booking data still requires combined-purpose verification. See [Customer knowledge](CUSTOMER-KNOWLEDGE.md) and migration 036. Earlier audience details below are historical.


Date: October 21, 2026.
Traceability: MS78-R01 through R04, PRD-F8/F24/F26, SDD-C3/C15/C20-C22,
DSD-UI13/UI16, ERD-E10/E22/E23, QAD-TC38/44/46.

## Delivered boundaries

The existing Customer ID and email form accepts a strict `access_intent`:
`REWARDS` (default) or `REWARDS_AND_ASSISTANT`. The latter maps to the explicit
combined challenge purpose after the same normalized identity comparison.
MS-76's purpose-aware customer service retains 256-bit random tokens, hashing,
15-minute absolute expiry and revocation. Rewards-only tokens receive 403 from
private assistance; missing, malformed, expired or revoked credentials receive
401. Rewards endpoints accept both purposes.

Verification now consumes the IP and normalized-email quotas atomically before
identity lookup. Successful verification does not reset these durable counters.
The old process-local lockout remains an additional UI compatibility safeguard.
Production requires the configured Supabase server connection and
`REWARDS_RATE_LIMIT_SECRET`. Protected reads consume `CUSTOMER_TOKEN` and private
queries also consume `ASSISTANT_TOKEN` (10 per ten minutes).

`CustomerAssistanceService` and its repository interface provide only owned,
bounded booking reads. Migration 034 checks customer UUID linkage first and
permits registered-email fallback only for unlinked reservations. Browser email,
reference codes and customer IDs are never lookup authority. The SQL function is
available only to `service_role`. The selector uses descending schedule/UUID
keysets, ten visible rows and an eleventh-row look-ahead. Unique selection requires
one result and no following page.

Safe model facts exclude identity, correlation IDs, references, tokens, proof
paths, payment links, notes and unrelated bookings. Exact reservation and payment
codes remain separate from the customer tracking state. Missing rules remain
UNKNOWN. Tracking and assistance share management predicates; cancellation uses
the existing MS-68 predicate. Refund progress and recommendation rationale are
explicitly unavailable because the current customer tracking projection does not
authorize those reads. No refund amount or outcome is inferred.

The verified helper re-reads current state before release, recomputes once on
change, then returns BOOKING_CHANGED without stale actions if it changes again.
It rechecks token authority at every release boundary. Deterministic fact text is
the fallback. `customer_booking_evidence.py` defines separate strict booking-fact
and document claims; both require their own exact request-local evidence handles.
Uploaded policy evidence cannot grant a booking permission.

The integrated MS-77 gateway calls `verifiedResponse.ts` inside the shared permit
and current-epoch release boundary. `verifiedKnowledge.ts` performs one bounded
embedding/search/whole-document evidence batch. It validates MS-65 proof and
source hashes, emits at most six exact policy excerpts, and rechecks each source.
Policy excerpts appear separately from deterministic current booking facts and
never grant actions. A server-normalized policy question keeps incidental
references and identity text out of private policy requests to Python. Model
prose is not emitted as a booking fact. Temporary policy failure yields the
deterministic facts plus a limitation; revoked credentials, cancellation and
publication changes still reject release.

`VerifiedReservationControls` reuses `RewardsAccessCard`, provides upcoming/history
pagination and contextual prompts, and aborts stale selector requests.
`VerifiedBookingActions` permits five known action IDs and opens the existing
tracking workflow, which retains its original verification and confirmation.
`AskReservationButton` emits only an untrusted reservation pointer from tracking
and Rewards history. The MS-77 launcher owns conversation reset, request generation,
source lifecycle, and site-wide mounting. No credentials are placed in links.

## Verification

| Check | Result |
|---|---|
| `pnpm test:ms78` | 42 tests across identity, reservations, private gateway and policy evidence |
| Final MS-78 plus SPEC-3/MS-42/MS-68/reschedule/relocation selection | 101 tests passed across nine files |
| Related MS-42/MS-68/reschedule/relocation regression selection | 53 tests passed before the final additional gateway tests |
| SPEC-3 rewards plus MS-68 and initial MS-78 selection | 38 tests passed |
| Python MS-78 evidence tests | 8 passed |
| Disposable PostgreSQL ownership/RLS/quota/rollback test | Passed; 25 concurrent connections admitted exactly ten private queries |
| `pnpm typecheck` | Passed |
| `pnpm lint` | Passed; extended coverage also includes the new private boundary |
| `pnpm build` | Final shared build passed for all four apps after MS-77 policy and lifecycle integration |
| `pnpm test` | Snapshot: 2435 passed, 43 skipped, four existing unrelated failures |

The four full-suite failures are MS-35 DrawSQL/schema parity,
MF-71 and MF-78 survey email subject expectations, and MF-79's legacy
payment-queue source assertion. They also failed in the preceding MS-76 run.
These checks do not establish hosted provider, deployed cross-replica behavior,
production corpus correctness, browser accessibility, or MS-79 acceptance.

## Rollout and remaining integration

Keep `CUSTOMER_ASSISTANT_VERIFIED_ENABLED=false` until MS-79 accepts the integrated
system. No live database, deployment, publication, model setting or activation was
changed by this work.

Apply expanded MS-76 schema and MS-77 admission migration first, then
`034_ms78_owned_customer_assistance.sql` and
`035_ms78_atomic_verification_limits.sql` before deploying producers. The rewards
rate limiter now uses the atomic RPC too. Configure a private HMAC secret and
`CUSTOMER_ASSISTANT_TRUSTED_IP_HEADER` with an ingress that overwrites that header and blocks direct bypass. This requirement applies to Rewards identity verification even while chat flags remain off. Configure the MS-77 allowed origins before using private selector routes.

For rollback, disable entry points and drain active work first. Restore compatible
application code before rolling back the atomic-limit RPC. Migration 035 downgrade
removes only assistant quota events; existing verification/rewards and MS-77 public counters remain.
Migration 034 downgrade drops only its read function. MS-76's guarded downgrade
must handle combined challenges and customer knowledge without relabeling content.

Private query/source/progress/cancel wiring and mixed evidence emission now pass
isolated gateway tests using the real authorization and private projection path.
Test storage and inference seams are synthetic; no hosted acceptance is implied.
The launcher renders verification, selector/history controls, private actions and
separate policy excerpts. Session-token changes remount the private conversation;
absolute expiry clears the shared in-memory session. Close clears the conversation
and retains the unexpired Rewards session.

Interactive browser inspection could not run because local browser use is disabled
in Work settings. Keyboard/focus/mobile acceptance, deployed provider/corpus checks
and integrated MS-79 release acceptance remain open. All customer activation flags
remain off.
