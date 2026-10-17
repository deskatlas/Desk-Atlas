# MS-65 implementation and acceptance record

Authority: the October 17, 2026 maintainer request to fully implement MS-65. Traceability: PRD-F26/F27, BRD-M5/M6, SDD-C20-C24, ERD-E25/E27, DSD-UI16/UI17 and QAD-TC44-TC46.

## Delivered behavior

The `ms65-v1` path extends existing retrieval, authenticated inference, cancellation, telemetry, source disclosures and main-answer rendering. It retrieves candidates by the existing semantic/hybrid adapters, then reads every canonical chunk of each selected authorized generation. A compatible legacy adapter inspects entire original generations instead of trusting their sparse or all-to-all graph. Unknown contracts, incomplete manifests and unresolved extraction fail explicitly.

Canonical support units retain source chunk identities, exact UTF-16 spans, section headings and hashes. Paragraph, list and table boundaries use the existing evidence packer. Whole document inspection selects direct support and possible prerequisites, exceptions, restrictions and contrary rules. A separate composition pass receives only exact units. An independent entailment/relevance check then evaluates all selected support, and independent omission checks revisit every original partition, including unselected text. Prose and intermediate model assessments never replace canonical evidence.

Frozen bounds are in [ms65-budget.json](rag/ms65-budget.json). They bound total document wire bytes, units, partition bytes/count, model calls, aggregate input wire accounting, conservative output-token reservations, selected proof bytes, main-answer length, serial work and deadline. Existing inference additionally checks the actual serialized model request, schema overhead, context/output/template capacity and observed tokenizer counts. Overflow remains a capacity outcome and offers a narrower task. These ceilings are candidate bounds, not measured production acceptance or a promise that every broad task fits.

Proof and visible prose have separate bounds. Up to 128 canonical proof spans/citations can support concise main blocks; the six-source legacy admission contract is unchanged for explicitly legacy readers. Source bytes, hashes, actor role, audience, publication epoch and every inspected source are rechecked before release, with at most four concurrent final reads. Source instructions remain untrusted. New documents do not acquire inferred LOCAL scope.

`RAG_SYNTHESIS_ENABLED=false` preserves exact output. Optional composition schema failure uses bounded canonical fallback that still undergoes independent verification. Verification failure, outage, conflict or deadline exhaustion never becomes a fabricated missing-policy result. Empty legacy reconsideration preserves its originating context/output capacity cause. Broad monitoring requests, including qualified and follow-up questions, reach planning rather than a hardcoded shift clarification.

## Persistence and repair

Migration 028 is additive and supersedes 027's unsafe heading-based scope inference. ERD-E25 gains nullable `support_contract` and `repair_of`; existing human review records and original source objects are preserved. New automatic preparation verifies complete extraction and canonical partition admission, then sends `support_contract=ms65-v1` with existing manifest/lease/generation bindings. Publication rewrites only structural edges to original ancestors/references and records an explicit DOCUMENT inspection obligation. SQL updates the manifest and automated provenance atomically with existing publication, notification, catalog and audit operations. Legacy expansion rejects new artifacts instead of interpreting the obligation as local evidence.

An authenticated ADMIN can inventory incompatible active artifacts at `GET /api/admin/knowledge/repairs?cursor=<document UUID>`. Results are selected by artifact contract, not source names, fixed IDs, counts or parser tags. To repair one active publication, POST `{expected_revision, request_id}` to `/api/admin/knowledge/documents/<document UUID>/repair`. The request authorizes a source-equivalent successor for that exact revision and audience. It creates a durable upload intent, copies the original into a distinct private object under the existing upload/removal permit, verifies exact original bytes and finalizes into the existing leased INGEST queue. Duplicate requests reconcile the same successor. A crash before finalize can resume with the same request; a crash after finalize is recovered by normal leases. Failure retains the predecessor. Removal, revision/audience change or administrator deactivation defeats stale completion. No historical READY backlog is published.

The schema/runbook registration under `docs/` is local because this repository ignores `docs/`. This tracked record retains the implementation contract for review without changing that repository policy.

## Verification

The focused regressions exercise the actual gateway with eight canonical source chunks, empty reconsideration after overflow, source-addressed Python processing, a distant omitted restriction, UTF-16 mappings, capacity rejection, private endpoint authorization and contract negotiation. Disposable PostgreSQL exercises production extraction and migration functions with forty sibling headings without a preamble, full-source admission, truthful provenance, legacy reader rejection, audience restriction, durable repair identity, byte mismatch, stale revision fencing, one terminal notice and guarded rollback.

The PostgreSQL harness uses an array-backed vector test adapter and synthetic embeddings. It does not certify production pgvector, hosted object storage, Docker/OCR engines or real inference. Recorded final commands and results are appended after verification.

## Rollout and rollback

1. Preserve publication/epoch/runtime identities and freeze the candidate using the MS-63 identity tooling, including actual nonsecret `RAG_EVIDENCE_CONTRACT` settings. Keep production activation separate from installation.
2. Pause owned ingestion during schema transition. Deploy compatible readers/service code, apply migrations 027 then 028 through the normal migration workflow, then deploy/start compatible writers. Old writers without the new preparation contract fail closed after 028.
3. In an authorized acceptance environment set the gateway contract to `ms65-v1`, verify the loaded runtime fingerprint, and inspect current publications using the whole-document adapter. Inventory and authorize repair successors through the admin API. Do not update published chunks manually.
4. Verify original-byte identity, representative actual answers, replacement/removal/audience/deactivation races, normal STAFF/ADMIN source access and browser lifecycle. Run frozen held-out and full-render profiles before any production release decision.
5. Roll back admissions/writers first. The 028 down migration refuses while active publications or pending repair work require the new contract. Withdraw or explicitly prepare compatible successor artifacts before removing readers; never restore withdrawn sources or previous audiences. The down migration retains additive provenance columns and restores previous functions. A production rollback rehearsal remains an independent gate.

## Independent acceptance remains pending

`pnpm rag:ms65:acceptance --dataset <dataset> --lock <lock> --bundle <MS63 bundle> --manifest <MS65 manifest> --out <new report>` extends the existing MS-63 evaluator. The manifest binds dataset and frozen budget digests, source format/digest/holdout/OCR metadata, disclosed audit cases, distinct multi-turn conversations and content-free source/work observations. It retains MS-63 owner/refusal, human review, production identity, normal-browser and performance requirements. It additionally enforces twelve unseen documents, at least three per format family, OCR coverage, document-level split isolation, 120 answerable and 40 negative held-out cases, twenty multi-turn conversations, format/language useful-answer strata and 95% applicable-support recall. Missing observations remain missing; reports never activate features.

No independent labels, human reviewer attestations, normally authenticated browser results, live corpus migration/repair, real inference quality or one/five-user complete-render p95 results were supplied or fabricated. The original sixteen audit cases remain regression evidence. The milestone cannot be marked fully accepted until those requirements, the strict warm p95 below 5,000 ms target and all safety/release gates pass. The implementation makes no claim that the new broader inspection path meets that latency target.


## Final local verification (October 18, 2026)

- `pnpm typecheck`: passed for every workspace.
- `pnpm lint`: passed, including the new domain validator and acceptance evaluator (29 TypeScript and 31 Python boundary files).
- `pnpm test`: 2,294 passed, 43 skipped; after adding final proof/withdrawal regressions, the affected MS-65/MS-59/MS-60/startup selection passed 23 tests.
- Full service Python suite: 511 passed, 16 skipped. The original cross-runtime fingerprint mismatch introduced by extending the Python serving-file list was fixed in `scripts/rag-status.cjs`; both runtimes now hash the same files in the same order. The final reconsideration regression executes the actual selection endpoint rather than asserting a literal error string.
- `pnpm test:ms65:python`: 17 passed, including actual aggregate serialized-work admission and ContextVar cleanup.
- `pnpm test:ms65:postgres`: passed, including forty-source admission, source-equivalent successor activation, duplicate completion, one notice, predecessor preservation, stale audience/revision fencing, active-artifact rollback refusal and compatible rollback after withdrawal.
- `pnpm build`: passed for all four applications.
- `git diff --check`: no whitespace errors.

Full check logs are private local artifacts under `.git/ms65-final-*.log`. No commit, migration against a configured database, runtime restart/admission change, repair of a live publication or deployment was performed. Independent MS-65 acceptance remains pending for the reasons above.
