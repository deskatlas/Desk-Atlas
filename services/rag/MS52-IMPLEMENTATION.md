# MS-52 implementation and acceptance record

Date: October 15, 2026. Authority: `docs/milestone/ms52.md`, PRD-F27, SDD-C23/C24, DSD-UI17, ERD-E24 through ERD-E29, QAD-TC45/46.

Local implementation is delivered. Provider semantics, normal end-to-end latency budgets and production activation remain pending. No application database migration, live deletion, dependency installation or worker activation was performed. Existing uncommitted MS-46/48/50/51 work was preserved.

## Changes and safety

- Migration 021 preserves the effective section-aware worker from 019 and leaves the reviewed-scope admin contract from 020 unchanged. The down migration restores that prior worker contract without undoing 018 safety fences or 020 review behavior.
- Claims accept an optional INGEST/PURGE kind. Default workers use two independent single-job lanes; standalone `pnpm rag:purge` uses only gateway configuration and worker authority, without reading the answer-model manifest or loading parser/model weights. Idle claims poll once per second, gateway failures back off five seconds, and existing durable provider-error backoff remains unchanged.
- Purge enqueueing persists upload authorization eligibility and WAITING_UPLOAD stage. Claims exclude ineligible versions, and purge-target preparation checks the deadline again before storage effects. Grace waits do not consume attempts or repeatedly delete objects. Existing signed-token validity is unchanged.
- Purge-target preparation checks scope, lease, generation, removed state and exact version namespace. It deletes at most 1,000 chunks across all generations, yields for one second between unfinished batches, and retains storage references. A direct completion cannot bypass remaining chunks or storage attestation.
- Storage removal deduplicates keys. Exact absence checks group targets by directory; a complete listing of fewer than 100 entries is required. Full pages, errors, existing objects, partial removal and thrown transport errors trigger durable retry. Storage deletion followed by failed DB completion retains paths for idempotent recovery.
- Job checkpoints retain content-free eligibility/claim/verification timestamps, storage duration and object count. Worker metrics contain only kind and service duration, without implying success. No paths, source content, credentials or bodies are logged.
- The MS-51 compact cleanup panel now distinguishes upload waits, chunk batches, active cleanup, retries, failed jobs and work awaiting a worker. Expired authorization waits become awaiting-worker feedback. Awaiting work is not a claim that the worker is offline. Working-list disappearance still follows authoritative withdrawal and does not claim physical completion.
- Superseded retention, atomic retrieval revocation, source/epoch checks, server-only credentials, audit metadata and booking invariants are preserved.

## Diagnosis and measurement

The initial focused gateway regression failed in three places: deferred cleanup was rejected, two objects in one directory required two listing calls, and thrown storage errors escaped without durable retry. The final suite passes these cases. The identified delays are independently addressed; no claim is made that a single cause dominates the user's live environment.

`tests/ms52-worker-latency.py` compares the actual committed synchronous worker loop with the current independent lanes using 30 synthetic purge jobs while one ingestion operation is blocked for 1,000 ms. Both use the same fake gateway/process adapter, no real source, model, OCR, DB or provider. Raw content-free results and baseline source digest are in `evaluation/ms52-scheduling.json`.

| Scheduler-only interval | Before | After |
|---|---|---|
| Eligible-to-claim p50 | 1,039.093 ms | 0.630 ms |
| Eligible-to-claim p95 | 1,039.140 ms | 0.753 ms |
| Eligible-to-claim maximum | 1,039.144 ms | 0.763 ms |
| Samples | 30 | 30 |

This establishes removal of shared-loop head-of-line blocking only. These are synthetic scheduling measurements, not the milestone's normal provider-profile deletion acceptance. For a two-object version in one directory the gateway tests verify one remove call and one listing call, versus one remove and two listings before. During required grace, no storage calls occur.

For real acceptance, capture browser request/response and acknowledgment timestamps separately from durable removed_at, checkpoint eligible_at/claimed_at/verified_at and completed_at. Measure at least 30 normal deletions on the same healthy isolated profile before/after, recording counts, provider conditions, retries and grace waits. Response p95 <= 2 s, claim p95 <= 5 s, and eligibility-to-verified-completion p95 <= 15 s remain pending. UI disappearance is separate from physical completion. Do not shorten authorization grace to meet a target.

## Verification

- Initial focused gateway regression: 3 failed, 4 passed. Final focused cleanup suite: 9 passed, including scoped standalone launcher settings.
- Focused SPEC-5, MS-46, MS-48 and launcher tests: 52 passed before the additional launcher case. Final MS-50/MS-51/MS-52/launcher integration: 32 passed.
- Python MS-52, MS-46, MS-48 and ingestion regressions: 64 passed, one existing Starlette/anyio deprecation warning.
- Disposable PostgreSQL: passed real function execution for enqueue eligibility, grace revalidation, bounded 2,501-chunk cleanup across generations, scope/lease rejection and expired-lease reclaim, invalid namespace rejection before chunk effects, attestation, retry path retention, independent kind claims and forward/down/forward migration. Existing lifecycle concurrency and permission checks also passed. Uses an array-backed test vector domain, not real pgvector or storage/RLS acceptance.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed after retaining metadata in typed gateway-generated SQL checkpoint fields instead of console diagnostics.
- `pnpm test`: 2,052 passed, 3 skipped, one existing SPEC2-TC05 campaign validation failure at `tests/spec2-campaigns-and-rewards.test.ts:327`. Its expectation that the existing 100-percent reward be rejected is documented in prior SPEC-5 evidence. No campaign implementation was changed.
- `pnpm build`: first attempt encountered an existing concurrent Next.js admin build lock. Retry passed for all four applications.
- Existing isolated-storage probe: PENDING / ISOLATED_STORAGE_FIXTURE_REQUIRED. No dedicated fixture credentials are configured. No provider experiment or live deletion was attempted.

## Remaining release gates

Provision a dedicated nonproduction private-storage fixture and verify real late-write/signed-upload expiry, exact listing behavior, partial deletion, transport timeout and restart between storage deletion and SQL finalization. Exercise sustained mixed load and multiple real workers against deployed pgvector/RLS with disposable sources, including draft-only removal and concurrent publication/removal. Run the normal 30-deletion latency profile and browser acknowledgment measurement. Confirm production worker provisioning and rollback after review. Local unit, synthetic scheduler and disposable SQL results cannot substitute for these gates.

Startup and rollout instructions are in `knowledge/README.md` and `docs/build-deskatlas.md`. Production activation requires coordinated migration/runtime deployment through the normal reviewed workflow.
