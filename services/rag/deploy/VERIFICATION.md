# October 20 hosted embeddings verification

Traceability: PRD-F26/F27, SDD-C21/C23/C24, QAD-TC44/45/46.

Implemented shared DeepInfra document/query encoding at 1024 dimensions with a
separate fingerprint, strict response/batch/index validation, L2 normalization,
no silent truncation or local fallback, fixed HTTPS origin and cancellation.
New chunks use a conservative UTF-8 byte upper bound without local weights.
Existing chunks are re-embedded exactly through private shadow-vector RPCs.
The migration preserves source text/IDs/approval, atomically changes complete
vectors and verification bindings, and retains guarded rollback data.

Provided a smaller HTTP-only Cloud Run image, manifest preparation option,
operator re-embedding CLI, explicit worker source bundle, Ubuntu installation,
hidden credential prompts and a systemd service. Parser image remains offline,
read-only and credential-free; its immutable local image ID is recorded in the
worker configuration. Linux source-file permissions and SIGTERM cleanup are
handled. No live database migration, index change, build, deployment or VM
creation was performed in this implementation turn.

| Verification | Result |
|---|---|
| Real DeepInfra document batch + async query | Passed with existing Secret Manager key and synthetic text only |
| Focused Python provider/assistant/identity/startup suites | 132 passed |
| Disposable PostgreSQL lifecycle + hosted vector cutover | Passed incomplete/changed corpus rejection, private RPC permissions, full switch, verification binding and rollback |
| Focused JavaScript launcher suites | 17 passed, including hosted-worker credential isolation |
| `pnpm typecheck` | Passed |
| `pnpm lint` | Passed, 33 Python and 30 TypeScript boundary files |
| `pnpm build` | Passed |
| Full `pnpm test` | 2,367 passed, 43 skipped, 3 failed outside modified application files |
| Worker bundle and cloud upload allowlist | Inspected, no environment files/credentials/model caches |
| `git diff --check` | Passed |

Full-suite failures: `mf71` and `mf78` expect an em-dash in the survey email
subject, while the current implementation uses a hyphen; `ms35` finds the
`overdue_notified_at` column missing from the DrawSQL schema copy. These files
were not changed by this work. Do not report a green full suite.

The PostgreSQL harness uses the existing array-backed vector test domain and
does not certify real pgvector dimension/operator behavior. Live migration and
full upgraded production schema remain deployment checks. Worker parser build,
Ubuntu installation/systemd behavior, actual hosted upload/cleanup, role tests,
retrieval quality and latency remain unverified until deployment. Vercel Preview
deployment protection may require an additional narrow worker transport bypass.

Current deployment walkthrough: [HOSTED-UPLOADS.md](HOSTED-UPLOADS.md).

## Cleanup independence correction

The first operator snapshot attempt returned `PENDING_JOBS_OR_VERSIONS`.
Read-only database inspection found six queued PURGE jobs and no unfinished
upload versions or ingestion jobs. Migration 029's shared job guard was too
broad for independent cleanup. Additive migration 030 restricts the job guard
to ingestion in both begin and commit/rollback. No existing job is cancelled,
rescheduled or deleted. Corpus hashes, epoch, version bindings and locks remain.
The original applied migration is unchanged.

Disposable PostgreSQL passed begin/cutover/rollback with queued cleanup,
rejection with queued ingestion at begin and commit, and restoration of the old
guard by the down migration. Lint and diff checks passed. No live schema was
changed by the agent; the operator must apply 030 before retrying begin.
