# Fast RAG candidate and publication record

Subsequent maintainer authorization: push `ragfix`, merge and push `dev`, then
merge and push `main`, and deploy RAG if it functions well locally. Repeated
complete local admin, STAFF-follow-up and customer-booking requests passed in
8,600, 7,312 and 8,475 ms respectively. This authorizes the previously reviewed
conditional runtime/application rollout; the historical pending-approval notes
below are retained for chronology. Production success must still be verified.

October 28, 2026, Asia/Irkutsk. PRD-F4/F5/F6/F7/F9/F26/F27,
SDD-C20-C24, ERD-E24-E29 and QAD-TC44-TC46.

## Current release boundary

The local candidate produces useful complete responses under ten seconds in
the samples below. This is not production latency acceptance, a p95 estimate,
or a guarantee for every question. No application or inference-service
deployment, Git push or merge has occurred in this continuation. The additional
model is admitted only by explicit local benchmark configuration and cannot
be enabled on Cloud Run by that flag. Production adoption and its ongoing
inference charges require separate maintainer approval after review.

The maintainer separately approved five reviewed knowledge replacements.
All five were uploaded through the ordinary authenticated, versioned admin
workflow, passed ingestion, and became the active published versions. Read-only
checks matched all five stored source hashes to the reviewed file bytes.
The catalog epoch observed after publication was 2511. The receipt retains
both predecessor and replacement version identities. No booking, payment,
inventory or database schema was changed.

Review and publication receipt:
`outputs/admin-rag-audit-2026-10-28/source-policy-reconciliation/REVIEW.md`
and `publication-receipt.json` in that directory. The 15 reviewed corrections
align one-hour website payment sessions and subsequent proof review, distinguish
payment/access QRs, and qualify arrival payment collection and check-in.

## Candidate changes

1. One model operation resolves internal intent and chooses document seeds
   from current role-permitted catalog introductions and headings. Live/mixed
   requests defer to the existing planner and allowlisted tool path. Current
   operational snapshots retain their deterministic route. This branch is
   separately opt-in through `RAG_INTERNAL_CATALOG_DISCOVERY=true`.
2. Both catalogs select the current ingestion generation. Older retry
   generations cannot provide seeds or headings. Introductions still come from
   principal-bound source RPCs, never direct service-role text queries.
3. Dictionary encoding preserves every discovery heading while reducing
   repeated parent paths. Customer document indexes are bounded by the actual
   catalog enum, separate from heading-segment indexes. Original uncompressed
   admission bounds are retained.
4. The draft model emits scope and blocks. Constant outcome and empty
   clarification fields remain server-owned rather than asking a model to
   manufacture them. Independent verification still determines release.
5. `RAG_TASK_FRAMED_DRAFT=true` asks the internal draft to identify the original task and
   participants before writing. These fields never become evidence and are
   omitted from the independent verifier's candidate. Customer framing is not
   activated: its trial omitted the explicit no-hold statement in a booking
   answer and failed quality review. Every original partition,
   mapped quote and final source/actor/epoch check remains required.
6. Customer final verification uses one authorized complete-document snapshot
   for every inspected original, including uncited conditions. It replaces
   per-citation network reads and rejects changes to content or source identity.
7. Upstream customer capacity now remains `429 CAPACITY_BUSY` with a bounded
   retry interval instead of being mislabeled `503 ASSISTANT_UNAVAILABLE`.
   The existing two-customer admission and inference limits are unchanged.

## Measurements and failures

All HTTP figures include complete gateway responses. Support-only probes are
not included in the gateway table. Questions were evaluated against canonical
sources and application invariants by the implementing agent. There was no
independent human or held-out evaluator campaign. These are diagnostic samples,
including exposed regressions and newly written formulations.

| Path | Complete elapsed | Evidence |
|---|---:|---|
| Admin daily orientation, one-pass catalog | 8,700 ms | `gemini-catalog-admin.jsonl` |
| Admin normal payment handling, final framed candidate | 8,703 ms | `gemini-final-admin.jsonl` |
| Admin correcting rejected payment | 6,616 ms | `gemini-catalog-admin.jsonl` |
| STAFF paid-arrival follow-up, final framed candidate | 7,287 ms | `gemini-final-followup.jsonl` |
| STAFF noise complaint, corrected participants | 7,937 ms | `gemini-framed-staff.jsonl` |
| STAFF opening checks, framed candidate | 7,916 ms | `gemini-framed-staff.jsonl` |
| STAFF extension guidance, framed candidate | 7,297 ms | `gemini-framed-staff.jsonl` |
| STAFF denial of online approval authority | 7,303 ms | `gemini-new-staff.jsonl` |
| STAFF early check-in prohibition | 5,829 ms | `gemini-new-staff.jsonl` |
| STAFF Tagalog current operational snapshot | 610 ms | `gemini-new-staff.jsonl` |
| Customer booking after catalog packing | 8,424 ms | `gemini-packed-customer-booking.jsonl` |
| Customer no-hold explanation after bounded-index repair | 8,410 ms | `gemini-new-customer-fixed.jsonl` |
| Customer payment QR versus access QR after repair | 7,655 ms | `gemini-new-customer-fixed.jsonl` |
| Customer expired link after transfer after repair | 7,910 ms | `gemini-new-customer-fixed.jsonl` |

All referenced JSONL files are under `outputs/admin-rag-audit-2026-10-28/`.
Some rows precede the final task-framed flag and must not be represented as a
single frozen final-version acceptance campaign.

Earlier normal browser observations completed by 9,559 ms for customer booking,
8,354 ms for an admin payment-correction question and 8,666 ms for the staff
surface's arrival answer. The staff browser used the supplied ADMIN account;
actual STAFF role boundaries were exercised by gateway probes. A genuine
staff-surface follow-up took 11,163 ms before one-pass discovery. Its later
gateway replay took 7,184 ms; the final framed replay took 7,287 ms. Browser
automation was disabled in Work settings before the final browser repeat.
Do not claim final browser acceptance from gateway results.

A three-request concurrent run returned useful admin, STAFF and customer
answers in 7,843, 7,145 and 8,945 ms. A five-request run included three public
customers and correctly exceeded the existing two-customer upstream admission
limit: four requests completed in 6,977-8,356 ms; one was rejected. That exposed
the error-status translation fixed above, rather than authorizing a higher
customer capacity. Repeated public probes also reached the existing ten-per-IP
ten-minute quota. No quota records or protections were changed or bypassed.

The initial customer QR and expired-link questions failed during discovery
because the model confused heading indexes with document indexes. Their failed
and corrected runs are retained. The first noise complaint answer wrongly
addressed the reporter as a possible offender; the task-framed retest corrected
the participants. Qwen boolean and structured critics that accepted unsafe
unconditional payment instructions remain rejected experiments outside serving.

## Model and budget

The selected local candidate is `google/gemini-3.1-flash-lite` through the existing
DeepInfra transport, with no fallback. Sources:
[model and pricing](https://deepinfra.com/google/gemini-3.1-flash-lite),
[alternate Flash pricing](https://deepinfra.com/google/gemini-3.5-flash), and
[DeepSeek candidate](https://deepinfra.com/deepseek-ai/DeepSeek-V4-Flash).
The maintainer authorized a $1 cumulative additional-model benchmark, not
unlimited production usage. Every candidate call reserves conservative input
and output cost first. Valid provider token counts settle at undiscounted
rates; failed or unverifiable calls retain full reservations. Startup canaries
and gateway calls use the same exclusive local ledger as component diagnostics.
The ledger is private and excluded from deployment.

## Reproduction

Start the Python preview with these process-local settings:

```powershell
$env:RAG_PREVIEW_API_PORT='8012'
$env:RAG_ANSWER_MODEL='google/gemini-3.1-flash-lite'
$env:RAG_DOCUMENT_ANSWER_MODEL='google/gemini-3.1-flash-lite'
$env:RAG_BENCHMARK_ENABLED='true'
$env:RAG_TASK_FRAMED_DRAFT='true'
$env:RAG_CUSTOMER_BATCHED_SUPPORT='true'
$env:CUSTOMER_ASSISTANT_ENABLED='true'
node scripts/ragfix-preview.cjs api
```

For admin/staff preview processes set `RAG_PREVIEW_API_PORT=8012` and
`RAG_INTERNAL_CATALOG_DISCOVERY=true`, then run `ragfix-preview.cjs admin` or
`ragfix-preview.cjs staff`. For customer set the same API port and
`CUSTOMER_ASSISTANT_CATALOG_DISCOVERY=true`, then run `ragfix-preview.cjs customer`.
Ports are 3010, 3012 and 3011 respectively. The previews use current private
configuration without printing credentials. Do not copy benchmark flags to
production or infer production approval from a local synthetic role credential.

## Remaining release work

1. Finish final regression logs and an admitted customer replay after the
   natural rate-limit window. Preserve the quota rather than rotating identity
   or changing the source IP.
2. Repeat final browser follow-ups if local browser automation is re-enabled.
3. Obtain explicit model-adoption and deployment approval, including ongoing
   inference cost. Keep the current published source corrections in place.
4. Prepare immutable inference and application revisions, retain existing
   credentials/IAM/ingress, run a production-topology canary and measure first-use
   and normal-load complete responses before routing production traffic.
5. If runtime canary fails, retain or restore the previous application/runtime
   revisions and flags. Source correction rollback is a separate audited version
   decision, not a reason to silently restore obsolete payment policy.

## Final local checks and hosting proposal

The final monorepo checks passed 2,761 tests with one expected failure and 43
skips across 299 passing and seven skipped files. Typecheck, boundary lint and
all four application builds passed. The focused serving Python run passed 136
cases; 95 subsequent focused cases also passed after separating customer task
framing and adding the explicit release-admission boundary. Logs use the
`release-candidate-` prefix. Source and epoch checks are retained throughout.

The final framed internal replay returned normal payment handling in 8,703 ms
and the genuine STAFF follow-up in 7,287 ms. A customer deadline follow-up
returned the server-recorded 60-minute rule in 8,544 ms. The final public
booking probe after the normal quota window returned a cited response in
9,405 ms, but omitted the explicit no-hold sentence with customer task framing.
That quality failure is retained; customer task framing was therefore disabled.
The final unframed complete booking replay then passed in 9,014 ms with five
citations, the explicit no-hold statement, the 60-minute deadline and subsequent
administrator proof review. See `gemini-final-unframed-customer.jsonl`.

Read-only hosting inspection found the existing Cloud Run revision
`deskatlas-rag-chat-staging-00005-lct`, immutable image
`api-hosted@sha256:6c7480857546cf5033aa40fec929c6dcac30bddd69f442f1a44f7e904733dff2`,
HTTP concurrency 1, maximum one instance, minimum zero, and 2 vCPU / 8 GiB.
This serializes production-topology traffic and admits cold starts. Local
parallel Python performance does not establish hosted latency on that topology.

Proposed canary: one vCPU, 1 GiB, one maximum instance, seven concurrent HTTP
requests, unchanged internal five/customer two application admission bounds,
and unchanged authentication, IAM, service identity, secret references and
ingress. First deploy a tagged revision with zero production traffic and zero
minimum instances. Validate memory, identity, role boundaries, publication
freshness, complete answers and concurrency. If it passes, promote compatible
application revisions and the inference revision, then set one service-level
warm instance. Retain the old immutable runtime and previous Vercel deployments
as rollback targets. No database migration is needed for these additional fixes.

At published us-central1 request-based rates, one idle vCPU plus 1 GiB for
30 days is approximately $12.96 before free tier, active-request charges,
networking and build/storage costs. Inference adds $0.25 per million input
tokens and $1.50 per million output tokens for Flash-Lite. These are estimates,
not an enforced monthly cap. The initial $1 authorization covers the benchmark
only. Sources: [Cloud Run pricing](https://cloud.google.com/run/pricing),
[minimum instances](https://cloud.google.com/run/docs/configuring/min-instances),
and the model pricing link above. A warm instance reduces cold-start latency
but does not establish a universal sub-ten-second guarantee.

An explicit `RAG_FAST_MODEL_RELEASE=true` admission switch is implemented for
the reviewed Flash-Lite ID only. It is disabled by default and has not been
enabled on Cloud Run. Other benchmark candidates remain unavailable in hosted
serving. The benchmark-only flag still cannot grant production admission.

The immutable candidate build succeeded with image
`us-central1-docker.pkg.dev/deskatlas-rag/deskatlas-rag/api-hosted@sha256:92f17467e52476ecf70cc813d00e3a0930e812794f1f056fdbb58a1357322ed2`.
Build ID: `1b168af2-fcb2-4859-a540-6c8cc30d0b75`. Building the image did not
deploy it or route traffic. The exact proposed environment/resources and
promotion conditions are in
`outputs/admin-rag-audit-2026-10-28/FAST-DEPLOYMENT-REVIEW.json`; the private
secret-reference-preserving runtime manifest is `fast-runtime-review.json`.

The additional-model ledger reports approximately $0.4652 provider-estimated
usage and $0.5632 conservative admitted/retained cost against the $1 ceiling,
including failed reservations. See `fast-benchmark-spend.json`. No further
paid inference is necessary while waiting for production approval. The user
offered to re-enable local browser automation, but the latest capability check
still reported disabled; final browser follow-up acceptance remains open.
