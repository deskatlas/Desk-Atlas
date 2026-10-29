# Customer broad-conversation audit repair

Date: October 29, 2026, Asia/Irkutsk.
Authority: the maintainer requested local repairs for the broad public-browser
audit and timing audit, followed by repeated local verification without slower
answers. Traceability: PRD-F1-F4/F26/F27, SDD-C20-C24, DSD-UI16,
QAD-TC44/46, MS77/MS79.

## Scope and concrete changes

- Immediate follow-ups resolve against the latest named customer topic instead
  of reviving older payment or cancellation questions. Repeated anaphoric turns
  are skipped when identifying that topic. The server supplies the active
  walk-in/kiosk or website channel as intent before catalog selection and carries
  that task to document support. This context never authorizes access or policy.
- Workspace recommendations receive current server-read template facts separately
  from original document evidence. Named numerical capacity labels are removed
  from document-backed prose before verification; current capacities appear as a
  separate server statement and are revalidated before release. The catalog read
  runs alongside document expansion, and its final read alongside source checks.
  No publication, capacity configuration or source document was edited.
- Customer compact drafts use actual source-count bounds in the provider schema
  as well as canonical validation. This closes admission of invented addresses
  that previously failed later as generic model/evidence errors.
- A literal, source-backed `QR Payment` method mention no longer forces an entire
  kiosk manual into the visible answer. QR-role, scan, booking, access and
  attendance statements still require exact original wording. Python and domain
  validators enforce the same narrow distinction. Full original text remains in
  the independent verification input, including rules not cited by the draft.
- Mixed website/kiosk introductions qualify private payment links/pages as
  website steps before verification. Product overviews avoid optional QR/rewards
  draft topics, and catalog discovery gives a coherent website introduction one
  primary document while retaining mandatory dependencies. Explicit joint policy
  questions continue to support multiple primary documents.
- Routine website booking/payment questions use one coherent primary guide for
  the normal guest journey, account requirements and confirmation boundary.
  Optional rewards, cancellation and kiosk walkthroughs do not become additional
  tasks. Original payment, allocation and confirmation safeguards remain required.
- A supported, safe but incomplete customer draft can take one bounded exact-rule
  recovery pass. Unsupported generated prose is discarded before proposing its
  exact originals for independent re-verification. Irrelevant, unsafe or
  conflicting drafts cannot recover through this path. Dangling obligations at
  chunk boundaries include their same-generation continuation before release.
  Existing source, output, model-call, deadline and authorization limits remain.
- Allowlisted provider/output/deadline failures stay distinct from policy and
  evidence-budget rejection. Opt-in numeric upstream spans distinguish inference,
  local queue, schema and other work. No source prose, question, provider body,
  credential or private booking record is added to logs.

## Boundaries and remaining limits

No new model, dependency, paid tier, automatic successful-answer retry, transcript
cache, migration, source publication or production deployment was introduced.
Successful first-pass answers retain their existing number of model calls.
Failure recovery can add one independently checked pass, within the original
budget; it is not a guarantee of identical per-request latency.

The original single production 503 was localized to document support, but its
exact provider reason was not captured. Source-bounded output and classified
failure handling repair concrete implementation defects; they do not establish
that all possible provider failures are eliminated.

Capacity correction mechanically covers named parenthetical and adjacent size
labels. Current capacities are independently shown from the map. This is not a
general proof that every arbitrary generated numerical sentence is correct.

The public browser passed many repaired cases locally during iteration, including
the capacity contradiction and walk-in continuation. It also exposed intermittent
overview/booking refusals and provider outliers; those attempts are retained.
The last browser candidate before overview trimming returned nine substantive
replies and a scope-limit refusal on the repeated introduction. It must not be
reported as a ten-of-ten final success.

After the latest overview-packing change, browser use returned `Local browser use
is disabled in Work settings`. No alternative UI-control path was used to bypass
that setting. Final browser-render acceptance is therefore pending. Local HTTP
checks continue through the built application and normal ingress, and are labeled
as HTTP, not complete-render browser evidence.

## Verification evidence

Evidence directory: `outputs/customer-rag-local-repair-2026-10-29/`.

| Check | Recorded result |
|---|---|
| `pnpm test` | 302 files passed, 2,825 tests passed, one expected fail, 43 skipped |
| Focused gateway/QR regression suite | 52 tests passed |
| Python customer/provider/document regressions | 232 tests passed after overview/booking scope repair |
| `pnpm typecheck` | Passed after the build; a parallel initial run hit a generated-route race |
| `pnpm lint` | Passed |
| `pnpm build` | Passed for all apps before final customer-only rebuilds |
| Final customer build | Passed with public assistant enabled |
| Loaded Python implementation | Verified current; receipt in `runtime-verification-final.json` |

Regression commands:

```powershell
pnpm exec vitest run tests/ms77-gateway.test.ts tests/ms77-customer-audit-qr-boundary.test.ts
services/rag/.venv-service/Scripts/python.exe -m pytest services/rag/tests/test_deepinfra.py services/rag/tests/test_ms77.py services/rag/tests/test_ms65.py services/rag/tests/test_customer_audit_repair.py services/rag/tests/test_customer_batched_support.py services/rag/tests/test_customer_conversation.py services/rag/tests/test_qwen_latency.py services/rag/tests/test_ragfix.py -q
node scripts/customer-rag-local-acceptance.cjs outputs/customer-rag-local-repair-2026-10-29/final-http-acceptance.json
```

The local production-style app listens on 3011 behind the loopback ingress on
3013, which overwrites the trusted client-IP header from the actual socket.
The local Python service on 8014 retains the deployed Qwen/Qwen3.6-35B-A3B
planning/document model, standard service tier, indexed source transport and
normal admission. No quota identity or IP rotation is part of acceptance.

## Timing interpretation

Production browser baseline: mean 12.03 seconds, median 11.90 seconds,
range 9.03-15.43 seconds, with one non-answer. Intermediate local browser runs
include a 9.01-second mean but also later 18.99-second and 29.82-second
browser/HTTP outliers; the 29.82-second sample is HTTP only. Numeric spans place
the long diagnostic waits in inference rather than local queue. Do not select
only the fast samples to claim a latency pass.

`booking-scope-http-acceptance.json` preserves every submission in the latest
sequential campaign. It uses one visitor, same conversation history and real quotas, with
65-second inter-question spacing. Its complete-response times exclude typing,
inter-question spacing, browser rendering and session bootstrap. They cannot
establish browser timing parity or a production p95.

## Latest local HTTP campaign completed

Ten of ten submissions returned HTTP 200 and substantive ANSWER responses. None
returned CLARIFY, an output/completeness refusal or a transport error. The exact
questions, replies and stage timings remain in the JSON evidence. The capacity,
walk-in, follow-up and booking responses were read against the audited defects;
automated usefulness checks are not independent policy certification.

| Case | Local HTTP seconds |
|---|---:|
| Introduction | 11.18 |
| Workspace types and rates | 6.75 |
| Quiet study and calls | 11.78 |
| Booking and payment | 9.64 |
| Changes, late arrival and refund | 10.95 |
| Location, hours and amenities | 11.02 |
| Taglish walk-in | 8.14 |
| Walk-in next-step follow-up | 10.73 |
| Outage and noise support | 11.53 |
| Repeated introduction | 9.81 |

Mean: 10.15 seconds. Median: 10.84 seconds. Range: 6.75-11.78 seconds.
Four submissions finished below ten seconds; all ten below fifteen seconds.
The production browser baseline mean was 12.03 seconds, but this lower local HTTP
mean cannot certify browser-render parity or a production latency guarantee.
No added inference is required on a passing first draft; bounded failure recovery
can add a verification pass. Earlier failures and outliers remain preserved.

See `outputs/customer-rag-local-repair-2026-10-29/VERIFICATION.md` and
`FINAL-SUMMARY.json` for the complete current result and outstanding browser gate.
The user reported re-enabling browser use, but the tool still rejected access
after reconnect and reset. No production deployment has occurred.
