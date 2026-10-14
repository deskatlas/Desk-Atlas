# SPEC-6 operations

Traceability: PRD-F26/F27, SDD-C20-C24, QAD-TC46 / SPEC6-TC01-TC12.

This delivery owns local setup, CPU evaluation, admission and diagnostic primitives, release evaluation, and operational handoff. SPEC-4 and SPEC-5 are being implemented separately in the shared checkout. Passing these tooling tests does not enable either feature or certify their integrations.

## Reproducible local setup

The maintainer approved local dependency installation and model benchmarking on October 14, 2026. CPU evaluation runs on Python 3.10.11 in `.venv`; the private HTTP service requires Python 3.11+ and uses Python 3.12.14 in `.venv-service`. Neither environment modifies global Python packages.

```powershell
pnpm rag:setup
services/rag/.venv/Scripts/python.exe services/rag/provision_models.py
python services/rag/provision_ocr.py
pnpm test:spec6
pnpm rag:readiness --canary
pnpm rag:benchmark
services/rag/.venv/Scripts/python.exe services/rag/evaluate_retrieval.py
```

Use Python 3.12 to run `bootstrap_service.py` before starting the private HTTP service. That script installs CPU PyTorch from the official CPU index, then the combined `runtime-requirements.lock.txt` in `.venv-service`, and runs `pip check`. The combined environment includes the HTTP service, pinned test runner, and encoder dependencies required for `KB_ENABLED=true`. `evaluation-requirements.txt` and `requirements.lock.txt` describe the separate CPU evaluation environment. Linux uses `.venv/bin/python` paths. `service-requirements.lock.txt` describes the HTTP-only resolution; `runtime-requirements.lock.txt` describes the combined serving environment.

`models.json` pins immutable upstream revisions and preserves the Apache-2.0 license identity. Provisioning retains model cards and available license files. Runtime encoder loading is local-only and disables remote code. It rejects oversized input instead of silently truncating, checks finite 1024-element vectors and unit norms, and separates document encoding from the versioned query instruction. `ocr-artifacts.json` pins the eng/fil language revision and hashes; `provision_ocr.py` verifies bytes before installation in the ignored cache.

The Windows synthetic-test tools are LibreOffice 26.8.1.1 and Tesseract 5.4.0.20240606. Use `soffice.com` for captured version output on Windows; `soffice.exe` launches asynchronously. `readiness.py` checks exact dependencies, local artifacts, binaries, eng/fil data, and optionally a real encoder canary. It returns safe status codes and never prints environment values or document content. Production parser isolation still follows SPEC-5's network-disabled container contract. Installed local tools do not authorize processing untrusted uploads outside that sandbox.

## Encoder and service integration gates

The SPEC-6 HF baseline uses the canonical SHA-256 of the complete `models.json` embedding object. Parser/chunker configurations are separate. Do not copy an Ollama digest or an HF model revision into this fingerprint field. Do not treat normalized quantized Ollama vectors as interchangeable with HF float32 vectors.

The concurrent SPEC-4 adapter and SPEC-5 worker now share the HF `Encoder`, the manifest query instruction, and `.cache/models`. KB-enabled private service startup needs the CPU encoder dependencies as well as the HTTP dependencies. Existing catalog fingerprints must fail closed on mismatch; do not overwrite a live fingerprint or mix generations to make integration pass. A changed active encoder needs the complete, reviewed shadow-generation cutover from SPEC-5.

The answer-model candidate in `models.json` is a CPU evaluation candidate, not a production selection. The concurrent Ollama serving candidate is evaluated independently. Both need language, grounding, schema, injection, memory and latency acceptance. No hosted inference fallback is permitted.

`rag.config` validates the CPU evaluation configuration and independent feature switches. `rag.capacity.Admission` provides bounded waiting with cancellation/deadline cleanup; ingestion gets a separate instance. The HTTP service must deliberately integrate and benchmark admission settings: primitives passing tests does not establish that every serving setting is consumed. Keep the measured deadline/queue policy visible. Unknown queue measurements remain unavailable, never zero.

## Evaluation and release evidence

`evaluation/held-out.json` contains synthetic English, Tagalog and Taglish cases with roles, sources, tool/filter expectations, and exact table cells. `evaluation/corpus.json` contains only synthetic sources and distractors. Neither file is uploaded or published by these commands. Format labels stratify results; they are not proof that extraction of each format passed. Expected 2001-booking cases require corresponding oversized synthetic database fixtures in a test database before end-to-end scoring. Never run the load suite against a production customer corpus.

The CPU encoder/retrieval and answer benchmarks output metadata only. They distinguish model loading from warm execution and report timing, token counts, revision and process peak memory. Model responses stay in memory. Human procedural-quality review remains required. `evaluate_retrieval.py` is a small-corpus smoke test, not a release-sized retrieval calibration set.

Run complete gateway load only after authorized synthetic database/corpus setup. Supply five distinct verified test actors' bearer tokens as a JSON array in `RAG_BENCHMARK_AUTHORIZATIONS`, never command arguments or JSON fixtures. The gateway permits only one active request per actor, so reusing one login is not a five-user test. Stable worker assignment prevents overlapping requests from the same actor. Use separate runs/cases for admin and staff. The load command accepts only a local gateway origin, disables redirects/proxy inheritance, warms all five actors, then measures 25 requests with five simultaneous requests. It compares expected response kinds/tables in memory. A gateway `X-RAG-Queue-Ms` measurement is needed for queue evidence; absent timing blocks acceptance. Failures include timeouts, incorrect results and transport errors. HTTP success alone is not correctness evidence.

```powershell
pnpm rag:load --cases path/to/synthetic-local-load-cases.json
pnpm rag:evaluate --evidence path/to/evidence.json --observations path/to/observations.json
```

Evidence has a candidate Git revision; ratified thresholds; one PASS record for every SPEC6-TC01-TC12; nonempty zero-failure security, reporting, source_lifecycle, session_only and unsupported suites tied to that revision; and warm_end_to_end load measurements tied to the same revision. Each observation has case ID, role, behavior, tool, filters, retrieved_sources, reviewer_accepted, citations_valid, dangerous_instruction and unsupported_claim booleans, plus exact synthetic table cells where required. Store no real customer/financial rows in evidence.

`evaluate.py` exits nonzero for missing/stale/duplicate evidence, missing language/format coverage, unsafe or unsupported claims, table/tool/filter mismatches, failed security cases, incomplete queue timings or missed thresholds. Recall@6 is measured separately by language and format, with absent observations counted as misses. Proposed defaults are 95% recall, 90% reviewer acceptance and warm five-user p95 <=15 seconds. The owner must ratify thresholds before release evaluation. CPU microbenchmarks cannot satisfy the warm_end_to_end gate. Test-created PASS evidence is used only to test the evaluator and is never saved as release acceptance.

## Safe monitoring and recovery

Persist only explicitly constructed metadata such as request/job IDs, safe stage/error codes, duration, queue depth, token/chunk counts, and revision. `rag.telemetry.metadata` excludes arbitrary payload keys, exception messages and nonfinite measurements. Disable request/response body logging in the gateway, proxy, inference server, tracing, parser stderr and error reporting. Metadata filtering at one boundary does not certify third-party logging defaults.

| Incident | Operator action and evidence |
|---|---|
| Assistant regression | Set RAG_ENABLED=false on app servers, restart/redeploy configuration, verify query ingress is disabled and normal bookings/payments still work. No database rollback needed. |
| KB regression | Set KB_ENABLED=false, stop new claims/writes, retain accepted PostgreSQL jobs, investigate safe job codes. RAG_ENABLED is independently reversible. |
| Model unavailable | Report explicit unavailability or verified deterministic tables. Never call an external inference service. |
| Database unavailable | Mark data unavailable. Never replace failures with zero counts. |
| Worker crash/missed wakeup | Reconciler reclaims eligible/expired jobs. Verify fresh lease/generation fences reject stale completion and result notices deduplicate. Do not manually clear fencing fields. |
| Conversion/OCR error | Review safe failure notice. Correct source externally and upload a successor. Existing published version stays active. |
| Removed source/purge error | Keep tombstone and retrieval revocation. Retry durable purge; do not republish merely to repair cleanup. |
| Encoder regression | Keep the previous complete compatible generation. Prepare/review all shadow successors before atomic catalog cutover. Never mix fingerprints. |
| Credential exposure | Rotate service and capability secrets independently, invalidate active requests, restart private components. Preserve content-free incident metadata. |
| Schema rollback | Disable writes, stop/expire leases, preserve necessary metadata, test/apply only the reviewed feature down migrations. Keep booking/payment tables intact. |

Diagnostics and superseded-version retention await owner ratification. No seven-day recovery window or backup retention is silently selected. Removed sources revoke retrieval immediately; provider backup retention needs separate review. Production scheduler/reconciler, scope/identity checks, backup restore and database rollback need staging evidence, not only a local unit test.

## Container and rollout gates

The private service base image is pinned to Python 3.12.14 slim-bookworm OCI digest `sha256:392307d22300de8b5986851a12d9176dfc0fc073e65bf6523ebd7dcbeb23564e`, verified against the registry. `runtime-requirements.lock.txt` combines the verified CPU encoder and service resolutions, with the service pins taking precedence for shared HTTP packages. The image installs CPU PyTorch explicitly and includes the encoder code/manifest. Mount the provisioned `.cache/models` read-only at `/app/.cache/models`; model weights are never copied into the image or downloaded at startup. Cross-platform lock compatibility still requires a real Linux image build.

`.dockerignore` excludes both virtual environments, model/language caches, artifacts, benchmark results and environment files. Use a nonroot user, one process, private networking and no access logs. Capture image digest, vulnerability/license scan and container probes before approval. The SPEC-5 parser image still needs its distro dependency lock and scan.

Production provider/region/budget/transport, retention, source-policy approvals, ratified quality targets, real PostgreSQL/RLS/race/rollback tests, parser isolation, five-user load with simultaneous OCR, cold starts and trained operator handoff remain release gates. No paid resource provisioning, migration execution, source publication or production flag activation occurs in this delivery.
