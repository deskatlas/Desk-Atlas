# RAG continuation: historical latency and quality findings

Current status: [fast RAG release record](RAGFIX-FAST-CANDIDATE-2026-10-28.md).
The maintainer subsequently authorized the branch/dev/main pushes and deployment
after local verification. All five reviewed source-policy replacements are
active. The historical measurements and blockers below describe earlier states;
the linked release record contains the current deployment and acceptance limits.

October 28, 2026, Asia/Irkutsk. PRD-F26/F27, SDD-C20-C24,
ERD-E24-E29 and QAD-TC44-TC46. No source publication, database mutation,
deployment, push or merge occurred in this continuation.

The requested complete, useful response below ten seconds across admin, staff
and customer is **not achieved**. A customer account-requirement answer rendered
within an observed 7,536 ms in the ordinary anonymous browser. A customer booking
gateway reply completed in 8,573 ms, but contradicted the application's payment
flow through its published source and does not pass quality acceptance.

## Implementation retained for review

1. `RAG_CUSTOMER_BATCHED_SUPPORT=true` separately opts customer inference into
   the existing lossless batching implementation. Customer capabilities,
   principals and two inference slots remain separate from internal roles.
   Drafts and independent final verification inspect every original partition.
   Canonical hashes, UTF-16 slices, proof limits and final gateway checks remain.
   The opted-in customer planner/selector uses the explicitly configured approved
   document model. The production default remains unchanged.
2. `CUSTOMER_ASSISTANT_CATALOG_DISCOVERY=true` separately opts the website into
   bounded catalog discovery. It filters current CUSTOMER metadata by scope,
   reads source introductions through the existing principal-bound source RPC,
   checks source identities, hashes and epoch, and supplies current headings as
   discovery aids. One semantic call resolves intent and selects source seeds.
   Complete original documents still supply all answer evidence. No embedding
   request, answer cache, new dependency or new database function is needed for
   this branch. Limits are 12 documents, 1,000 metadata chunks, 100,000 model-data
   bytes and three concurrent source reads. Oversize/inconsistent catalogs fail
   instead of silently dropping documents. The flag defaults off.
3. Final independent customer citation rereads run three at a time. Each retains
   its authorization check; final principal, active-control and catalog-epoch
   checks still precede release. Optional numeric Server-Timing diagnostics now
   include customer model operations and the complete request, including lease
   release. No input, credentials or output text enters these headers.
4. Loaded-code fingerprints now include the active batching, original-transport,
   prepared-protocol and tokenizer modules. Node and Python compute the same
   fingerprint. An old process cannot claim these newly edited modules.
5. The original-rule prerequisite/guard kernel is isolated under
   `experiments/ragfix/rule_graph.py`. Its tests preserve distant/transitive/global
   dependencies, reject stale or invalid graphs and require original guard text
   beside an affected claim. That mechanical check is necessary only: verbatim
   presence does not certify entailment or logical qualification. Every proposed
   rule gets an independent full-original audit. The final real payment canary
   completed all 84 audits and was rejected on all 84. No graph artifact was
   produced, published or admitted to serving. Earlier output/validation failures
   are retained. [Budgets and transport revisions](experiments/ragfix/RULE-GRAPH-CANARY.md)
   are explicit and change no chat limits.

## Exposed measurements, including failures

These are local probes, not a held-out campaign, p95 result, cold-start result or
production SLA. Some earlier development probes overlapped offline provider
work. The final browser account observation and priority booking sample were
made without a concurrent preparation canary. Browser time is a completion
observation bound, not an exact HTTP span. All source-bound numeric reports are
under `outputs/admin-rag-audit-2026-10-28/`.

| Path | Complete time | Result |
|---|---:|---|
| Admin arrival, initial production-build component replay | 22,426 ms | Supported verdict; latency failed and normal arrival coverage remains questionable |
| Staff arrival, approved Qwen3.6 full-original support | 9,028 ms | Unconditional payment instruction; quality failed |
| Customer legacy support, Qwen3-32B | 24,200 ms | 13 calls, 67 original units; support only |
| Customer batched support, Qwen3.6 | 4,468 ms | Two calls, same 67 original units; support only, no full-gateway acceptance |
| Customer gateway with batching before discovery repair | 22,921 / 27,515 ms | Latency failed; source selection reached 14,750 ms |
| Customer gateway with one-pass selection | 19,992 / 13,931 ms | Latency failed; one embedding request reached 6,018 ms |
| Customer catalog gateway, standard tier | 13,279 / 11,516 ms | Latency failed |
| Customer catalog gateway, priority tier | 8,573 ms | Cited booking answer, but source/application policy conflict fails quality |
| Ordinary customer browser, account requirement | Observed complete within 7,536 ms | Correct no-account answer with three citations; one fresh formulation, not independent general acceptance |

The 24,200-to-4,468 comparison changes both pipeline and model. It does **not**
isolate batching speedup. An earlier progress message described it as same-model;
that was corrected after tracing the legacy endpoint's model selection.

## Independently checked customer source conflict

The current public `02_Reservations_Payments_and_Booking_Management.docx`, version
`e751f54f-4403-45ae-b3b9-69b05aa1bf41`, says initial admin approval precedes payment
instructions and that the private proof link lasts 24 hours. The application's
normal homepage advertises a one-hour payment link and payment before proof
review/allocation. These are different booking flows. The canonical source
inspection and hashes are in `customer-policy-conflict.json`; the one-hour copy
is in `apps/customer-website/src/features/landing/components/LandingPage.tsx`.

The fast booking reply is source-supported but fails correctness against the
current application. No published text was rewritten to make a benchmark pass.
Source-policy reconciliation and normal-role acceptance remain required before
customer activation. The screenshot `customer-catalog-browser-account.png`
records the separate, useful account-requirement answer and surrounding page.

## Verification and remaining work

The full monorepo suite passed 2,747 tests with one expected failure and 43 skips
across 298 passing and seven skipped files. Focused tests additionally cover the
final catalog error handling. Typecheck, boundary lint and all four application
builds passed. The final relevant Python suite passed 222 cases, including
customer capability boundaries, full-original omission checks, cancellation,
prepared lifecycle, original-rule guards and loaded-code identity. The final
boolean-audit transport has its own subsequent passing kernel run. Logs use the
`continued-final-` prefix in the audit output directory.

These checks establish implementation safety at their tested seams. They do not
override the failed answer-quality or latency gates. Internal original-rule
preparation still needs a valid independently audited graph and claim binding.
Customer policy needs reconciliation against the actual approved application.
Broad natural questions, genuine follow-ups, first-use and concurrent-load
acceptance remain open for all three surfaces. Default serving flags remain off
and the conditional branch/merge/deployment chain has not started.

## Local reproduction

In one PowerShell terminal, using existing private local configuration:

```powershell
$env:RAG_PREVIEW_API_PORT='8011'
$env:RAG_DOCUMENT_ANSWER_MODEL='Qwen/Qwen3.6-35B-A3B'
$env:RAG_CUSTOMER_BATCHED_SUPPORT='true'
$env:CUSTOMER_ASSISTANT_ENABLED='true'
$env:RAG_DEEPINFRA_SERVICE_TIER='priority'
node scripts/ragfix-preview.cjs api
```

In a second terminal:

```powershell
$env:RAG_PREVIEW_API_PORT='8011'
$env:CUSTOMER_ASSISTANT_CATALOG_DISCOVERY='true'
node scripts/ragfix-preview.cjs customer
```

Open `http://127.0.0.1:3011`. These settings are process-local. The customer
preview uses the repository's existing development-only loopback IP behavior;
it does not change production ingress or authentication settings. For a strict
complete gateway timing, run `node scripts/replay-customer-rag-audit.cjs`. For
authorized original support alone, use `scripts/rag-support-probe.cjs`. Those
support-only results must not be reported as complete browser performance.
