# MS-44 implementation and local verification

## Measured FAQ follow-up: October 14, 2026

The user's SOP responsibility FAQ was reproduced through the signed-in staff UI on the actual published corpus. A complete cited baseline took 41,688.8 ms in the browser (gateway 41,671.9 ms): planning 4594.5 ms, embedding 288.1 ms, retrieval 255.8 ms, answer selection 35,369.2 ms. This is one baseline observation, not a baseline percentile.

The final local profile keeps the same pinned `qwen3:4b` digest and query encoder, exact-source expansion, staff authorization, published visibility, epoch checks and final source reads. It selects short passage indexes, deduplicates only identical evidence/repeated headings while retaining source mappings, and uses the installed RX 6650 XT through an isolated Vulkan-enabled Ollama at `127.0.0.1:11435`. The original server at 11434 is untouched. Actual GPU residency was verified through `/api/ps` (5,098,103,111 bytes in VRAM). Installed Ollama is 0.40.3. No model, dependency or driver was downloaded or installed.

| Profile | Samples | Complete-answer result |
|---|---|---|
| Original CPU gateway | 1 | 41.69 seconds; expected owner and citations |
| Compact IDs, CPU, before lossless deduplication | 1 | 24.38 seconds; prompt evaluation 18.70 seconds; concurrent TypeScript verification makes this an exploratory observation |
| Compact/deduplicated context, CPU | 1 | 14.75 seconds; 760 input tokens, 27 generated tokens |
| Compact/deduplicated context, GPU, initial gateway probe | 1 | 4.83 seconds; same 760 input/27 output tokens; all selected citations revalidated |
| GPU candidate before final support-check hardening, fresh chat each time | 30 | 30 expected-owner answers with citations; complete-render p50 1.987 seconds, p95 2.285 seconds, maximum 3.020 seconds |
| Final GPU selector with conflict guard and independent support check | 30 | 30/30 expected-owner answers with citations; complete-render p50 2.094 seconds, p95 2.271 seconds, maximum 2.463 seconds |
| Final selector, first fresh-context request after preload | 1 | 6.135 seconds browser response; 6.115 seconds gateway; expected complete FAQ answer and citation |
| Filipino paraphrase through normal planner | 1 | 7.45 seconds, complete cited expected-owner answer; separate smoke observation, not multilingual acceptance |
| Taglish paraphrase through normal planner | 1 | 5.69 seconds, complete cited expected-owner answer; separate smoke observation |

Warm complete-render durations in milliseconds, in request order: 2285.4, 1949.2, 2143.9, 2011.2, 2019.0, 2268.2, 2116.6, 1963.0, 1903.1, 2075.1, 1918.3, 1919.5, 2038.0, 1902.6, 2003.2, 2003.4, 3020.1, 1961.2, 1966.0, 1987.3, 1927.1, 1882.5, 1853.1, 1848.0, 1959.1, 1992.4, 2075.4, 2002.9, 2007.0, 1971.3. Nearest-rank percentiles; 30 distinct request IDs and 30 matching render measurements. Each iteration closed/reopened chat, submitted the same question through normal UI authentication, checked the complete expected FAQ sentence and presence of citation buttons, and collected numeric request/render timing. The gateway independently validated exact quotes and reread selected current sources. One browser automation wait error occurred after a completed request; its 3.020-second sample was recovered from the matching completion event and included. No application error/refusal was counted as a successful answer.

These are local development, single-staff measurements on the user's permitted published SOP, not a synthetic five-user load/release evaluation. Normal Ollama inference internals may reuse a resident prompt prefix; no application question, answer, evidence, embedding or transcript cache was added. A new-language planner/context required a fresh prefill and is reported separately. Arbitrary questions, concurrent users, cold machine startup and ingestion interference are not certified under ten seconds.

The existing approved HF 0.6B candidate was evaluated offline on seven synthetic language/evidence cases. Its structured outputs failed the checks and it was rejected. Its temporary adapter was removed. The pinned 4B model remains selected. The model experiment comparing copying a short synthetic quote with index output measured 25.72 and 4.03 seconds respectively; those isolated runs are not gateway acceptance evidence.

Final model-quality follow-up added required conflict output, explicit same-task permission-conflict rejection, and an independent small support verdict before releasing selected quotes. Actual-model synthetic smoke testing caught and drove these changes: the compact selector had merged one permission contradiction and selected unrelated text for a missing refund amount. The final real-model smoke command passed grounded answers, exclusive-owner conflicts, permission conflicts, unsupported questions, source injection, and preserved role limits (six cases). These are component checks, not full release acceptance. Python regression controls passed 33 tests and existing SPEC5/6 controls passed 51. The final full Vitest run had 1960 passes, two skips and the unchanged SPEC2-TC05 rewards-schema failure; typecheck, lint and production build passed.

The staff assistant session expired with HTTP 401 during the investigation. The user renewed it through the normal UI, then a new final 30-request series was measured with all final safeguards active. There were 30 distinct request IDs, 30 matching complete-render events and 30 expected complete FAQ sentences with citations. No failed/refused answer was included as a valid result. Temporary numeric diagnostics were removed after recording measurements. The exact FAQ met the warm single-user target; this does not certify arbitrary questions, cold startup, multilingual quality or five-user performance.

Final complete-render durations in milliseconds: 2271.1, 2150.4, 2188.3, 2068.1, 2035.3, 2151.7, 2463.1, 2164.6, 2068.7, 2123.7, 2041.9, 2094.1, 2042.9, 1974.5, 2119.9, 2005.3, 2036.5, 2052.4, 1968.6, 2137.5, 2069.0, 2205.8, 2080.1, 2108.4, 2183.2, 2111.0, 2093.8, 2012.2, 2133.6, 1968.4. Nearest-rank p50 2093.8 ms, p95 2271.1 ms, maximum 2463.1 ms. The initial fresh-context 6134.8-ms request is separate from these warm percentiles.

```powershell
services/rag/.venv-service/Scripts/python.exe services/rag/selection_smoke.py --gpu
```

Local activation and reproduction:

```powershell
services/rag/.venv-service/Scripts/python.exe services/rag/serve_local.py --gateway-env apps/admin-portal/.env.local --gpu
```

Run from the repository root after stopping only the previous local RAG service on port 8000. The launcher reuses existing gateway credentials without printing them, starts/reuses the installed private Vulkan runtime on 11435, preloads the pinned model before accepting service requests, verifies actual GPU residency, and keeps the model resident to avoid idle eviction. It requires no global environment/driver changes. The local gateway files have `RAG_SOP_FAST_PATH=true` for the measured standalone FAQ grammar; conversational/ambiguous/mixed queries retain planning. CPU comparison remains available with `RAG_MODEL_GPU_LAYERS=0`, `RAG_MODEL_KEEP_ALIVE=10m`, `RAG_PRELOAD_MODEL=false`, and `OLLAMA_URL=http://127.0.0.1:11434`, launching without `--gpu`. Set `RAG_COMPACT_SELECTION=false` to restore the original quote-copying selector. Oversized paragraphs automatically retain the original extraction contract, preserving full evidence rather than silently truncating it.

The GPU choice follows the installed runtime and [official Ollama Vulkan documentation](https://docs.ollama.com/gpu). The subprocess is hidden and loopback-only. Startup time, GPU model loading and encoder initialization are outside warm percentiles; preloading is readiness work, not a claim that cold startup is free. The whole production-release and five-user gates below remain open. Earlier interrupted-probe notes below are historical and do not supersede this completed follow-up.

## Previous delivery record (before the measured follow-up)

Date: October 14, 2026. Authority: [MS-44](../../docs/milestone/ms44.md), PRD-F26, SDD-C20 through SDD-C22, QAD-TC44/46.

Status: implementation delivered; authenticated performance and multilingual acceptance remain pending. No model replacement, threshold change, publication, database mutation, production activation, or deployment is included.

## Changes

1. The shared gateway emits request-local `Server-Timing`, `X-Request-ID`, numeric model token counts, and queue time when upstream measurements are present. It measures authorization, validation, catalog/availability, settings, planning, embedding, retrieval, tools, answer selection, final evidence RPCs, serialization, and residual time. Missing Python queue measurements are omitted rather than reported as zero. Nested Python durations must not be added to their gateway parent spans.
2. Python emits admission-to-response timing, inference-slot queue time, model digest verification, HTTP inference, schema validation, and Ollama load/prompt/generation durations and token counts when supplied. Credentials, prompts, source text, vectors, questions, answers, and rows never enter these headers or shared telemetry state. Encoder initialization occurs at startup; it is not falsely counted as a warm request measurement.
3. `RAG_SOP_FAST_PATH=true` enables a deliberately small exact grammar for standalone English, Filipino, and Taglish procedures, including the user's question, "According to the SOP, what is the check-in procedure?" Conversation context, extra clauses, mixed requests, and unrecognized wording fall back to planning. This shortcut selects document retrieval only. It cannot answer from memory, execute business tools, or authorize a staff action. The default is false because equivalent runtime measurements are incomplete.
4. Empty authorized retrieval skips answer generation and retains the explicit evidence gap plus final identity/catalog checks. Truncated model output fails closed even if its partial JSON parses. No source threshold or full-chunk context budget was weakened.
5. `RAG_PLAN_MAX_TOKENS` and `RAG_ANSWER_MAX_TOKENS` are independent experimental controls, bounded to 128 through 2400. Both default to the original 1200. Keep the baseline pinned CPU `qwen3:4b`, context 16384, temperature zero, ten-minute residency, two inference slots, and five admitted service requests. No unmeasured thread/residency/model tuning was adopted.
6. Direct ASGI cancellation replaces the previous `call_next` wrapper. Disconnects and deadlines cancel queued/active handlers and their awaited model HTTP calls. Native embedding threads cannot be interrupted: their slots remain occupied until they finish, preventing hidden concurrent CPU work. Their real remaining execution time and Ollama's actual stop latency are pending measurements, not proven bounded cancellation results. Late answers remain blocked by gateway/session checks.
7. The assistant dispatches a content-free `deskatlas:assistant-timing` browser event after a validated answer commits and an animation frame runs. It contains only request ID and numeric dispatch, transport, parse/validate, render and complete timings plus gateway duration. It does not store a transcript or claim to measure physical screen paint. Close/logout suppress pending events.

## Local evidence and limitations

The normal-permission environment check found local listeners at staff 3003, admin 3000, Python 8000, and Ollama 11434. The sandbox-only port check could not establish their absence. Hardware: AMD Ryzen 5 5600, six cores/twelve logical processors, approximately 32 GiB visible RAM. The checked installed framework was Next.js 16.3.2. Before editing framework-facing code, the bundled `next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` was read: handlers use Web Request/Response, and response headers are set through those APIs. Python service tests used the existing isolated Python 3.12.14 environment; SPEC5/6 controls used the existing Python 3.10.11 evaluation environment.

The user signed into the connected staff browser and the exact reported question was submitted through the UI. During that request, concurrent MS-45 changes added availability gating and rewrote the same gateway/launcher files. The assistant disappeared before a complete grounded result could be inspected. This interrupted attempt is not a baseline, valid-answer latency, timeout attribution, or percentile sample. No transcript/token was exported. The MS-45 changes were preserved, and regression fixtures were adapted to their actor-scoped availability check.

| Profile | Before | After | Acceptance |
|---|---|---|---|
| User observation | Approximately 30 seconds, unknown conditions/count | Not comparable | Investigation lead only |
| Authenticated UI probe | One interrupted attempt; zero validated complete samples | No equivalent comparison | Pending stable gateway/corpus |
| Warm identical question, 30 samples | Not established | Not established | Below-10-second p95 not claimed |
| Representative English/Filipino/Taglish, 30 each | Not established | Not established | Quality and latency review pending |
| Five users, 20 synchronized batches | Not established | Not established | Five distinct active test actors and synthetic corpus required |
| Five controlled cold starts | Not established | Not established | Reset method and startup/load attribution pending |
| Ingestion interference | Not established | Not established | Separate controlled run required |

The reported 3.8/2.2/11.7-second synthetic stage values are not reclassified as measurements from this implementation. No claim is made that generation explains the roughly 30-second observation.

## Reproduction

Keep the same hardware, app mode, corpus, actor permissions, and model revisions across baseline and experimental runs. Stop unrelated builds and ingestion for the idle profiles. Do not reset databases or publish documents to make a benchmark pass.

Use a private synthetic case JSON file in ignored `services/rag/benchmark-results/`. Each case requires `synthetic: true`, `language` (`en`, `tl`, `taglish`), `question`, and `expected` (`answer`, `gap`, `conflict`, `forbidden`). Answerable cases also require `required_quotes` containing every required prerequisite/exception/negation/role limit and `version_ids` for the currently published permitted evidence. Use several topics and held-out paraphrases. Supply existing test-session Bearer authorizations through `RAG_BENCHMARK_AUTHORIZATIONS` as a JSON array; never place tokens in commands, case files, output, or chat. Five-user profiles require five distinct test actors, not five sessions for the same actor.

```powershell
pnpm test:ms44
pnpm test:ms44:python
services/rag/.venv/Scripts/python.exe -m pytest services/rag/tests/test_operations.py services/rag/tests/test_knowledge_ingestion.py -q
pnpm rag:gateway-benchmark --cases services/rag/benchmark-results/cases.json --profile repeat --app-mode development
pnpm rag:gateway-benchmark --cases services/rag/benchmark-results/cases.json --profile representative --app-mode development
pnpm rag:gateway-benchmark --cases services/rag/benchmark-results/cases.json --profile five --app-mode development
pnpm rag:gateway-benchmark --cases services/rag/benchmark-results/cases.json --profile ingestion --app-mode development
pnpm rag:gateway-benchmark --cases services/rag/benchmark-results/cases.json --profile cold --app-mode development --reset-description "Documented local process/model reset"
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

The cold command measures one attempt with no warm-up. Perform at least five controlled resets/runs and record exactly what restarted, distinguishing encoder startup, model loading/eviction and development compilation. The ingestion profile only labels the workload; separately document and measure the actual ingestion job, resource use and contention. The harness never starts ingestion, publishes evidence or resets processes.

If pnpm tries to bootstrap its own version in a restricted environment, set `$env:npm_config_manage_package_manager_versions='false'` for these commands to use the installed pnpm. No dependency installation is needed.

The harness explicitly warms up non-cold runs, synchronizes each five-user batch, validates the document result contract and required exact restrictions, independently rereads current authorized citations, and reports all attempts/outcomes plus separate valid-answer nearest-rank p50/p95, language groups, batches, stage counts and numeric token observations. Citation reads are outside query latency and timed separately. Missing stage timings make the harness incomplete. Forbidden or insufficient-evidence results cannot improve valid-answer percentiles. Human multilingual semantic review, full revocation/security evaluation, browser/gateway reconciliation and runtime cancellation/resource measurements remain separate gates. `release_evidence` stays false.

For browser attribution, attach an in-memory listener to `deskatlas:assistant-timing` before submitting through the assistant. Compare `complete_ms` with `gateway_ms`; do not subtract wall clocks from different processes. Avoid printing or exporting requests, answers, sources or credentials. The event is emitted only for a complete validated answer; capture errors/cancellations separately.

## Verification record

- Focused TypeScript tests passed: 53 tests after adapting the shared MS-45 availability seam. They cover routing/fallback, complete exact restrictions, empty/invalid/conflicting selections, role denial, final source revocation, and safe timing.
- Python API/cancellation/benchmark controls passed: 21 tests. Existing SPEC5/6 Python controls passed: 51 tests. These tests prove control behavior with synthetic model/evidence adapters; they do not establish live inference latency or language quality.
- `pnpm typecheck`, `pnpm lint`, and `pnpm build` passed during implementation. The lint script checks only packages with registered lint commands and is not a claim that every app was linted.
- The final full Vitest run reported 220 passing files and one failing file: 1953 passes, two skips, one failure in `tests/spec2-campaigns-and-rewards.test.ts:327`, `SPEC2-TC05`, where an invalid reward fixture is accepted. The campaign schema and this test are unchanged from HEAD. No pre-change full-suite run was available; this is an out-of-scope failure, not a proven clean baseline.
- Final focused checks, typecheck and the full production build passed after MS-44 edits. Concurrent MS-45 work means the shared working tree is not an immutable benchmark/build revision. This repository ignores `docs/`; the local specification status updates and companion link consequently do not appear in the normal Git diff. This service-local record is included in the normal source file inventory.

## Rollback and remaining work

Set `RAG_SOP_FAST_PATH=false` in both gateway applications to restore model planning for the experimental grammar. Restore/remove the two token budget variables to retain 1200 each. Restart only the affected local process through its existing launch mechanism after changing runtime variables; a running non-reloading Python process does not pick up source edits automatically. No timeout increase, new model, index rebuild, schema migration, or content cache is part of this milestone.

Before declaring MS-44 performance acceptance, restore a stable actor-scoped published corpus/gateway, establish the required before/after samples with exact configuration/resource records, run the held-out quality/security cases and real cancellation-to-capacity-release probes, and record adopted/rejected experiments. Keep the fast path disabled until those results justify enabling it. Production release remains separate.
