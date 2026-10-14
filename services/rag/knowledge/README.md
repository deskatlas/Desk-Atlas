# SPEC-5 Knowledge Base ingestion

Traceability: PRD-F27, SDD-C23/C24, ERD-E24 through ERD-E29, DSD-UI17, QAD-TC45.

The admin Settings Knowledge Base tab uploads private sources, queues durable PostgreSQL work, previews extraction, and explicitly publishes reviewed versions. Replacements keep their published predecessor active. Document removal revokes retrieval before physical cleanup. Unapproved SOP files are never imported automatically.

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
