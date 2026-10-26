# RAG latency investigation

Date: October 27, 2026, Asia/Irkutsk. Measurement window: approximately 01:09-01:12 local time (October 26, 17:09-17:12 UTC).

Scope: investigation, report and content-free logs only. No application changes, instrumentation patches, dependency installation, migrations, publication, deployment, restarts or configuration changes. Ordinary synthetic public requests exercised existing admission/control bookkeeping. Existing unrelated working-tree changes were preserved.

Traceability: PRD-F26/F27, SDD-C20-C24, DSD-UI16, ERD-E24-E29, QAD-TC44/45/46, MS-44 and MS-63. The user's subsecond objective is a new investigation target, not an existing accepted SLA. For this investigation, both below 1,000 ms and below 500 ms were evaluated; neither threshold is represented as a product commitment.

## Finding

The public RAG answer path currently takes tens of seconds. Three sequential policy requests returned HTTP 200, kind ANSWER, citations and no limitations in **40,419-44,868 ms**, with a sample median of **42,804 ms**. None completed below 1,000 ms. Repeating the same English request still took 42,804 ms.

RAG precomputes document embeddings, but this implementation still performs query interpretation, query embedding, candidate selection, full-document inspection, answer composition and independent verification during each request. Pre-indexed documents do not make these remaining steps instantaneous. Multiple dependent hosted inference calls are the main confirmed architectural obstacle to subsecond completed answers. Database query execution is not established as the dominant cause.

The deployed embedding endpoint itself varied from **393 ms to 6,576 ms**. Therefore even retrieval preparation is not consistently subsecond. Making vector search faster alone cannot remove the measured 13,157-16,671 ms document-support endpoint.

## Measurements

Target: [customer production website](https://www.thedeskatlas.com). A cookie-backed public session was established, then four query requests were made sequentially with synthetic inputs and fresh request identities. Two policy inputs were identical English requests; the third asked the same subject in Tagalog. The fourth requested private booking information without verification as a control. No private account was accessed.

| Case | Complete HTTP body, ms | Response kind | Citations | Below 1,000 ms |
|---|---:|---|---:|---|
| Initial session | 1,031.627 | ready=true | n/a | No |
| English policy, first | 44,868.159 | ANSWER | 3 | No |
| English policy, repeat | 42,804.214 | ANSWER | 4 | No |
| Tagalog policy | 40,419.071 | ANSWER | 7 | No |
| Private-information control | 1,838.579 | VERIFY_REQUIRED | 0 | No |

HTTP status, citation counts and the ANSWER label are mechanical outcomes, not independent certification of policy accuracy or grounding. Response text, prompts, cookies, credentials and source contents were not persisted. Different citation counts on repeated input are observed metadata, not proof of an error.

Cloud Run request logs recorded the following endpoint durations. Rows are matched by endpoint order and timestamps during the sequential probe window, without an end-to-end propagated trace identifier. They are strong temporal associations, not distributed trace spans.

| Endpoint / remainder | English first, ms | English repeat, ms | Tagalog, ms |
|---|---:|---:|---:|
| Customer plan | 8,858.044 | 2,263.378 | 2,187.325 |
| Customer embed | 392.860 | 6,575.977 | 4,119.871 |
| Customer knowledge selection | 9,331.432 | 6,683.322 | 2,637.420 |
| Customer document support | 16,000.192 | 13,157.039 | 16,671.313 |
| Sum of the four endpoints | 34,582.528 | 28,679.716 | 25,615.929 |
| Client total minus that sum | 10,285.631 | 14,124.498 | 14,803.142 |

The endpoint sum accounts for approximately 63-77% of client time. The remainder is **unattributed**, not a measured database duration. It includes work and waiting outside these endpoint intervals, potentially database/authorization requests, federation, transport, startup/platform admission and gateway execution. Endpoint durations themselves include more than raw provider inference. Do not add nested model timings to these totals.

The first planning call was slower than subsequent calls, but cold-start status was not established. Warm repeat remained slow, so cold-start removal alone is insufficient. The three answer samples do not establish a p95, production SLA, throughput result or controlled cold/warm benchmark.

## Deployed configuration observed

Read using the signed-in Google CLI, with an explicit output allowlist. No secrets were retrieved.

| Property | Observed value |
|---|---|
| Google project / region | deskatlas-rag / us-central1 |
| Serving revision, 100% traffic | deskatlas-rag-chat-production-00006-cw6 |
| Answer provider / model | deepinfra / Qwen/Qwen3-32B |
| Embedding provider | deepinfra |
| Knowledge / customer flags | enabled |
| Container concurrency | 1 |
| Revision maximum / minimum instances | 1 / 0 |
| Service maximum instances | 3 |
| CPU / memory | 2 CPU / 8 GiB |
| Cloud Run timeout | 300 seconds |

The service maximum of three does not cancel the revision maximum of one. Google documents the effective limit as the lesser of those two settings. With all traffic on this revision, the configured normal ceiling is one instance serving one endpoint request at a time. Brief platform exceptions to maximum limits are possible. This is a contention risk, not proof that our sequential probes queued. See [Google's maximum-instance interaction rules](https://docs.cloud.google.com/run/docs/configuring/max-instances) and [concurrency documentation](https://docs.cloud.google.com/run/docs/about-concurrency).

Minimum zero permits scaling to zero. Keeping instances warm can reduce startup delay, but does not eliminate request-time model work. See [Google's minimum-instance guidance](https://docs.cloud.google.com/run/docs/configuring/min-instances). No scaling changes were made.

## Request-path evidence from the checkout

Local HEAD: `65f71e476a7b7ef0110642aed3054f18363232e1`. Source hashes are recorded in the log bundle. Exact deployed-source parity with this checkout was not proven; live endpoint names and observed behavior corroborate the broad path. Findings below describe inspected local code.

| Area | Evidence and latency implication |
|---|---|
| Customer orchestration | `apps/customer-website/src/server/customer-assistant/gateway.ts:166`: plan, then embedding, candidate search, model knowledge selection, whole-document expansion, document support, final source and epoch checks. Several dependencies are sequential. |
| Multiple inference passes | `services/rag/rag/document_support.py:246`: customer intent inference, each document bundle inspected, composition, independent selected-evidence verification, then every original bundle revisited for omissions. Corrections, refinement and unresolved references can add work. |
| Minimum call structure | For B document bundles on a straightforward successful synthesized customer path, support uses 2B+3 model calls. With B=1 this is five calls inside support, plus at least one planner and one knowledge-selection model call outside: at least seven chat calls and one query-embedding call. This is a code-derived lower-bound scenario, not measured per-request call counts. Bundle passes can overlap in pairs; dependent phases cannot all overlap. |
| Work budgets | `services/rag/rag/ms65-budget.json`: 24 bundles, 50 model calls, 50-second document-support deadline. These are ceilings, not actual usage or desired latency. |
| Request control | `packages/server/src/assistant.ts:49`: foreground checks plus a 250 ms background control poll while work runs. Up to roughly four background checks per second when database responses are fast enough; actual query counts were not captured. |
| Repeated authorization | `gateway.ts:112` and `packages/server/src/assistant.ts:102`: checks surround model calls and evidence reads. Final cited-source reads are sequential in the customer path. These are security requirements and possible round-trip costs, not permission to remove checks. |
| Federation | `packages/server/src/cloudRun.ts:18`: token exchange and identity-token generation; the result is reused within a request. Cross-request federation time was not measured. |
| Embedding connections | `services/rag/rag/embedding_provider.py:98`: a new AsyncClient per encode_async invocation; connection reuse across requests is absent in this adapter. Its contribution to observed variability is unproven. |
| Answer transport | `services/rag/rag/answer_provider.py:57`: stream=false. The browser waits for parsed complete JSON before appending the answer (`CustomerAssistantProvider.tsx:181`). Live headers arrived only near completion. |
| Browser overhead | `CustomerAssistantProvider.tsx:153`: public session renewal precedes the query; progress requests repeat every 3,000 ms. Our query timings exclude per-turn session renewal and browser rendering, and did not send browser progress polls. Full user-visible time can be higher. |
| Telemetry gap | Internal gateway has AssistantTiming; customer gateway does not propagate model Server-Timing or add equivalent gateway spans. All sampled public responses lacked Server-Timing. Python already emits numeric timings, but public client measurements cannot access them through this path. |

The admin/staff gateway was inspected at `apps/admin-portal/src/server/assistant/gateway.ts`. It has different deterministic routes, evidence branches, optional synthesis and timing headers. No authenticated admin/staff latency was measured. Customer results must not be advertised as admin/staff measurements. No local Next.js or RAG API was listening on expected application ports during discovery.

## Hypotheses and current disposition

1. **Repeated model work dominates:** supported at endpoint level. Document support alone consistently exceeded 13,000 ms. Exact allocation between provider queueing, model prefill, decoding, individual verification passes and Python scheduling remains unmeasured.
2. **Cold startup dominates:** insufficient as a complete explanation. Subsequent English policy latency remained 42,804 ms. A cold/warm effect may explain part of the first planning duration; no startup trace confirms it.
3. **Database and authorization chatter adds substantial cost:** plausible from code; not isolated by the current measurements. The 10,286-14,803 ms remainder must not be labeled database time.
4. **Single-instance contention inflates traffic latency:** configuration establishes a risk. Sequential tests do not reproduce multi-user queueing. No production load test was run.

## What reaching milliseconds would require

Interpret the goal as a completed, useful, authorized answer below 1,000 ms, with below 500 ms as a stricter candidate target. Reporting a loading message or first token in milliseconds would not satisfy completed-answer latency.

The measured median would require approximately a 43-fold reduction to reach 1,000 ms and an 86-fold reduction to reach 500 ms. Small prompt changes, connection reuse or a faster vector index alone cannot credibly deliver that reduction while retaining the present sequence of model checks.

| Investigation priority | Candidate direction for later work | Constraint |
|---|---|---|
| 1 | Capture public-gateway stage spans and per-model numeric timings, counts and tokens using existing telemetry boundaries | Future instrumentation requires a separate implementation step. Preserve content-free diagnostics. |
| 2 | Evaluate deterministic retrieval of preverified canonical answers for common public policy intents | Best architectural candidate for subsecond hits, but unbenchmarked. Requires a reviewed spec change because existing contracts require question-specific inspection. Bind artifacts to source/version/hash, audience, scope, language, policy conditions and epoch; invalidate on publication/revocation. |
| 3 | Separate static policy answers from live availability, prices and owned booking questions | Live facts still require current authorization and authoritative reads. Never reuse public artifacts for private or transactional claims. |
| 4 | Measure and reduce redundant round trips while retaining final authority, cancellation and source checks | Batch or reuse verified request-local work only where semantically equivalent. Existing poll/control ownership contracts remain binding. |
| 5 | Evaluate warm capacity and concurrency in an isolated environment | Match Cloud Run admission to Python/provider limits. A higher cap alone does not accelerate a sequential model chain. No settings were changed. |
| 6 | Benchmark the remaining dynamic model path with frozen quality and latency cases | Freeform cache misses may still take seconds. Model/provider changes require approval under the dependency/model contract. |

A durable answer cache is not currently an authorized shortcut: MS-44 prohibits caches of questions, answers and source text, and MS-65 requires complete-document applicability checks. A governed published answer artifact would need explicit amended requirements and lifecycle tests. Semantic similarity alone must never authorize reuse across different conditions, roles, audiences or knowledge epochs.

Streaming is a separate presentation option. Emitting unverified answer text before the current verification gates finish would violate the existing release sequence. Even verified streaming would not itself prove faster complete answers.

## Evidence, reproduction and limits

Logs are in `outputs/rag-latency-investigation-2026-10-27/`:

| File | Contents |
|---|---|
| `live-public.jsonl` | Five client observations: HTTP timings, status, kind, sizes/counts and threshold verdicts |
| `cloud-requests.json` | Final twelve endpoint observations, numeric milliseconds, revision and timestamps |
| `cloud-metadata.jsonl` | Allowlisted runtime/scaling metadata and an earlier partial request-log snapshot |
| `summary.json` | Answer sample denominator, median, threshold failures and explicit evidence limitations |
| `source-manifest.json` | SHA-256 hashes of seven inspected source files |

Read-only CLI invocations used included `gcloud run services describe deskatlas-rag-chat-production --project=deskatlas-rag --region=us-central1 --format=json` and `gcloud logging read` restricted to that service's request log, 30-minute freshness, 80-entry limit and selected timestamp/status/latency/path/revision fields. Full configuration output was captured only in process memory and filtered before logging. No auth headers, tokens or provider keys were output.

The latency loop was an inline `python -` invocation using urllib, CookieJar, perf_counter and a 65-second HTTP timeout. It POSTed the existing `/api/customer-assistant/session` and `/api/customer-assistant/query` contracts, fully consumed response bodies, then retained only metadata. It printed explicit below-1,000-ms and below-500-ms verdicts, both false for every answer. The canonical English synthetic subject derives from `services/rag/deploy/check-customer-live.py`; the repeated case used identical input and the language case used the same subject. Prompts and answer text were deliberately omitted from saved artifacts. The loop was run once; three policy answers are preliminary reproduction evidence, not a deterministic latency distribution.

Next validation should separately measure complete-browser rendering, query HTTP time, gateway stages, database calls, federation, endpoint queueing, per-model work and evidence outcome. Use representative English/Tagalog/Taglish held-out cases, explicit cold/warm identity, sufficient samples for tail estimates and controlled concurrency. Include refusals/errors in outcome denominators rather than counting them as fast successful answers. Establish normal admin/staff sessions separately if their latency is in scope.

No implementation regression checks or monorepo build were run because only this report and logs were created. No performance improvement is claimed.
