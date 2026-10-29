# Customer broad-question RAG deployment, October 29, 2026

Traceability: PRD-F26/F27, SDD-C20/C21, QAD-TC44/46.

The user authorized deployment of the RAG service only. App deployment belongs
to the user. The stable service URL, credentials, private IAM, model selection,
service tier, CPU/memory, concurrency, limits and runtime flags are preserved.
No source publication or database migration was performed.

## Rollout findings

The first repaired revision, `cust-1f08fa5d`, briefly received production traffic.
An additional old-app QR compatibility check exposed a staggered-rollout issue.
Traffic was restored to `deskatlas-rag-chat-production-admin1029b` before further
candidate testing. All later candidates remained at zero traffic until checks
passed. This earlier promotion was not the final release.

The backend now requires `presentation_contract: customer-concise-v1` before
allowing concise literal payment-method prose. The latest customer gateway adds
this field. Requests from the existing app retain exact QR quotation behavior.
Internal document routes reject the customer presentation contract.

Hosted synthetic probes also found historical capacity text returning through
exact-rule recovery and through an activity phrase, "calls for two people."
Positive capacity labels are projected out before independent verification;
canonical source text, hashes, offsets and quoted evidence remain untouched.
Restrictive policy wording is preserved. Both regression paths are covered.

A repeated catalog probe exposed a model-generated default 60-minute duration
and imaginary calendar date for "today at 7am." The shared intent projection now
requires user/history or saved-context support for explicit dates and a duration
cue or saved duration before retaining a generated booking length. Missing
values remain absent for the app to clarify. This conservative guard does not
claim to validate every possible natural-language duration or preference.

## Verification and limits

- Python suite after final code changes: 876 passed, 16 skipped.
- Focused customer audit regressions: 20 passed.
- Root lint: passed, zero Python or TypeScript boundary violations.
- App typecheck and gateway tests passed during the deployment preparation.
- Original local HTTP campaign: 10/10 answers; mean 10.15 seconds. See the repair
  report for individual timings and scope.
- Private authentication, capability separation, loaded-code fingerprint,
  old/new document compatibility, canonical UTF-16 proof offsets and catalog
  intent extraction are checked against the hosted candidate.

Successful hosted HTTP checks and their timings are retained in receipts under
`outputs/customer-rag-deploy-2026-10-29/`. Model latency varied between probes.
These synthetic backend calls cannot establish website browser latency parity
or a production p95. The release adds no inference to the normal successful
path and preserves the model, standard tier, resources and latency flags.
Bounded failure recovery can still add a verification call, as documented in
the original repair report.

## App handoff

Deploy the latest working tree, including
`apps/customer-website/src/server/customer-assistant/gateway.ts` and its
`customer-concise-v1` presentation field. The backend supports the existing app
during this handoff. Full website acceptance and browser timing remain distinct
from backend smoke verification and require the updated app deployment.

Rollback revision: `deskatlas-rag-chat-production-admin1029b`.
Preserved runtime/IAM configuration SHA-256:
`8715454651847c7fe5d33afb0b406cb9abfd6d322f09287c2bba5da20715f0f7`.

## Released backend

- Revision: `deskatlas-rag-chat-production-cust-c63cd9a8`, 100% production traffic.
- Cloud Build: `c63cd9a8-f85f-46d1-a8ef-004b1639e333`, SUCCESS.
- Image digest: `sha256:cba31e5398de0dc756bae5aee89502a0d49c9e531f03858f9fa6c3bc6311fcd1`.
- Loaded implementation: `27d1591e78fc915760f7da5167920313c79ddb4380c3983b461b1cd9d75a7cb3`.
- Stable URL: `https://deskatlas-rag-chat-production-2ttaxxsoaa-uc.a.run.app`.
- Candidate and post-promotion stable-URL checks passed. Temporary candidate
  tag removed; rollback revision retained.
- Post-promotion document probes: legacy 1,594 ms; current catalog 1,609 ms.
- Post-promotion direct planning: legacy 1,344 ms; constraints 1,609 ms.
- Post-promotion catalog planning: legacy 2,203 ms; constraints 2,844 ms.

These are individual synthetic requests, not end-to-end website latency or a
load test. A candidate catalog probe took 16,235 ms before promotion; retain
that outlier when assessing provider latency variability. No model or tier
change was made to improve the reported numbers.
