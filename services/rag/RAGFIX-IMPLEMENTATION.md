# RAG repair candidate and release gate

Date: October 28, 2026, Asia/Irkutsk. Branch: `ragfix`.

Latest checkpoint: [continued repair findings and failed release gate](RAGFIX-STATUS-2026-10-28.md). The historical runs below are retained and do not supersede that checkpoint.

Authority: maintainer request to fix the [browser audit](ADMIN-RAG-BROWSER-AUDIT-2026-10-28.md), require useful complete responses below 10 seconds, test first, then push ragfix, merge/push dev, merge/push main and deploy RAG only if fixed.

Traceability: PRD-F26/F27, SDD-C20-C24, DSD-UI16/UI17, ERD-E24-E29 and QAD-TC44-TC46. This tracked amendment accompanies the ignored master specifications. No booking, payment or inventory mutation is introduced.

## Release status

**Not accepted for release. The under-10-second requirement remains unmet.** No remote push, dev/main merge, infrastructure update or RAG deployment has been performed. Passing unit tests is not evidence that this performance gate passes.

## Changes

- Ordinary current-time occupancy wording, including right now and currently, uses the existing authorized operational snapshot. Mixed/historical questions continue to defer.
- A previous transport/request failure is retained beside its question when the next question clears the active retry notice. Errors use provider-neutral copy.
- The gateway reuses its admission epoch as its initial knowledge epoch; source/actor/final epoch checks remain. `RAG_GUIDANCE_FAST_PATH=true` enables model-free classification of clear guidance questions as read-only document queries. It grants no tool or role permission and defaults off.
- `RAG_INTERNAL_BATCHED_SUPPORT=true` enables an experimental internal-only evidence path. It defaults off. Canonical hashes, UTF-16 offsets, complete source-unit integrity, source generations and final gateway checks remain enforced. Customer serving keeps its existing path.
- Original text travels in bounded packets, with exact repeated text retaining every original address and heading. Provisional partition drafts can be combined into one concise proposed answer. Every released claim and its exact support is independently verified, and every original partition is checked for omitted required rules, conflicts and unsafe guidance. No generated draft becomes evidence. Distant missing restrictions and fabricated addresses have regression coverage.
- Internal hosted batches may use eight concurrent in-flight calls within the same existing 50-call, 400,000-byte aggregate and output/work ceilings. Model/request deadlines remain. This is an opt-in candidate concurrency policy, not a proven production load result.
- Batched hosted input retains the 240,000-byte transport ceiling. Context admission is scoped to the explicitly selected document model: 32,768 tokens for 32B, 131,072 for the 235B experiment and 262,144 for Qwen3.6. Qwen3.6 uses a conservative UTF-8 byte upper bound; the other experiments count the complete serialized request with the hash-verified Qwen tokenizer. Output/template headroom and reported provider usage checks remain. No source or question is cached by the application. The cached tokenizer singleton contains vocabulary only.
- The serving lock reuses tokenizers 0.22.2 and its transitive pins from the existing approved runtime lock, under SDD-C21's approved Transformers/tokenizer dependency family. Image provisioning downloads the immutable tokenizer artifact and verifies its hash. The same Qwen/Qwen3-32B model remains selected. The upstream model documents 32,768 native context tokens: [Qwen model card](https://huggingface.co/Qwen/Qwen3-32B).
- `RAG_DEEPINFRA_SERVICE_TIER=priority` is an optional same-model transport experiment. Standard is the default. The provider documents a 50% token surcharge and faster scheduling/throughput, not a guaranteed response SLA: [DeepInfra service tiers](https://docs.deepinfra.com/chat/overview#service-tier). The browser priority experiment still failed the requested latency gate.

## Reproduction and test results

Start the candidate without changing saved environment files:

```powershell
node scripts/ragfix-preview.cjs api
node scripts/ragfix-preview.cjs admin
```

These are separate terminals. Wait for the API to finish startup and bind port 8010 before sending requests; startup includes live provider canaries. For the measured priority variant set `RAG_DEEPINFRA_SERVICE_TIER=priority` in the API process environment first. The preview helper sets the two experimental feature flags explicitly. It reads existing private local configuration in memory and prints no credentials. Sign in normally at `http://127.0.0.1:3010/manage`.

The component replay uses a short-lived local-only operator session with the actual current published knowledge and hosted inference. It is separate from the normal browser account test:

```powershell
$env:RAG_AUDIT_QUESTIONS_FILE='tests/fixtures/ragfix-questions.json'
$env:RAG_AUDIT_MAX_MS='10000'
node --experimental-strip-types scripts/replay-admin-payment-audit.cjs http://127.0.0.1:3010 3
```

The final standard-tier complaint replay returned SUPPORTED with one citation in **16,748 ms**, and exited **1** because it exceeded 10,000 ms. The service spent 12,987 ms on two complete-source support calls. Its final answer covered prompt acknowledgment, attempting resolution within five minutes and escalation to management. These are mechanical source checks plus a narrow manual review, not independent certification of all questions or documents.

| Candidate observation | Complete time | Outcome |
|---|---:|---|
| Early batched payment orientation | 23,293 ms | Supported but repetitive; rejected for latency/presentation |
| Token-counted payment overview | 39,650 ms | Supported with citations; rejected for latency |
| Token-counted complaint guidance | 14,479 ms | Supported; rejected for latency |
| Latest standard-tier complaint replay | 16,748 ms | Supported; strict gate exit 1 |
| Normal signed-in browser, priority-tier complaint guidance | Observed complete by 15,329 ms | Useful five-minute/escalation guidance; target not achieved |
| Normal signed-in browser, right-now occupancy | Observed complete by 1,905 ms | Useful current check-ins count matching the dashboard |

Browser times are elapsed observation bounds, not exact HTTP spans. Component times include reading the complete response. Variants differ in batching and prompt organization and must not be pooled into one latency distribution. No p95 or cold-start acceptance is claimed. Embedding variability remained material: one replay spent 9,753 ms in embedding alone. Faster refusals or errors are not counted as successful latency results.

Two intermediate probes reached the local service while it was restarting. Their service errors are retained in artifacts and excluded from useful-answer acceptance. The normal browser also retains an initial startup-time error above the completed complaint answer. No credentials or authentication headers were written to reports, replay logs or screenshots.

Automated validation is recorded in `outputs/admin-rag-audit-2026-10-28/repair-final-tests.log` and `repair-final-build.log`. Typecheck, boundary lint and the full production build passed. The final monorepo suite passed 2,719 tests, with one expected failure and 43 skipped tests across 296 passing files and seven skipped files. Focused Python checks pass 132 tests, including the final distant-omission regression; the RAG repair-specific suite contains four cases.

A final replay against the production build, with the same candidate flags and priority-tier service, still failed the release gate: payment overview timed out at 55,212 ms and complaint guidance returned SUPPORTED at 22,641 ms. The process exited 1. See `production-build-replay.jsonl`. These failures must not be omitted in favor of the faster earlier observations.

The maintainer approved benchmarking and conditional adoption of `Qwen/Qwen3-235B-A22B-Instruct-2507`, then `Qwen/Qwen3.6-35B-A3B`. Neither passed the combined quality and latency release gate. Both remain explicit experimental selections; the saved production default remains Qwen3-32B. The 235B tokenizer at upstream revision `ac9c66cc9b46af7306746a9250f23d47083d689e` has the same SHA-256 as the pinned 32B tokenizer.

### Approved-model results and current candidate

The frozen 12 distinct broad questions are in `tests/fixtures/ragfix-questions.json`. Each component replay uses a fresh question/session, the production Next.js build, current authorized published sources and real hosted inference. Retests use the same exposed questions after changes and are regressions, not an untouched acceptance set.

| Variant and artifact | Result | Release decision |
|---|---|---|
| 235B document model, `approved-model-matrix.jsonl` | 11/12 supported; document replies about 17.7-32.7 seconds | Failed latency and one broad retrieval case |
| Qwen3.6 initial, `qwen36-matrix.jsonl` | All 12 elapsed times below 10 seconds; one capacity refusal and incomplete payment-channel coverage | Failed useful-answer/quality gate |
| Qwen3.6 per-guide draft/compose, `qwen36-multiguide-retest.jsonl` | Three retests about 15.9-40.9 seconds; one proof-budget failure | Rejected approach |
| Qwen3.6 bounded two-pass, `qwen36-bounded-retest.jsonl` | Two embedding errors; two supported answers at 25.6 and 30.0 seconds | Failed availability and latency |
| Qwen3.6 lossless heading inheritance, `qwen36-compact-retest.jsonl` | Three supported retests at 24,446, 24,305 and 22,441 ms | Failed latency; arrival wording still needs review |

The current two-pass path names all selected guides, limits redundant support references, and independently checks every original unit including uncited guides. Repeated headings use the existing inheritance convention, independently reset for each packet. A restoration regression proves this preserves the exact original passage/address/heading association. Payment support input fell from 64,801 to 43,388 reported tokens, but inference still took 18,040 ms; embedding took 3,144 ms. Extension support alone took 14,422 ms. These observations identify external inference and embedding latency as remaining contributors rather than gateway serialization overhead. No universal latency or provider SLA is inferred from these samples.

Payment coverage now includes online administrator review and counter workflows. The arrival answer still presents payment collection without clearly limiting it to unpaid/new bookings, despite stronger instructions and a positive model verdict. A positive model verdict is not independent human acceptance. This remains an unresolved quality concern, not a passed case.

The opt-in gateway batches the original query and its bounded semantic aids in one embedding call, then searches those branches concurrently. Daily-operations wording gets a discovery hint while retaining the original question. Ambiguous pronoun follow-ups defer to the contextual planner. Hosted embedding clients reuse and close their HTTP transport. These seams have direct regressions. The latest focused Python run passes 113 cases. Current typecheck, boundary lint and production build pass. The current monorepo test suite passes 2,722 tests, with one expected failure and 43 skipped tests across 296 passing files and seven skipped files. See the `qwen36-typecheck.log`, `qwen36-lint.log`, `qwen36-tests.log`, `qwen36-python-tests.log` and `qwen36-build.log` artifacts. These static and mocked checks do not override the failed live release gate.

The first full TypeScript run found 12 regressions from enabling guidance routing globally. The shortcut was changed to an explicit opt-in rollout flag and all 112 tests in the affected files passed. This failure is retained in `repair-tests.log`; it must not be confused with the final run.

## Remaining work

### Maintainer-selected architecture repair

After the Qwen3.6 retests failed, the maintainer explicitly chose to keep the approved models and improve the evidence architecture. No further model family is authorized. [The prepared-support contract](PREPARED-SUPPORT-CONTRACT.md) records the implementation boundaries and frozen offline budgets.

The new disabled-by-default path adds source-bound workflow preparation, durable leased jobs, a separately stored versioned index, query-time workflow/dependency expansion and original-text verification. Preparation and serving schemas reject incomplete accounting, fabricated identities and invalid dependency references. The gateway retains final actor/audience/source/epoch checks, now re-reading the exact prepared closure instead of comparing it with an entire document snapshot. Disposable PostgreSQL tests cover lease ownership, idempotence, source withdrawal, audience restrictions, stale artifacts, dependency closure and rollback. The additive prepared schema was installed through the signed-in Supabase SQL editor using the exact versioned migration. Production prepared serving remains disabled. Derived artifacts are being backfilled against actual published internal sources through the local private gateway.

The real-source preparation previews are not acceptance evidence. Some failed output/coverage checks; 32B produced model-verified payment indexes, but manual review still found incomplete allocation dependencies. Those artifacts were not activated. The three-stage compiler separates grouping, scope/dependency review and final independent source audit. The approved 235B model is being evaluated for offline preparation, where its runtime does not add to each chat reply. A preparation model verdict alone cannot establish that the stored graph or a future answer is complete.

The signed-in Supabase session is available through the maintainer's native Brave window, after the maintainer explicitly requested use of their PC browser. The initial read-only schema check confirmed the tables were absent. Migrations `202610280001` through `202610280004` subsequently passed disposable PostgreSQL checks and were applied through that existing session. Migration 002 corrects internal audience discovery/queueing; its regression failed before the fix and passed afterward. Migration 003 provides explicit, audited retries bounded to three attempts and rebuilds on compiler replacement while retaining previous artifacts. No credentials were copied from the browser, no new recipient gained access, and no remote branch or RAG deployment action has been taken.

The speed objective is not solved by this candidate. Even a single full-source draft plus independent full-source verification exceeded the target on the current hosted runtime. Multiple selected guides still require more work, and some earlier intermediate variants returned capacity or context refusals. It is not justified to claim that broader batching alone fixes all eight audited guidance failures.

Next work must demonstrate a faster complete verified path, for example through a separately measured source-preparation architecture or an explicitly approved runtime/model evaluation, while preserving scope, audience, original-source completeness, conditions, independent verification and freshness. Neither faster runtime nor prepared-serving success is established here. Do not activate the candidate or execute the requested push/merge/deployment chain until useful broad questions, held-out questions, role/lifecycle checks and complete-browser response times pass the maintainer's gate.

### Prepared integration checkpoint, October 28

The latest complete application test run passed 2,734 tests, with one expected failure and 43 skips across 297 passing files and seven skipped files. Typecheck, lint, the admin production build, 89 focused Python cases and disposable PostgreSQL lifecycle checks passed. These results precede final serving acceptance and do not establish the latency objective.

Initial preparation rejected customer-only documents because the internal source reader refused them. The source reader correctly preserved the audience boundary. Migration 002 restricts both internal discovery and queueing to internal audiences. Rejected customer jobs cannot make the internal catalog incomplete. No source visibility was widened. Preparation failures remain recorded; only explicit bounded retries are allowed for an unchanged failed compiler. A stopped worker leaves a lease for bounded expiry recovery rather than permitting duplicate concurrent claims.

The first durable object-only corpus reached 12 of 13 internal documents. Map-builder preparation exhausted its bounded attempts on out-of-range original addresses. The source remained published and untouched, and no failed artifact served. The corrected `bounded_schema` transport constrains address-bearing assignment/condition responses while retaining validated JSON-object discovery/audit. Its map-builder canary passed in 84,083 ms, and the fresh fingerprint corpus build remains in progress. This compiler change supersedes earlier ready-count observations. Migration 004 also passed real PostgreSQL regressions for three-missed-heartbeat lease recovery, fresh lease tokens, and resuming cancelled preparation when a document returns to an internal audience. It was applied through the same browser session. Production prepared flags remain off.
