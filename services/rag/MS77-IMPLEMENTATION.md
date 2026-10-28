# MS-77 public customer assistant
> October 21 maintainer amendment: public and verified knowledge classifications are combined into CUSTOMER. Both customer modes use this general knowledge; private booking data still requires combined-purpose verification. See [Customer knowledge](CUSTOMER-KNOWLEDGE.md) and migration 036. Earlier audience details below are historical.


Authority: maintainer request to implement MS-77 on October 21, 2026, following
the completed local MS-76 handoff. Traceability: MS77-R01-R03, PRD-F1-F4/F26/F27,
SDD-C20-C24, DSD-UI16, ERD-E23-E29, QAD-TC44/46 and MS77-TC01-TC15.

## Delivered boundaries

The customer root layout mounts one in-memory assistant inside RewardsSessionProvider.
Ordinary Next.js navigation preserves the provider. The embedded discovery route and
the actual reservation screen project only explicit workspace, template, floor and
schedule fields. The spot modal opens contextual assistance and explicitly adds up to three comparison spots. Payment, QR, proof,
contact forms, URL parameters and customer profile fields are never automatically
collected. There is no transcript storage or telemetry.

Closing unmounts the conversation and cancels pending work. Reopening starts empty.
Context changes invalidate the generation. Every session-token change remounts the
conversation before rendering another customer's content. Expiry follows the existing
absolute session lifetime. Late query, progress, source and bootstrap responses check
mount, cancellation and generation before changing state or expiring a session.

All customer routes are same-origin POST/JSON with no-store responses. Body reads
are bounded to 32 KiB. Query accepts strict discovery/preferences and bounded recent
user turns. Authority comes exclusively from the signed visitor cookie or a verified
combined-purpose customer token. Supplied invalid credentials cannot become public
authority. Customer capabilities never enter internal assistant endpoints or callback
registries. No customer bearer or service-role key goes to Python.

Public retrieval, complete-document expansion, source previews and final epoch
checks use MS-76's isolated customer readers. The original MS-65 document proof,
independent model verification and mechanical source-offset checks support public
answers. Policy excerpts, typed current booking facts and typed availability/quotes
remain distinct evidence classes. Model URLs and HTML cannot become actions.
Public private-booking questions return neutral verification guidance before lookup.
MS-78's owned-booking selector and verified response adapter are integrated through
their dedicated ownership and purpose checks.

## Spot decisions

Migration 033 provides a stable-ID-ordered current public catalog query. Only active
instances/templates/floors represented on published maps enter the bounded set.
Thirteen rows detect a set exceeding twelve; larger sets require narrowing. Explicit
comparisons accept at most three IDs. Capacity and budget constraints filter before
ranking. The existing domain availability and pricing services supply schedule checks
and hourly base quotes with server time, ONLINE channel and the established 30-minute
online lead rule. Shared reference caches have zero lifetime; availability reads carry
the request cancellation signal. No reservation or inventory write is available.

Preference scoring awards one point per approved explicit match, zero for unknown or
contradictory facts, and breaks ties by workspace ID. Current extraction conservatively
requires an exact workspace UUID and an unconditional characteristic assertion in
approved knowledge. It does not infer amenities from display names or descriptions.
Ambiguous template inheritance and per-instance overrides produce an evidence gap.
This is deliberately conservative; natural-language characteristic coverage needs
independent corpus acceptance under MS-79.

At most two availability batches and one price batch run per decision. A second
catalog/availability read drops changed or unavailable options before emission;
publication epochs are checked again at release. At most three suggestions render.
View spot rechecks the published map/version through a no-store server action route
and opens the ordinary spot-detail workflow. It never assigns Main/Alt 1/Alt 2,
creates a booking or holds a spot. Checkout independently revalidates allocations.

## Admission and resource separation

Migration 033 adds atomic fixed sliding-window counters in ERD-E23: ten public attempts
per keyed trusted IP per ten minutes and thirty per signed visitor per hour. Both
commit together; neither stores raw IPs, prompts or credentials. Cookies hold only
a random signed visitor UUID for one hour, HttpOnly and SameSite=Strict, Secure in
production. Forged identities and browser session IDs grant no admission authority.
The session bootstrap avoids concurrent cookie creation between query/cancel calls.

The shared control wrapper limits both public and verified customer requests to two
in-flight permits per business, with no waiting queue. Foundation ownership,
generation, replay fencing, shared stage/cancel checks and lease expiry remain in
force. Rejections precede embedding/composition and carry Retry-After. Cancellation
and deadlines abort provider requests; lease release uses a separate short DB timeout.
Python customer request admission and inference semaphores are separate from internal
request and inference slots. MS-79 must measure actual hosted resource contention,
combined load and cross-replica HTTP behavior before activation.

## Configuration and rollout

No production migration, publication, model/provider change or activation was run.
All activation examples default to false:

- CUSTOMER_ASSISTANT_ENABLED: server gateway and Python customer routes.
- NEXT_PUBLIC_CUSTOMER_ASSISTANT_ENABLED: customer launcher build.
- CUSTOMER_ASSISTANT_VERIFIED_ENABLED and its NEXT_PUBLIC counterpart: private mode.
- CUSTOMER_ASSISTANT_ALLOWED_ORIGINS: exact comma-separated deployment origins.
- CUSTOMER_ASSISTANT_TRUSTED_IP_HEADER: an explicitly trusted single-IP ingress header.

The ingress must overwrite the configured header and prevent direct bypass. Supported
headers are x-vercel-forwarded-for, cf-connecting-ip and x-real-ip. Arbitrary forwarded
chains are rejected. Only development localhost uses a loopback fallback. Existing
RAG service URL, service token, capability key, scope and embedding fingerprint are
reused. MS-78's identity verification now also uses this trusted-IP policy, including
when customer chat flags are disabled; configure it before deploying that route.

Inventory applied migrations, then deploy 032 before 033 and the dependent 034/035
contracts. Deploy compatible gateways and Python images while flags remain disabled.
Container COPY rules, Cloud Build allowlisting and Node/Python runtime fingerprints
include the customer modules. Rollback disables entry points and drains work first.
The 033 down migration refuses live permits or unexpired public quota rows. It restores
the foundation control without dropping conversations, because none are stored.
Never remove live counters to bypass limits. The down migration retires only expired
public quota metadata after its guard confirms the complete hourly window has passed.

## Verification and remaining acceptance

Focused public contract/ranking/security and gateway tests, Python intent/capability/
characteristic tests and disposable PostgreSQL admission/catalog/RLS/rollback checks
are delivered. Shared checks and final measured totals are recorded below after the
final run. PostgreSQL tests use disposable local clusters, never application credentials.
Fixtures establish local boundary behavior; synthetic inference is not live provider
or corpus acceptance.

Interactive browser checks are unavailable: CUA reports that local browser use is
disabled in Work settings. Keyboard/focus return, screen-reader announcements,
mobile overlap/layout, live navigation and late-response browser acceptance remain
explicit MS77-TC03/04/14 and MS-79 gates. They have not been marked as passed.
Hosted useful-answer quality, deployed RLS, real pgvector/provider behavior,
deployment-wide HTTP load and controlled activation also remain MS-79 release gates.


## Final local verification

| Check | Result |
|---|---|
| `pnpm test:ms77` | 21 public contract, ranking, security and gateway tests passed |
| Final combined MS76/MS77/MS78 customer regression selection | 70 tests passed across seven files |
| `pnpm test:ms77:python` | 15 public Python intent, characteristic, capability, activation and capacity tests passed |
| Relevant Python public/foundation/private/MS65/runtime identity/MS44 regressions | 94 passed |
| `pnpm test:ms77:postgres` | Passed concurrent IP/visitor quota races, shared public/private permits, recovery, catalog filtering, role denial and expired-only rollback |
| `pnpm typecheck` | Passed across packages and all four applications |
| `pnpm lint` | Passed, 55 TypeScript and 36 Python boundary files |
| `pnpm build` | Passed across all four applications; customer production build repeated successfully after final public UI and request-timeout changes |
| `pnpm test` | Snapshot: 2,476 passed, 43 skipped, four pre-existing failures; later added abort test passes in the focused run |
| `git diff --check` | Passed |

The four full-suite failures match the preceding MS76/MS78 runs: MS35 DrawSQL parity for overdue_notified_at, MF71/MF78 survey email expectations, and MF79 payment-queue source-string sorting. These files were not changed by MS77. The full test log is in node_modules/.cache/ms77-full-test.log; build logs are in node_modules/.cache/ms78-final-build.log and node_modules/.cache/ms77-customer-build.log.

Prepared synthetic manual browser fixtures are in evaluation/ms77-browser-fixtures.json. Their status remains PENDING_BROWSER_ACCESS. Missing schedule produces an explicitly labeled characteristic-only comparison and asks for date/time/duration; it emits no availability badge or price. Empty/contradictory characteristic evidence produces a limitation instead of a preference claim.

## October 29 saved discovery preferences repair

PRD-F26, SDD-C20-C24 and MS77-TC05/08 cover personal spot suggestions using
the saved schedule and preferences. The customer gateway now includes its
validated optional `discovery` object in both `/v1/customer/plan` and
`/v1/customer/catalog-plan` requests. Matching strict Python input accepts the
bounded schedule, selection identifiers and preferences. Both model interpreters
receive the saved values as user constraints, with instructions to use WORKSPACE
for personal recommendations while retaining KNOWLEDGE for general policy questions.

Previously, planning saw only the question and whether spots were selected. An
oversized candidate set could also downgrade a personal recommendation to generic
knowledge without applying its saved constraints. With saved constraints, that
case now asks for a narrower floor, type or explicit comparison. Capacity remains
a deterministic hard filter. Missing schedule does not hide an empty capacity
result, and replies identify the requested group size without asserting availability.

Local regression coverage includes both planning paths with a saved group of ten,
capacity exclusion with and without a schedule, an empty matching set, interpreter
context forwarding, general-policy intent and invalid preference rejection.
The focused gateway/conversation selection passes 30 tests and the MS77 Python
selection passes 47 tests. Deploy the matching Python service before the customer
gateway because the previous strict service input rejects `discovery`. No hosted
deployment, paid inference or browser acceptance is claimed by these local checks.

Final local verification: `pnpm typecheck`, `pnpm lint` and `pnpm build` pass.
`pnpm test` passes 299 files with 2,766 passing tests, one expected failure and
43 skipped tests. The additional Python conversation/runtime selection passes
16 tests. The final focused gateway/conversation rerun passes all 30 tests.
