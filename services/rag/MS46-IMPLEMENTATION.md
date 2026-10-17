# MS-46 implementation and acceptance record

Date: October 14, 2026. Authority: [MS-46](../../docs/milestone/ms46.md), PRD-F26/F27, SDD-C20 through C24, ERD-E24 through E29, DSD-UI16/17, QAD-TC44 through TC46.

Status: Local implementation delivered. Production acceptance remains incomplete. No application database migration, dependency installation, source publication, feature activation, or deployment was performed. The starting working tree was clean. Installed Next.js 16.3.2 route-handler, backend-for-frontend, and lint documentation was read before changing handlers.

## Delivered behavior

| Boundary | Change and practical limit |
|---|---|
| Ingestion | The exact 291-token twenty-instruction reproduction now chunks successfully with the pinned offline Qwen tokenizer. A complete section fitting 800 tokens is emitted once. Larger sections repeat actual qualifiers, preserve FAQ pairs/table headers and bounded Unicode overlap, and fail with nonretryable CONTENT_LIMIT if safe context cannot fit. |
| PDF extraction | Rendered white pages retain original page numbers with SKIPPED_BLANK manifest entries and BLANK_PAGE_SKIPPED warnings. Image-bearing pages undergo OCR even with readable headers; matching native/OCR lines are deduplicated. Empty nonblank OCR fails UNREADABLE_PAGE. Entirely empty documents fail EMPTY_TEXT. Raster dimensions are bounded before rendering. |
| Parser compatibility | Parser/chunker fingerprint versions advance to v2. Old published content is not reprocessed or republished. New extraction requires the normal admin review, including mixed-content/OCR warnings and skipped page numbers in preview. |
| Complete evidence | New SQL expansion verifies complete current published versions, audience, scope, generation, ordinals, content hashes and manifests. The gateway refuses expansion exceeding six chunks or its existing byte budget instead of dropping supporting candidates. Python retains substantive paragraphs, and TypeScript independently rejects missing paragraphs. Oversized paragraphs return an evidence gap. This conservative baseline may refuse otherwise answerable long documents; it needs representative quality/latency evaluation before acceptance. |
| Poisoned/conflicting evidence | Existing permission-conflict checks remain. Known instruction-poison patterns cause an explicit gap, including during automatic completeness expansion. These deterministic checks and a model support verdict do not establish general semantic correctness or universal injection resistance. |
| Language | Fixed response copy and deterministic report narratives support English, Filipino and Taglish, retaining values and UI/status labels. Quotations stay in the published source language. Language detection is a small typed heuristic; precise source-language annotation, matching-language source preference and independent semantic/product review remain acceptance work. No generated quotation translations are introduced. |
| Upload/removal | Migration 018 reserves issuance under the removal document lock. A provider authorization is exposed only after a fresh active-admin permit confirmation within 30 seconds. Each reservation extends a durable conservative bound by the two-hour provider TTL plus five minutes of clock margin. Failed issuers retain their bound. Removal still revokes retrieval immediately. |
| Cleanup | Initial deletion is followed by durable RETRY until the authorization bound. Paths remain until a final deletion and absence check. Storage failures retain retryable cleanup state. Recently cleaned legacy removals reconstruct their deterministic source paths and requeue cleanup to cover unused old tokens. Provider TTL/revocation behavior remains unverified in this environment. |
| Exhausted claims | SQL atomically records terminal failure/notice and returns null. The gateway validates null versus a job/version envelope before dereferencing. The actual Python worker continues polling. Successful PURGE completion requires an absence attestation supplied only by the server gateway. |
| Evaluation | Strict identity binds revision, deterministic source snapshot, answering model, embedding, parser artifacts, allowlisted nonsecret settings, corpus, cases and run. Observations require role/language/profile/unique attempt context. Gates reference matching raw gate records. Required profile counts, batches, actors, resets, strata and finite measurements fail closed. Five-user aggregates must equal their supporting records. Fast failures cannot improve valid-answer percentiles. |
| Request budget | One monotonic budget begins before authentication, availability and body ingress. Database transport, every measured stage, model calls and final release share its cancellation signal. Remaining time reaches Python, whose existing native-encoder capacity behavior remains intact. |
| Tooling | `pnpm lint` runs TypeScript/Python AST boundary checks for unsafe typing, executable input, source HTML, payload diagnostics and subprocess shell use. This is a real, dependency-free policy lint, not a claim of repository-wide ESLint coverage. Shared validation/domain/UI typechecks now execute TypeScript. Config has no TypeScript source and no pretend compilation script. |

## Executed verification

| Command / check | Result |
|---|---|
| `pnpm typecheck` | Passed shared validation, domain, UI and all four applications |
| `pnpm lint` | Passed substantive RAG boundary checks: 22 TypeScript files and 17 Python runtime files |
| `pnpm test:ms46` | 74 tests passed in four files |
| `.venv/Scripts/python.exe -m pytest services/rag/tests/test_ms46.py services/rag/tests/test_operations.py services/rag/tests/test_knowledge_ingestion.py -q` | 75 passed, including the real pinned tokenizer and real PDF parsing/rendering with a substituted OCR subprocess |
| `.venv-service/Scripts/python.exe -m pytest services/rag/tests/test_assistant.py services/rag/tests/test_ms44.py -q` | 35 passed; existing Starlette/AnyIO deprecation warning remains |
| `.venv/Scripts/python.exe tests/ms46-postgres-hardening.py` | Passed disposable PostgreSQL lifecycle/integrity, legacy cleanup reconstruction, permit fencing, rollback protection, and two actual SQL -> TypeScript route -> Python worker runs |
| `.venv-service/Scripts/python.exe services/rag/selection_smoke.py --gpu` | Final 11/11 synthetic model-component cases passed using the pinned local Qwen3 4B digest; no gateway/browser/capacity acceptance implied |
| `pnpm test` | 1972 passed, three skipped, one failed. The unchanged SPEC2-TC05 assertion at `tests/spec2-campaigns-and-rewards.test.ts:327` still fails. No campaign implementation was modified. |
| `pnpm build` | All four Next.js production builds passed |
| `node scripts/ms46-storage-probe.cjs` | PENDING / ISOLATED_STORAGE_FIXTURE_REQUIRED; no storage action performed |

The PostgreSQL tests use an array-backed test vector domain, and their storage adapter is synthetic. They establish transaction and cross-language response behavior, not pgvector distance correctness, Supabase provider semantics, deployed storage/RLS isolation, or actual physical erasure. The integration Vitest test intentionally skips during an ordinary full suite and is executed twice by the disposable driver.

The first extended component run passed 9/11 cases: its English sources said to verify a receipt without providing the verification procedure requested by the Filipino/Taglish questions. Those questions returned gaps. The synthetic sources were completed with comparison steps and mismatch handling, without changing model weights, prompts, thresholds or expected safety rules. The subsequent 11/11 result is component evidence only; independent human review remains necessary. No question, answer, quote, token, signed URL or real customer/report row was written into diagnostic artifacts.

## Measurement gates

| Required profile | Historical baseline | This candidate | Acceptance |
|---|---|---|---|
| Thirty authenticated/rendered repeated SOP attempts | MS-44 historical evidence only | Not measured | Pending |
| Thirty representative attempts per language | Prior ten-per-language component samples are insufficient | Not measured | Pending |
| Five independently controlled cold resets | None applicable | Not measured | Pending |
| Twenty synchronized five-actor batches | None applicable | Not measured | Pending |
| Equivalent OCR/embedding interference run | None applicable | Not measured | Pending |
| Actual cancellation-to-reusable-capacity and control-request delay | Existing unit controls only | Controls pass; hardware recovery not measured | Pending |
| Held-out recall and independent procedure/language review | Tiny synthetic smoke corpus only | New MS-46 synthetic cases prepared; review not executed | Pending |

Unavailable timings are not zero. No before/after latency improvement is claimed. No timeout was increased. Missing integration fixtures, unratified thresholds and human review keep `release_ready` false.

## Migration and recovery procedure

1. Disable KB/RAG and stop/drain all old upload issuers and workers. The old gateway cannot remain able to issue untracked upload permissions during cutover. Preserve existing source files and pending cleanup state.
2. Apply only the new forward `018_knowledge_correctness_and_cleanup.sql` after unapplied 014, 015, 016 and 017 through the normal migration workflow. Never include `_down.sql` in forward globs, reset an application database or edit applied migrations.
3. Deploy the matching gateway/validation/worker code. Provision and verify the changed parser image through the approved isolated build path. Do not claim that editing parser code rebuilds its deployed image.
4. Validate permits, storage/RLS, cleanup retries, current publication and worker polling with isolated synthetic fixtures before activation. Permit issuance failures are safe failures, not reasons to bypass confirmation. The two-hour provider assumption and five-minute clock allowance must be verified for the selected host/provider.
5. After removal, initial cleanup can delete bytes immediately, but the UI remains Cleanup pending until the final scheduled purge succeeds. After a storage failure use Retry cleanup. Restarts retain paths, authorization bounds and jobs; cleanup never needs embedding weights. Physical backup retention remains a separate provider decision.
6. For rollback, keep both features disabled and stop/drain the new processes. The down migration refuses outstanding authorizations or unfinished removed-source cleanup. Wait for expiry and complete final cleanup; never manually erase tombstones or bounds to force rollback. Active published sources with expired authorizations can remain. Rollback returns to the older contracts, so do not enable old/new mixed gateway-worker versions.

## Supported initial topology

The supported initial profile is one long-lived Node process for each admin/staff application, one Uvicorn worker, one inference authority and one serial ingestion worker. Each gateway has up to five request entries and one active request per actor. These maps are independent between applications. Python admits at most five stage requests across both applications and shares two model/encoder slots; this does not promise five simultaneous generations or acceptable load latency.

Cancel/progress must route to the same application process as the query. Optional internal callbacks must reach that owning process and its live capability; the ordinary workflow uses direct gateway orchestration and needs no callback. Process restart invalidates ephemeral requests/capabilities and clears chat ownership; durable ingestion/purge jobs remain in PostgreSQL. Native work can retain capacity after HTTP abort until it actually finishes.

Multi-worker/replica/serverless placement and horizontal scaling are unsupported by this implementation. A host routing callbacks or cancellation to another process must supply approved shared metadata coordination and actual ownership/recovery tests before release. There is no transcript persistence or distributed admission claim.

## Reproducing remaining gates

`scripts/ms46-storage-probe.cjs` requires dedicated `MS46_STORAGE_ISOLATED=true`, `MS46_STORAGE_URL` and `MS46_STORAGE_SERVICE_KEY` environment configuration. It creates only a fresh private UUID bucket, issues an unused permission, deletes, attempts the late upload, deletes again and verifies cleanup. It emits metadata only and never uses the application's bucket. It does not wait two hours or certify authorization expiry, renewal/removal races or deployed RLS. Those remain staging tests.

Prepare an authorized isolated published synthetic corpus and five distinct active test actors. The proposed additional cases are `evaluation/ms46-held-out.json` and `evaluation/ms46-corpus.json`. Format labels are stratification metadata, not evidence that Word/PDF/OCR extraction passed. Use reviewed real parser fixtures separately. Credentials belong only in the existing environment/session mechanisms.

Freeze a campaign manifest before any profile:

```powershell
services/rag/.venv/Scripts/python.exe services/rag/freeze_run.py --cases path/to/cases.json --corpus-manifest path/to/corpus.json --runtime-settings path/to/nonsecret-settings.json --out services/rag/benchmark-results/ms46-run.json
```

The manifest is created exclusively, without overwriting a prior run. Reuse it across profile invocations; the runner compares it with actual current artifacts before starting and checks the source snapshot again afterward. Supply the same cases/corpus/settings plus `--run-manifest services/rag/benchmark-results/ms46-run.json` to `gateway_benchmark.py`, selecting repeat, representative, five, cold or ingestion and the actual development/production-build mode. Five distinct tokens alone are insufficient: the runner verifies current actors. Controlled cold resets require separately recorded actual resets. The ingestion profile deliberately remains unverified without independently instrumented OCR/embedding activity; no flag pretends that it happened.

`evaluate.py` requires identity-bound observations, matching gate record references, semantic completeness/language review, actual runtime identity, real pgvector, private storage, parser container, topology, cancellation recovery, privacy, rollback and substantive lint evidence, plus every SPEC6 operational gate and required profile. Never copy the evaluator unit fixture into a release report. Independently review exact report cells and required conditions. Calibrate and ratify thresholds before running acceptance, not after seeing results.

Remaining operational work includes actual Linux parser image/offline artifact verification, DOC conversion and eng/fil recognition, PostgreSQL pgvector distance/filter tests, admin/staff/anonymous/cross-scope RLS and storage policies, concurrent publication/removal/citation scenarios, actual host clocks/logging/privacy and capacity recovery, browser/mobile acceptance, representative held-out semantics and language handling, all prescribed measured profiles and operator staging handoff. These gates require an authorized isolated environment and a selected topology. No unavailable gate is reported as passed.

## Local candidate identity

The content-free local fixture manifest was frozen and exclusive-write rejection verified. It is a fixture configuration, not an authenticated runtime identity or release report.

- schema_version: `1`
- candidate_revision: `c7aecd83abd3d2bccee297ec9f4d8478e13e7eac`
- source_snapshot: `e8ef8661aee794cbe797e342ca23924eac509180690dd8742092922c5ce018eb`
- answer_model_digest: `359d7dd4bcdab3d86b87d73ac27966f4dbb9f5efdfcc75d34a8764a09474fae7`
- embedding_fingerprint: `e8a8211561f2eeee9504e69cb6927ece0cf628c8ad52eb8da07a417849d7e2fe`
- parser_fingerprint: `769da76196616b864ba2666c99a4e963cb5536ef80e8f6285a0dafad99fe4304`
- config_digest: `fd4ca4488d44052b7b04724bd2ae11e833e1d28f80822231478d3f90e7cf49d2`
- corpus_digest: `1449eb5adcdbc8a94fc9dd4375cd4ced30ca1b125e9b4a3fc981d1ca23334b78`
- case_set_digest: `df5be08f412e5fe0bc3a4e403713b416738638673e1fd3abcf62cc3694784a6d`
- run_id: `e7614971-f73a-4205-96a1-bbb962651a61`
