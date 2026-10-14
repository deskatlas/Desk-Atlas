# SPEC-6 local implementation evidence

Recorded October 14, 2026. Scope: SPEC-6 operations, with SPEC-4/5 implemented concurrently in this checkout. This record contains synthetic-test metadata only. It is not a production release certificate.

## Workstation and artifacts

| Item | Verified value |
|---|---|
| CPU | AMD Ryzen 5 5600, 6 cores / 12 logical processors |
| RAM | 31.93 GiB reported by Windows |
| GPU | AMD Radeon RX 6650 XT; not used for these CPU runs |
| Evaluation Python | 3.10.11, isolated `.venv` |
| HTTP service Python | 3.12.14, isolated `.venv-service` |
| Encoder | Qwen/Qwen3-Embedding-0.6B, revision 97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3 |
| Answer candidate | Qwen/Qwen3-0.6B, revision c1899de289a04d12100db370d81485cdf75e47ca |
| Encoder output | 1024 dimensions, finite, L2 normalized, CPU float32 |
| LibreOffice | 26.8.1.1, installer hash verified by winget, captured CLI version verified |
| Tesseract | 5.4.0.20240606, installer hash verified by winget |
| OCR languages | eng/fil, immutable tessdata_fast revision and SHA-256 in ocr-artifacts.json |
| Container base | Python 3.12.14 slim-bookworm OCI digest verified against registry |

Python pins, immutable model revisions and approved binary versions were registered in SDD/BUILD before local use. The direct CPU evaluation, resolved CPU, resolved service and combined runtime dependency files remain separate. Both installed Python environments pass `pip check`. Weights, OCR language files, caches and environments remain ignored. No production migration or source publication was performed.

Both downloaded model weight files were SHA-256 verified against their upstream content-addressed blobs; expected hashes are pinned in models.json. Provisioning, encoder startup and candidate benchmark loading reject modified bytes. The extra hash-integrity guard was added after the initial timing samples below; cold-load measurements do not include that later checksum pass.

## Commands actually run

| Command/check | Observed result |
|---|---|
| `python services/rag/bootstrap.py` | CPU environment installed successfully after correcting the old pip/CPU-index resolver issue |
| `provision_models.py` in CPU environment | Both immutable model snapshots downloaded successfully; license/card files retained |
| `bootstrap_service.py` using Python 3.12.14 | Service environment installed with current SPEC-4 requirements |
| `pnpm test:spec6` | 28 operations tests passed |
| Assistant Python tests in service environment | 6 passed; one Starlette/AnyIO deprecation warning |
| Knowledge ingestion Python tests in CPU environment | 23 passed |
| `pnpm rag:readiness --canary` | Local artifacts, exact CPU dependencies, converter, OCR engine/data and real 1024-dimensional normalized canary passed |
| Synthetic eng+fil OCR smoke | Expected English/Filipino sample words found; approximately 797 ms; scratch image removed |
| `pnpm typecheck` | Passed on latest rerun |
| `pnpm lint` | Exit 0; current scripts are package echo placeholders, not substantive ESLint checks |
| `pnpm build` | All four applications passed on latest rerun |
| `pnpm test` | 216 suites passed, 1 failed; 1877 tests passed, 1 failed, 2 skipped at that snapshot |
| Full-suite failure | Existing SPEC2-TC05 expects CampaignRuleInputSchema to reject invalidReward, but it accepts it; `tests/spec2-campaigns-and-rewards.test.ts:327` |
| Release evaluator with empty evidence | Exit 1, release_ready=false, 28 blocking reasons; no missing evidence inferred as passing |
| `git diff --check` | Passed |
| Docker daemon | Unavailable through DockerDesktopLinuxEngine, including after hidden Desktop startup attempt; container builds/scans not claimed |

Earlier typecheck/build runs encountered a transient type error in the concurrently implemented assistant gateway. Its owner corrected it; the latest runs pass. The full test-suite failure is recorded independently rather than changing unrelated campaign behavior in this operations delivery. Concurrent edits mean these command results describe the tested snapshots, not future changes.

## CPU measurements

All numbers below are model microbenchmarks. They exclude gateway authorization, database tools, complete answer composition, and five-user queuing. Local concurrent development/build activity makes these indicative workstation measurements, not a dedicated performance laboratory result.

| Profile | Measured result |
|---|---|
| Encoder first five warm query samples | p50 320 ms, p95 366 ms; cold model load 18.9 s; peak process memory 3.91 GB |
| Encoder samples during complete benchmark | p50 692 ms, p95 773 ms; cold model load 18.0 s; peak process memory 3.91 GB |
| Qwen3-0.6B answer candidate | Three sequential English/Tagalog/Taglish samples after warm-up; p50 4.61 s, p95 4.99 s |
| Answer candidate loading/memory | Cold model load 2.25 s; parameter storage 2.38 GB; whole-process peak 5.61 GB (includes earlier encoder work) |
| Generated answer token counts | 18 / 25 / 10; quality NOT_REVIEWED; no answer text persisted |
| Synthetic retrieval smoke | 19 answerable held-out questions over 24 synthetic sources; recall@6 1.00 overall and in each language/format label; query loop 19.8 s |

The retrieval smoke corpus is small and synthetic. Format labels do not prove conversion/OCR quality. Reporting cases with an expected count of 2001 need matching oversized synthetic database fixtures before end-to-end evaluation. Proposed release thresholds remain unratified. The candidate's short-response speed does not establish tool-schema compliance, grounded procedural quality, or acceptable five-user p95. No final answering model is release-selected.

## Operational acceptance status

| Case | Local evidence and remaining acceptance |
|---|---|
| SPEC6-TC01 | Pinned setup, offline artifact loading, real dimension/norm canary and ignored caches verified; Linux image reproducibility remains unverified |
| SPEC6-TC02 | CPU embedding and one answer candidate measured; model/license metadata recorded; full language/tool quality and comparison with serving candidate remain pending |
| SPEC6-TC03 | Five-worker harness and queue/deadline cancellation tests pass; complete five-actor gateway load, queue instrumentation and exact synthetic results pending |
| SPEC6-TC04 | Isolated admission primitives tested; real OCR plus interactive load interference pending |
| SPEC6-TC05 | Process model loading measured; container cold start/scale-to-zero and durable accepted-job checks pending |
| SPEC6-TC06 | Lifecycle implementation/tests belong to SPEC-5; actual PostgreSQL reconciler/crash/fencing/notification evidence pending |
| SPEC6-TC07 | Private API auth tests pass; staging platform/service identity and five verified actor tests pending |
| SPEC6-TC08 | Metadata allowlist/adversarial tests pass; complete proxy/APM/model/parser configuration audit pending |
| SPEC6-TC09 | Recovery/removal runbook documented; provider backup retention, owner decisions and restore evidence pending |
| SPEC6-TC10 | Independent disabled-by-default flags and failure recovery documented; real index/feature rollback evidence pending |
| SPEC6-TC11 | Held-out synthetic cases, smoke retrieval and fail-closed evaluator implemented; ratified thresholds and complete acceptance evidence pending |
| SPEC6-TC12 | Setup, measured resources, recovery, release gates and operator handoff documented; production hosting/budget authorization and operator walkthrough pending |

RAG_ENABLED and KB_ENABLED remain off by default. Release readiness stays withheld until the remaining integration, data, security, quality and operational evidence is collected and the owner authorizes the staging-verified deployment.
