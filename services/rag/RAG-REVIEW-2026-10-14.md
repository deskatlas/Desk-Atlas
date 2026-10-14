# DeskAtlas RAG implementation review

Date: October 14, 2026. Reviewed the working snapshot based on HEAD `0a1cf6b18fc09ddcb6060130fa8958d97a2c23b8`, including untracked RAG files. This checkout has substantial existing changes, so this is not a review of a clean immutable release. Authority: SPEC-4/5/6, MS-44, PRD-F26/F27, SDD-C20 through C24, ERD-E24 through E29, QAD-TC44 through TC46. No application implementation, source publication, deployment, or application database changes were made.

## Verdict

The architecture follows sound RAG engineering practices, but the current implementation is not sufficiently verified for production acceptance. It is a credible local implementation with reproducible ingestion defects and incomplete release evidence. There is no universal industry-standard RAG certification; the meaningful criteria are access isolation, source fidelity, answer quality, recoverability, and measured operating capacity.

The pinned encoder and exact cosine search are appropriate choices. A vector database replacement, HNSW, hybrid search, reranker, or agent framework is not automatically necessary. Make those decisions from measured retrieval errors and query cost.

## Pipeline inspected

| Stage | Actual implementation | Assessment |
|---|---|---|
| Upload | Admin gateway creates private version-specific upload paths and signed transfer authorization | Appropriate separation; explicit-removal cleanup has an outstanding-token race to verify |
| Durable work | PostgreSQL jobs, leases, heartbeat, generation fences, retry and notices | Good foundation; terminal claim response contract is inconsistent |
| Extraction | Isolated Docker parser, DOC conversion, DOCX/Markdown/PDF parsing and per-page OCR | Strong isolation design; blank-page and partial-scan handling need correction; real container acceptance remains open |
| Chunking | Qwen tokenizer, headings, restriction prefix, overlap, maximum 800 tokens | Explicit bounds are good; restriction aggregation rejects small valid documents |
| Embedding | Pinned offline Qwen3-Embedding-0.6B, query-only instruction, document encoding, normalized 1024-dimensional vectors | Consistent with Qwen guidance; complete fingerprint and weight checks are strengths |
| Publication | Complete manifest required for READY, explicit admin review and Publish, atomic active-version replacement | Appropriate lifecycle; deployed storage/pgvector integration is not established by unit tests |
| Query ingress | Same-origin checks, signed identity/current profile, actor-scoped availability, bounded ephemeral state | Strong access boundary; coordination is process-local and ingress precedes configured request deadline |
| Planning/tools | Typed model plan plus deterministic shortcuts, domain and SQL allowlists, aggregate-only tools | Good separation: the model cannot authorize reports or mutate bookings |
| Retrieval | Scope, audience, current publication, generation and fingerprint filters; exact cosine top 12; up to six complete evidence chunks within byte budget | Reasonable initial design; threshold and evidence budgets need representative calibration |
| Answer | Model selects exact passages; compact path adds a separate support verdict; gateway validates exact substrings | Strong provenance; does not prove semantic completeness, safe procedures, or correct translation |
| Release | Final identity and source/epoch checks, strict output schema, session-only UI context | Sound revocation and disclosure controls; release evaluator does not bind answer observations to the candidate |

## Findings

### R1 - P2: valid short SOPs fail chunking

Location: `services/rag/knowledge/chunk.py:18-23`. Trace: SPEC-5 Section 5, SPEC5-TC16.

Every section line containing words such as `staff`, `admin`, `must`, or `before` is copied into the mandatory context prefix. A prefix of 200 tokens is rejected before normal chunk assembly. Using the actual pinned Qwen tokenizer, twenty paragraphs of `Staff must verify booking rule number {i} before changing the desk status.` contain only 291 source tokens, but `chunk_sections` raises `RESOURCE_LIMIT`. The complete document would fit inside one 800-token chunk.

This is an ordinary SOP-shaped input, rather than an oversized upload. Resource retries cannot fix the same deterministic content rejection. Preserve permission context locally, avoid duplicating every procedural line into a global prefix, and test multi-step and multilingual procedures with the real tokenizer.

### R2 - P2: one blank PDF page fails the entire document

Location: `services/rag/knowledge/extract.py:170-171`. Trace: SPEC5-TC03/16.

Each PDF page must produce nonempty text after OCR. A useful PDF containing a blank separator or final page raises `EMPTY_TEXT` and never reaches review. Reproduced with a synthetic PDF and successful OCR returning empty text for the blank page. This reproduces control behavior, not a full real-Docker OCR acceptance run.

Distinguish a demonstrably blank page from unreadable nonblank content. Preserve page provenance and warnings, and reject an entirely empty document. Do not silently skip unreadable scans.

### R3 - P2: quality observations are not tied to a candidate revision

Location: `services/rag/rag/evaluation.py:76-100`. Trace: SPEC6-TC11.

The evaluator checks candidate revisions on aggregate operational gates, but never checks a candidate revision or run identity on individual answer/retrieval observations. In an in-memory reproduction using the existing synthetic complete-evidence fixture, release readiness remained true after changing the candidate revision and all evidence-envelope revision labels while leaving every observation unchanged. Observations did not contain a candidate revision at all.

Bind each observation to the tested candidate, model/encoder/configuration fingerprint, corpus version and evaluation run. Reject missing or mismatched identities. The current result is an evidence-validation weakness, not evidence that an actual deployment occurred. The same fixture also passes with just five load samples; that is insufficient to establish MS-44's twenty synchronized five-request batches or useful tail-latency confidence.

### R4 - P2: text-bearing scanned pages can lose their scanned body

Location: `services/rag/knowledge/extract.py:150-154`. Trace: SPEC5-TC03.

OCR fallback depends on extracted alphanumeric count and replacement characters. A page with a readable header containing at least twenty alphanumeric characters and a scanned procedure body bypasses OCR even though the image body has no extracted text. The resulting document can proceed with incomplete evidence. This follows directly from the branch condition; a full real mixed-content PDF integration reproduction remains required.

Evaluate text/image coverage within pages, rather than treating the presence of a readable header as complete extraction. Add fixtures containing text headers plus scanned bodies, diagrams and tables. Whole text pages mixed with separate scanned pages do not cover this case.

### R5 - P2 integration risk: removal can finish before upload authorization expires

Locations: admin knowledge route `:40`, internal knowledge jobs route `:38`, migration 016 `:159` and `:257`. Trace: SPEC5-TC13/14.

The abandoned-UPLOADING reconciler waits for the provider's two-hour upload-token grace period, but explicit removal queues purge immediately. Purge clears retained object paths after deleting objects. An unused signed upload authorization obtained before removal can potentially create bytes after that purge succeeds. The version is already REMOVED, the purge is SUCCEEDED, and the object keys are null, so normal reconciliation cannot find the late upload.

Logical retrieval revocation remains intact. This is a source-erasure/orphaned-storage risk, not an established staff data disclosure. The code ordering and cleanup gap are verified statically; provider token behavior after deletion must be exercised with a synthetic integration test. Retain tombstone paths and schedule a final idempotent deletion after every issued upload authorization has expired, or use provider-supported revocation.

### R6 - P3: exhausted claims return the wrong response shape

Locations: migration 016 `:223-225` and `:273`; internal knowledge jobs route `:29-30`; worker `:173-181`. Trace: SPEC5-TC07/08.

The sixth expired claim terminalizes the job and returns `{job_id, accepted}` instead of null or the `{job, version}` claim envelope. The internal route dereferences `result.data.job.kind`, producing a caught HTTP 500. The worker converts it into `GatewayError`, waits ten seconds, and resumes polling. The job has already been marked FAILED with its notice.

An isolated `process_claim` call would raise `KeyError`, but the real gateway intercepts this first. The reviewed pipeline does not therefore establish a worker crash. Return a consistent no-work/terminal outcome, validate it at the gateway, and add an integration regression for exhausted leases.

## Correctness and security strengths

- The gateway verifies signed custom sessions or Supabase JWTs and current active profiles. Browser role assertions do not authorize tools.
- Staff historical/financial reporting is independently denied in Python planning, domain policy and SQL. Database tools are allowlisted, parameterized, aggregate-only and read-only.
- Source eligibility is checked before model context: scope, audience, current active publication, generation, tombstone and embedding fingerprint.
- READY is not searchable. Publication and replacement require explicit admin review and complete manifests; removal invalidates current retrieval.
- Final answers recheck identity, current source hashes and catalog epoch before returning evidence. Quotes must exactly match authorized source content.
- Parser invocation uses argument arrays, network isolation, a nonroot read-only container, and CPU/memory/PID/scratch/time bounds. Python receives narrow worker authority rather than Supabase service-role credentials.
- Model revisions, embedding runtime compatibility, model weight hashes, finite vectors and normalization are checked. No silent query-encoder fallback is present.
- Cancellation, bounded admission, strict schemas and metadata-only timing are implemented. No application response cache or persistent transcript is used.

No unauthorized guest disclosure, arbitrary SQL execution, or assistant booking mutation was established in this review. Static access controls and passing synthetic tests do not establish deployed RLS/storage acceptance.

## Performance analysis

The current answer path is more expensive than a single generation: ordinary document questions can require planner generation, embedding, retrieval, passage selection, and a second generation for support checking. The exact SOP grammar can skip planning. Six selected citations can also require six sequential final source reads. Repeated profile/catalog checks are deliberate security work and must be measured before optimizing them.

The gateway admits up to five active requests per process and Python uses two inference slots. Ollama has its own queue and parallelism. These limits do not establish five concurrent model generations or acceptable five-user p95. Increasing slots can increase memory pressure and tail latency. Check actual model parallelism, context allocation, queue time, residency, cancellation-to-capacity-release and ingestion interference together.

Availability SQL in migration 017 counts chunks, hashes content and recomputes manifests for eligible versions. `EXISTS` can stop at the first eligible version, so this is not necessarily a scan of the whole catalog, but its work still grows with the candidate document contents and failed candidates. It runs on ingress and final availability checks. Measure its plans and p95 as document size grows; consider transactional verified-manifest state only if the same integrity and revocation guarantees remain intact.

Exact vector search is appropriate for a small corpus. HNSW is a conditional optimization; filtered approximate search can reduce recall. The current top-12 retrieval, top-six evidence and byte cutoff need evaluation on real-sized chunks, UI labels, conflicting rules, held-out paraphrases and language-specific relevance thresholds.

The 55-second gateway deadline starts after authorization, initial availability and body parsing. It does not bound the entire request. Global process-local Maps also mean admission, progress, cancellation and internal callbacks do not coordinate across workers or replicas. A single-instance/sticky deployment contract or metadata-only cross-instance coordination is required before horizontal scaling.

### Current synthetic component measurements

Thirty serial requests to the existing loopback Ollama runtime exercised the actual compact answer-selection and support-verdict functions after one excluded warm-up. The pinned `qwen3:4b` digest was `359d7dd4bcdab3d86b87d73ac27966f4dbb9f5efdfcc75d34a8764a09474fae7`; GPU layers were requested with `-1` and residency with `keep_alive=-1`. Each language used a paraphrase of one synthetic SOP responsibility question and the same tiny synthetic English source. All thirty returned the expected exact supported sentence. This checks evidence selection across question languages, not translated answers or representative procedural completeness.

| Group | Samples / valid | p50 | p95 |
|---|---|---|---|
| Combined | 30 / 30 | 1267.6 ms | 1408.2 ms |
| English | 10 / 10 | 1236.3 ms | 1310.2 ms |
| Filipino | 10 / 10 | 1307.4 ms | 1415.5 ms |
| Taglish | 10 / 10 | 1258.8 ms | 1296.3 ms |

Post-run `/api/ps` confirmed that the matching pinned digest was resident with 5,098,103,111 bytes of VRAM allocation and a 16,384-token context. This allocation is runtime metadata, not a measurement of total system peak memory.

These nearest-rank percentiles exclude planning, encoder initialization/embedding, database retrieval, identity/publication checks, browser rendering, cold loading and concurrent actors. Ten observations per language provide only exploratory tail estimates. Shared local runtime activity and resident prompt-prefix reuse are not controlled. They do not establish the gateway target or production capacity. Numeric-only output is saved in ignored `services/rag/benchmark-results/rag-review-component-2026-10-14.json`; no question, answer, source text or credentials are in that result artifact.

### Earlier evidence, not rerun acceptance

`MS44-EVIDENCE.md` records one authenticated baseline of 41.689 seconds and a later thirty-request warm repeated-FAQ series with browser p50 2.094 seconds and p95 2.271 seconds, plus a separate fresh-context request of 6.135 seconds. These are historical measurements for one specific SOP question and a local profile. They do not certify cold startup, representative multilingual questions, five actors, ingestion interference or the present working snapshot.

`EVIDENCE.md` records a tiny 24-source synthetic retrieval corpus with recall@6 of 1.00 over nineteen answerable questions. This is a useful smoke test, not calibrated production recall; document-type labels do not exercise actual file extraction.

## Checks executed in this review

| Check | Actual result | Limit |
|---|---|---|
| `pnpm typecheck` | Passed | Shared-package scripts are placeholders; app compiler checks do run |
| `pnpm lint` | Exit 0 | Echo placeholders; no substantive lint acceptance |
| `pnpm build` | All four applications passed, Next.js 16.3.2 | Build success does not exercise deployed assistant service or database |
| `pnpm test` | 221 files passed, one failed; 1960 tests passed, one failed, two skipped | Failure at `tests/spec2-campaigns-and-rewards.test.ts:327`, SPEC2-TC05, outside RAG; no pre-review full-suite baseline claimed |
| Service Python tests | 33 passed | `test_assistant.py` plus `test_ms44.py`; one Starlette/AnyIO deprecation warning |
| Ingestion/operations Python tests | 51 passed | `test_operations.py` plus `test_knowledge_ingestion.py`; reproduced cases above are missing coverage |
| Real local model smoke | All six cases passed | Grounding, exclusive owners, permissions, unsupported question, injection and role limit; synthetic component checks |
| Disposable PostgreSQL lifecycle script | Passed | Isolated temporary PostgreSQL; test array-backed vector domain |
| Disposable PostgreSQL availability script | Passed | Audience/scope/integrity/replacement/revocation/rollback; does not verify real pgvector or deployed storage/RLS |
| Release evidence probe | Reproduced R3 | In-memory synthetic fixture; no live release or data changes |
| `git diff --check` | Passed | Existing tracked working diff only |

Initial sandbox commands could not resolve installed Node dependencies, and sandbox Python attempts stalled. They were rerun successfully with normal local access; stalled review-owned Python sessions were interrupted. No dependencies were installed.

## Required next work

1. Fix and regression-test R1/R2/R4 so valid procedures survive ingestion without losing scanned content or safety conditions. Repair R6's claim envelope.
2. Verify and close R5 using isolated storage fixtures. Test actual pgvector, RLS, publication/removal races and container OCR/conversion, rather than substituting the test vector domain.
3. Bind evaluation observations to immutable candidate/model/config/corpus/run identities. Ratify thresholds before evaluation and enforce required sample/batch counts.
4. Run representative held-out English, Filipino and Taglish cases through authenticated gateways. Review completeness, prerequisites, negation, contradictions, poisoned evidence and unsupported questions. Exact substring validation and a same-model support verdict are not independent semantic proof.
5. Measure thirty repeated and thirty representative requests per language, five controlled cold runs, twenty synchronized five-actor batches, ingestion interference and actual cancellation recovery. Report valid-answer p50/p95 alongside every refusal, failure, timeout and rejection.
6. Document the production topology and coordination constraints; verify image reproducibility, runtime readiness, memory peaks, privacy settings, recovery and operator procedures. Keep production acceptance withheld until the evidence supports it.

Extractive answers preserve provenance but do not translate source prose. English-only sources consequently produce English quotations even for Filipino/Taglish questions; tool narratives and generic fallbacks are also English. Treat language understanding and language-appropriate answers as separate acceptance criteria under SPEC-4, without weakening exact evidence validation.

## Primary references

- [Qwen3-Embedding-0.6B model card](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B): query instructions, normalized embeddings, supported dimensions and model interface.
- [pgvector documentation](https://github.com/pgvector/pgvector): exact search, approximate-index tradeoffs and filtering behavior.
- [OWASP RAG Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/RAG_Security_Cheat_Sheet.html): permissions, ingestion trust and source lifecycle.
- [OWASP Prompt Injection Prevention](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html): indirect injection, least privilege and layered validation.
- [Ollama concurrency FAQ](https://docs.ollama.com/faq#how-does-ollama-handle-concurrent-requests): runtime queues, parallelism and context-memory demand.
- [RAGAS research paper](https://arxiv.org/abs/2309.15217): separate retrieval, faithfulness and answer-quality evaluation. This review does not require installing Ragas.

Companion source research: `docs/reviews/rag-primary-source-research-2026-10-14.md`. That directory is ignored by this repository; this main review is stored alongside the service's existing evidence documents.
