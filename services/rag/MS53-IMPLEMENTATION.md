# MS-53 implementation and acceptance record

Date: October 15, 2026. Authority: `docs/milestone/ms53.md`, PRD-F26/F27, SDD-C20 through C24, DSD-UI16/UI17, ERD-E24 through E29, QAD-TC44/45/46.

The user authorized application implementation after the original planning-only milestone was written. Existing uncommitted work was preserved. No live database migration, document upload/publication, model replacement, dependency installation or production deployment was performed.

## Delivered changes

- Natural task questions use bounded task-word normalization and broader document-only routing. Semantic retrieval remains authoritative; wrong-intent negatives retain their distinct routes. No checkout answer is hardcoded.
- Evidence selection now handles serialized context overflow as well as source-count overflow. Bounded batches of candidates are expanded through the existing complete-context RPC. Whole-generation integrity, dependency closure, actor authorization and final epoch/source checks remain required.
- Complete evidence packing splits long lists at source-backed boundaries within the existing six-quote and 1,500-character limits. Every covered character remains an exact source substring. Genuine oversized evidence still fails safely. Independent final source reads run concurrently.
- Optional `evidence_spans` bind each displayed extract to a canonical chunk and exact UTF-16 source offsets. The shared assistant renders inert semantic headings, lists, emphasis and code, retains scope-bearing labels, and preserves literal punctuation. Canonical sources and hashes remain unchanged. Admin and staff use the same renderer.
- Human-readable retrieval times use `business_timezone`; live report time and freshness warnings remain visible. Technical limitation codes move to optional diagnostics.
- Parser/chunker v5 prepares ordinary headingless text as a conservative complete-document support unit with paragraph/list/table/page boundaries retained. It does not guess that a paragraph proves local policy scope. Large headingless sources can still exceed answer budgets; splitting them into guessed independent policies is unsafe.
- Clear structured documents receive prepared review choices. Uncertain policy applicability, OCR, unknown structure and unresolved references require focused review. Migration `022_ordinary_document_review.sql` binds document approval to exact source/content hashes, structural manifest, generation and audience. New unresolved generations and unsupported Word omissions cannot publish as verified. Explicit publication, atomic predecessor cutover, durable jobs and revocation remain intact.
- The gateway benchmark validates optional presentation spans against current authorized canonical source text, including UTF-16 offsets. `ms53_acceptance.py` separately evaluates content-free submit-to-complete-render measurements bound to a frozen identity. It retains failed attempts, validates profile coverage, reports cold runs separately and never declares release readiness by itself.

## Verification

Ignored command logs and browser evidence are under `node_modules/.cache/ms53/`.

- Final `pnpm typecheck`, `pnpm lint` and `pnpm build`: passed for all workspace packages and four applications. Browser-fixture route types were regenerated after fixture removal.
- `pnpm test:ms53`: 23 passed across retrieval, presentation and document-review suites. Broader retrieval regression: 91 TypeScript tests passed. Broader ingestion/readiness/SPEC-5 regression: 24 TypeScript tests passed.
- Python service retrieval/MS-44/assistant regression: 44 passed in the approved Python 3.12 service environment. Python real-parser ingestion/MS-48 regression: 53 passed in the approved parser environment. The MS-53 measurement evaluator and gateway source-mapping checks also passed. The launcher keeps service tests and parser tests in their respective existing environments.
- Disposable PostgreSQL: passed source/content/manifest/generation/audience binding rejection, focused scope review, generated default dependencies, unresolved publication rejection, persisted review identity and 022 rollback, alongside existing lifecycle/concurrency/permission checks. This uses PG18 and an array-backed vector test domain, not production PostgreSQL/pgvector or storage acceptance.
- Real Edge rendering in both portal layouts passed at 1440, 390 and 320 pixels: eight visible numbered steps, scope labels, restriction wording, inert HTML/URLs, authorized source callback, timezone/report freshness, optional diagnostics, parity, overflow and focus return. This is a synthetic rendering fixture, not a live upload-to-answer trial.
- Real-parser fixtures include 13 independent readable cases (eight Markdown, three DOCX, two native-text PDFs), plus long continuation and unresolved-reference cases. Legacy DOC conversion and scanned/mixed OCR acceptance remain pending.

A broader Python run using the parser environment's Python 3.10 exposed 12 existing HTTP timeout failures because that runtime lacks `asyncio.timeout`; HTTP tests pass in the approved Python 3.12 service environment. The old PDF structural assertion was updated for the new conservative headingless support unit. No runtime dependency was changed.

The initial full suite completed with 2,052 passed, three skipped and three failures: two MS-05 route-import timeouts under the concurrent run and the previously documented SPEC2-TC05 campaign validation expectation. These modules were not changed. The first build caught an MS-53 gateway type inference error under the staff application's compiler settings; explicit span properties corrected it, and both app typechecks passed afterward.

Both MS-05 suites passed when rerun alone (nine tests). The final full-suite run (`pnpm run test --maxWorkers=4`) completed with 2,076 passed, three skipped and the same three failures. It retains their load-sensitive timeout outcomes rather than treating the focused rerun as a full-suite pass. Final MS-53 commands passed 23 TypeScript tests and 33 Python tests (18 service/measurement checks plus 15 parser checks). The existing anyio deprecation warning remains.

Local candidate identity: base revision `c7aecd83abd3d2bccee297ec9f4d8478e13e7eac`, source snapshot `503bc06e426ad5fdc0b603d9a1b37f95f972b882c7f3cdf91eb1451b98e6312b`. The snapshot includes preexisting uncommitted work. This binds local check context only and is not a frozen benchmark identity or production acceptance record.

## Commands and rollout

Run `pnpm test:ms53`, `pnpm test:ms53:python`, `pnpm test:ms53:postgres`, plus `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build`. PostgreSQL verification uses a disposable local cluster with an array-backed vector test domain, never configured application databases.

Deploy migration 022 and the matching worker/admin/schema/UI together through the normal review workflow. Keep compatible published predecessors available while reviewed v5 successors process. Stop new publication before applying the paired down migration and restoring compatible code. Do not reprocess or republish live sources automatically.

For actual performance evidence, freeze the candidate/corpus/runtime identity with `freeze_run.py`, capture real authorized browser submit-to-complete-render records and evaluate them with `pnpm rag:ms53:acceptance --measurements <file>`. Records contain only identity, attempt/profile/language/outcome, duration/queue time, batch/actor/reset metadata, ingestion activity and app mode. They must contain no questions, answers, excerpts or credentials. Gateway timings exclude rendering and remain a separate measure. Batch grouping alone cannot prove synchronized submission; retain the browser harness and runtime evidence too.

## Remaining acceptance gates

The warm p95 below five seconds is unmeasured for the final candidate. Representative multilingual, repeated-question, five-user, five controlled cold-start and ingestion-contention browser profiles remain required, with resource peaks and all failures retained. No fast refusal or fixture timing counts as a completed verified answer.

Held-out recall@6, human-reviewed answer acceptance by language/document type, actual admin upload-to-answer usability, real pgvector/RLS/provider behavior and production rollout remain pending. Synthetic parser, SQL and browser fixture results establish their tested boundaries only. Ordinary headings and headingless documents retain conservative completeness; no claim is made that every arbitrary layout or oversized procedure is automatically answerable.

## Live checkout regression follow-up (October 15, 2026)

The user reproduced `INCOMPLETE_EVIDENCE: CONTEXT_BUDGET` after the initial delivery, followed by a heading question displaying an indefinite capacity wait. This supersedes any inference that the initial synthetic regressions established live checkout acceptance.

Read-only probes against the existing published generation reproduced the budget failure. Five candidates expanded together exceeded the evidence limit. The former four-candidate batch selected ranks 0 and 1 in 33,310 ms; a singleton tail batch selected rank 4 in 20,842 ms. Their union still exceeded the budget. The actual checkout candidate alone expanded to three complete source/dependency groups and about 2.7 KB, so the relevant procedure itself fit. No source text was persisted in diagnostics.

The gateway now compares up to twelve candidates together whenever they fit the unchanged byte budget, retaining bounded fallback batches for larger payloads. The private context selection contract accepts matching bounded indexes. The six-source answer closure and output limits remain unchanged. A red-before-fix regression covers the misleading singleton selection and complete checkout evidence.

Three real-launcher lifecycle regressions also failed before the fix: no browser deadline, unknown progress mislabeled as capacity wait, and late progress restoring waiting after completion. A 65-second transport safety deadline now cancels server work and allows retry, polls are serialized and bounded, and request/generation checks reject stale progress. Missing and preplanning gateway requests report checking rather than capacity waiting. The existing 55-second server deadline remains authoritative.

The Python listener was started before the implementation changes. Authenticated `pnpm rag:status` now compares an import-time serving-code fingerprint against local source, without credentials or document content in output. The stale listener was replaced with the current approved GPU profile. Startup initially exceeded its existing deadline while entering encoder initialization. Standalone pinned encoder initialization passed; an isolated sampled async-context run failed natively, but repeats passed with and without preloading, so native causality is not proven. Completing native imports before the serving event loop restored normal API startup without changing models, weights, fingerprints or deadlines. Fixed, content-free startup stages now identify the initialization boundary. The normal listener on port 8000 reports ready and current implementation.

Coherent model comparison alone did not resolve the latency: the natural query then reached the 45-second model transport timeout, and the literal heading question independently timed out during model answer selection. The resident approved Qwen model was verified on GPU. No model switch or longer deadline was used.

The final path recognizes only narrow standalone procedure requests. A unique task heading and contiguous numbered steps must corroborate the task in actual retrieved text. Duplicate matching headings, including incomplete continuations, defer to normal model handling. Literal section numbers must match. Python verifies every canonical hash, consistent document/version/epoch and complete version-scoped dependency ownership/closure before exact extraction. Full source restrictions remain in the returned quotes. Permission conflict, injection, six-quote limits, gateway independent coverage and final identity/source/epoch checks remain enforced. No hardcoded procedure text, generated policy or transcript cache is introduced. The direct seed is applied even when the original candidate union fits; otherwise unrelated groups unnecessarily force model inference for the heading query.

Final read-only live probe (`node services/rag/tests/probe_ms53_live.cjs`, after compiling the actual domain helper as documented in that file) passed both exact user questions against the existing published generation:

| Question | Candidate count | Selected index | Sources / dependency groups | Complete backend time |
|---|---|---|---|---|
| how do i checkout a customer | 5 | 1 | 3 / 3 | 1,748 ms |
| what is 4.2. Customer Check-Out | 2 | 1 | 3 / 3 | 1,211 ms |

Both returned the same canonical procedure, all eight numbered steps and complete required evidence. SHA-256 hashes, exact quotation alignment, independent canonical dependency expansion, current source reads, active administrator and final catalog epoch checks passed. The answer endpoint used 3 ms in each measured attempt; it generated no model tokens. These are two backend observations, not a p95 benchmark, browser-render measurement, or end-to-end authenticated gateway acceptance. No published source or database schema was changed during this follow-up. The current local API remains running on loopback port 8000 with the approved GPU profile and verified implementation identity.

Follow-up regression commands passed 85 Python cases including strict-proof negatives, runtime identity, startup ordering, request cancellation and previous assistant checks, plus 92 TypeScript cases covering gateway evidence, lifecycle and prior assistant/startup behavior. `pnpm typecheck`, `pnpm lint` and `pnpm build` passed for the full workspace and all four applications. Final full-suite outcomes are recorded after completion below. The existing anyio deprecation warning remains.

Final `pnpm test`: 2,087 passed, three skipped, one failed. The sole failure is the preexisting SPEC2-TC05 campaign validation expectation at `tests/spec2-campaigns-and-rewards.test.ts:327`. Both earlier load-sensitive MS-05 suites passed in this full run. All follow-up changes remain local and the database publication state is unchanged.

## SOP governance question follow-up (October 15, 2026)

The question `who can manage the sop and can we improve it?` exposed a separate unsupported fast-path case. The real private planner returned `MODEL_TIMEOUT` after 45,200 ms; embedding took 436 ms and found responsibility/improvement evidence. The wait occurred before retrieval, so checkout-specific extraction did not address it.

`assistantGovernance.ts` now recognizes bounded read-only ownership and improvement questions, including both clauses and independent questions after earlier turns. It does not route report combinations, execution commands, identifier-qualified questions, negation or unresolved pronouns into exact extraction. For a combined question, retrieval starts at corroborated improvement passages and follows their reviewed authority prerequisites. A union of every topical candidate exceeded six sources; following the reviewed improvement graph fits six without dropping its required rules. Python independently requires support for every requested clause, consistent document/version/epoch, exact SHA-256 hashes and complete dependency ownership/closure. Existing permission-conflict, source-injection, exact quotation, output-budget and gateway final actor/source/epoch checks remain active. No permission statement or policy is generated.

After loading the current API, the exact user question passed the live read-only verification in 1,554 ms. The six returned excerpts were exact and covered every required source paragraph except repeated heading metadata. Final authorized source reads, hashes, active administrator and catalog epoch checks passed. The answer endpoint used 5 ms with deterministic proof and no model tokens. These are backend observations, not browser-render or p95 acceptance. The opt-in content-free reproducer is `services/rag/tests/probe_sop_question.cjs`; compile the actual `assistantGovernance.ts` helper into `node_modules/.cache/ms53-live` before `--verify`. `--plan` retains the original model-path diagnostic.

Focused verification passed 56 TypeScript cases and 96 Python cases, including a real authenticated gateway fixture where planner/context inference deliberately times out, plus missing-clause, altered-hash, incompatible-version, incomplete-graph, conflict and injection negatives. Lint passed. Required workspace results are recorded after completion. General questions outside the recognized evidence proofs still use the existing model and deadlines; this change does not claim universal natural-language latency or eliminate the documented broader acceptance gates. No publication, source processing, migration, model or dependency change was performed.

Final workspace checks: `pnpm typecheck`, `pnpm lint` and all four production builds passed. Initial build validation found a staff compiler inference mismatch at the candidate projection; explicit validated fields corrected it. A retry encountered an earlier admin build lock; the subsequent clean run passed. Full `pnpm test`: 2,097 passed, three skipped, one preexisting SPEC2-TC05 campaign validation failure. The current local API is healthy and its loaded implementation fingerprint matches the final serving source.
