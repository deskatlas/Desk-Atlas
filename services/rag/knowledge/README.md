# SPEC-5 Knowledge Base ingestion

Traceability: PRD-F27, SDD-C23/C24, ERD-E24 through ERD-E29, DSD-UI17, QAD-TC45.

The MS-64 Settings Knowledge Base tab accepts a file and audience with one Upload action. Durable PostgreSQL jobs verify extraction and automatically publish the authorized version after system checks. Preview is read-only and optional; legacy human review records remain intact. Replacements keep their published predecessor active. Document removal revokes retrieval before physical cleanup. Unapproved SOP files are never imported automatically.

## Local setup

Apply the unapplied forward migrations in order, including `015_assistant_published_knowledge.sql` then `016_knowledge_base_lifecycle.sql`. Never apply `000_reset_database.sql` to an existing database. This implementation does not run migrations against your configured database automatically. Migration 016 extends the SPEC-4 retrieval tables and adds lifecycle RPCs, jobs, and notifications. Its down migration preserves those retrieval tables. Stop feature writes/workers before rollback.

Use the shared approved runtime from `services/rag/requirements.txt`; `knowledge-requirements.txt` adds olefile 0.47 for structured legacy Office validation. Install in the isolated local environment:

```powershell
services/rag/.venv/Scripts/python.exe -m pip install -r services/rag/knowledge-requirements.txt
docker build -f services/rag/knowledge-parser.Dockerfile -t deskatlas-knowledge-parser:local services/rag
```

The parser image pins the official Python 3.10 bookworm multi-platform image digest `sha256:5be5aaecb962a41567bc8041f1e9e3432cb085b037fe057f9a562630b2e4b370` (Python 3.10.22), python-docx 1.2.0, pypdf 6.0.0, pypdfium2 4.30.0, olefile 0.47, Debian bookworm LibreOffice Writer, Tesseract and eng/fil data. The binaries are installed only in the isolated image. Capture the resolved Debian package versions, built image digest, license notices and scan results before release; this local image recipe is not a production image approval. No parser runs on user uploads outside the network-disabled container.

Configure the admin gateway with `KB_ENABLED=true`, `KB_SCOPE_ID` (same value as the assistant deployment scope), `KB_WORKER_TOKEN` (independent random server secret of at least 32 bytes), `RAG_EMBEDDING_FINGERPRINT` (canonical SHA-256 of `models.json`'s embedding object), and the existing server-only Supabase configuration. The first verified upload initializes an absent catalog through `kb_initialize_catalog`; an existing mismatched fingerprint fails closed. Do not overwrite an existing catalog fingerprint; index changes require a separately reviewed complete-generation cutover.

The worker needs only `KB_ENABLED=true`, `KB_GATEWAY_URL`, and `KB_WORKER_TOKEN`. It never receives the Supabase service-role key. Download pinned model artifacts using the shared explicit provisioning command before starting; the worker loads offline. Run from `services/rag`:

```powershell
.venv/Scripts/python.exe -m knowledge.worker
```

Jobs survive browser/logout/worker shutdown in PostgreSQL. A two-minute lease is renewed every 25 seconds. Crash recovery restarts extraction from the immutable source; previously committed chunk batches are idempotently replaced. An expired old worker cannot commit. Retries are capped at five attempts and use 30s/2m/10m/30m delays with jitter. Permanent extraction errors await an explicit admin retry. Removal cancels ingestion and queues purge. Failed purge retains the tombstone and emits an admin notice; Settings offers Retry cleanup. Upload authorization renewal stops at `KB_UPLOAD_EXPIRY_SECONDS` (default 86400, minimum 7200); polling reconciliation waits a further two-hour provider-token grace period before purging abandoned UPLOADING sources. This is transfer cleanup, not a document retention policy. Worker cleanup can run even if embedding weights cannot be loaded.

## Operational limits and remaining release gates

There is no product file-size/page-count limit. Storage/proxy limits remain effective. Parser engineering defaults: 2 CPU cores, 2 GiB RAM, 1 GiB scratch, 128 processes, 900 seconds per source, 120 seconds per OCR page/conversion, and 256 MiB archive expansion. Exceeding a budget fails visibly rather than truncating. Configure memory/time/archive budgets for the deployment profile and benchmark before enabling production uploads.

Parser fingerprints hash the parser/library, normalizer/chunker, converter/OCR engine versions and available eng/fil language-file hashes. The worker limits embedding CPU threads to `KB_EMBEDDING_THREADS` (default 2). Per-job named containers are forcibly removed on exit or timeout; their scratch files and source bytes are never sent to persistent diagnostics.

Markdown is UTF-8, raw HTML is removed with a warning, and links are never fetched. DOC conversion disables macros/remote links and runs offline. DOCX external references/macros/encrypted/malformed archives fail safely; embedded content and tracked changes produce review warnings. PDFs use per-page extraction/OCR with source page provenance; scanned pages use eng+fil and require review. Preview text is rendered as escaped React text, without HTML execution.

Superseded content remains admin-only pending the owner's retention decision; no automatic seven-day deletion policy is assumed. Removed artifacts are queued immediately. Storage backups follow provider retention. Production dispatch/scheduler, parser image pinning/scanning, deployed pgvector verification, resource benchmarks, approved source policy, retention, and real PostgreSQL/RLS/concurrency acceptance remain release gates. A schema migration or unit test passing is not evidence that these gates passed.

`KB_ENABLED` defaults off. Disabling it stops new feature ingress/claims without changing booking, payment, or allocation operations. Accepted jobs remain durable for resumption. `RAG_ENABLED` is independent.

## Verification evidence (October 14, 2026)

- `pnpm exec vitest run tests/spec5-knowledge-base.test.ts`: 11 passing actor/origin/schema/vector/visibility tests.
- `.venv/Scripts/python.exe -m pytest services/rag/tests/test_knowledge_ingestion.py -q`: 23 passing synthetic extraction, mixed-page OCR adapter, archive-security, chunking, and worker-fence tests. OCR adapter tests substitute the Tesseract subprocess; they do not prove installed engine recognition quality.
- `python tests/spec5-postgres-lifecycle.py`: passed disposable PostgreSQL migration/lifecycle, duplicate request, concurrent publication, lease reclaim, removal fencing, permission-denial, and rollback checks. The local test uses an array-backed vector domain because pgvector is not installed; exact pgvector/storage integration remains unverified. No application database is modified.
- An offline pinned Qwen encoding smoke test produced 1024 dimensions and L2 norm 1.0 for a synthetic procedural chunk.
- `pnpm typecheck`, `pnpm lint`, and `pnpm build` passed. The configured lint commands are package placeholders and do not constitute an ESLint review of the application.
- `pnpm test`: 1888 passed, 2 skipped, 1 failed in unchanged `tests/spec2-campaigns-and-rewards.test.ts` (SPEC2-TC05 expects a 100-percent discount to be rejected). No campaign validation code was changed for SPEC-5.
- Docker's Linux engine is unavailable on the workstation, including after an attempted desktop start. The isolated image build, real DOC conversion/eng+fil OCR, real storage/RLS, and full end-to-end ingestion have not passed. Feature activation and production release remain gated on those checks.

## MS-46 ingestion and cleanup extension

Apply additive migration 018 only through the normal reviewed migration workflow, after stopping old issuers/workers and disabling KB/RAG. The matching gateway reserves and confirms upload permits; purge retains paths until authorization expiry and final absence verification. Parser v2 preserves blank-page provenance and mixed-content review. Existing publications remain unchanged; changed extraction requires explicit successor review/publication. See [MS-46 implementation and acceptance record](../MS46-IMPLEMENTATION.md) for recovery, rollback protection, verification and pending provider/container/pgvector gates.

## MS-52 cleanup scheduling

After deploying additive migration `021_knowledge_purge_scheduling.sql` and its matching gateway/worker, `pnpm rag:worker` runs one ingestion lane and one independent cleanup lane. Each lane has one active job and polls idle queues once per second. A purge claim skips upload reconciliation and cannot load parser containers or embedding weights. `pnpm rag:purge` starts a standalone cleanup lane using only KB gateway settings and the worker authority, independent of the answer API and answer-model manifest. `KB_WORKER_MODE=ingest` runs only ingestion; provision a cleanup process when using this setting. No launcher starts automatically.

Disable KB/RAG and drain gateways/workers before applying 021 through the normal migration workflow, following 020. Do not execute down migrations in the forward sequence. Roll back matching runtime and `021_knowledge_purge_scheduling_down.sql` together after draining workers. The down migration restores the effective 019 worker function while retaining 020 section-review behavior and all 018 upload safety fences. No production migration or feature activation was performed.

Removed versions with outstanding upload permits wait until the existing authorization deadline. They remain unavailable to retrieval immediately. Eligible jobs drain at most 1,000 chunks across all generations per database operation, yielding for one second between batches so other cleanup jobs can progress, retaining private object references until verified storage completion. Storage targets are deduplicated and exact absence is verified once per directory. A full 100-object page is inconclusive and triggers durable retry; listing errors, partial deletion and transport exceptions never become success. Retained SUPERSEDED versions are unchanged.

The compact cleanup panel distinguishes authorization waits, indexed-content batches, active cleanup, provider retries, failed jobs and work awaiting a worker. Awaiting a worker is not proof that a worker is offline. Check worker availability if this state persists. No estimated completion time is presented. Completion leaves the pending panel; the job's SUCCEEDED state and timing checkpoint are retained. The working list reconciles immediately after authoritative removal through MS-51.

Content-free job checkpoints record `eligible_at`, `claimed_at`, `storage_ms`, `object_count`, and `verified_at`; existing `removed_at`, `created_at`, and `completed_at` distinguish withdrawal, eligibility, claim, and finalization. Worker service metrics contain only kind and duration and do not claim success. Do not log source content, private object paths, request bodies or credentials. See [MS-52 implementation evidence](../MS52-IMPLEMENTATION.md) for actual verification and pending provider acceptance.


## MS-64 automatic preparation

Apply forward migration 025 after 024, then deploy matching readers, gateway and worker before exposing the new upload form. Upload admissions call `upload_auto`; an unmigrated database cannot accept the new intent. No environment flag silently converts legacy jobs. New jobs require the `kb-auto-v1` preparation contract. Old parser/container fingerprints fail safely, never receive forged human acknowledgment, and leave active predecessors usable.

Run `pnpm test:ms64`, `pnpm test:ms64:python` and `pnpm test:ms64:postgres`. The SQL command uses a disposable local PostgreSQL with an array vector adapter, never configured application databases. Stop new admissions and drain workers before rollback. The 025 down migration refuses while automated provenance or accepted work remains; preserve forward readers until dependent versions have been explicitly retired through lifecycle operations. Do not discard provenance or run reverse migrations against active auto publications. See [implementation record](../MS64-IMPLEMENTATION.md).
