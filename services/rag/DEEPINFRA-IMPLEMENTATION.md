# DeepInfra implementation verification

Date: October 18, 2026. Branch: `Remote-model`.
Authority: [provider amendment](DEEPINFRA-MIGRATION.md), PRD-F26/F27,
SDD-C20-C22, QAD-TC44/46.

## Implemented

The explicit `RAG_MODEL_PROVIDER=deepinfra` branch uses the fixed HTTPS endpoint,
the selected `Qwen/Qwen3-32B` ID and server-injected `DEEPINFRA_API_KEY`.
Reasoning is disabled by parameter and Qwen prompt switch. Strict JSON schemas
are adapted from the existing Pydantic contracts, then outputs are independently
validated. Refusals, truncation, wrong models, malformed responses, invalid
usage, redirects and transport errors fail closed. There is no retry/fallback
to another provider. Existing cancellation and request budgets apply to the
actual serialized provider request. HTTP clients close on startup failure too.

The default Ollama provider retains its digest and GPU behavior. DeepInfra keys
are excluded from worker/purge environments. Embeddings, database contracts,
source authorization and final evidence checks are unchanged. Authenticated
health adds provider/model metadata and fingerprints the new serving module.

Cloud build and manifest-preparation scripts are provided. Preparation reads
live settings, preserves existing API configuration and removes the Ollama
sidecar while adding the numbered DeepInfra secret reference. No build or
deployment was performed during this implementation turn.

## Verification

| Check | Result |
|---|---|
| `pnpm typecheck` | Passed across workspace apps/packages |
| `pnpm lint` | Passed: 32 Python files and 30 TypeScript files |
| `pnpm test` | 2,313 passed, 43 skipped |
| `pnpm build` | Passed across all apps |
| Python provider/startup/cancellation/identity/assistant/MS65 checks | 109 passed |
| Python provider/MS48/MS57/MS59/MS60 checks | 106 passed; overlaps previous set |
| Real DeepInfra adapter with Secret Manager key | Startup, passage selection, evidence verdict and nested planning schema passed |
| Cloud source upload allowlist | Inspected; includes provider/build source, excludes credentials/caches/uploads/test artifacts |
| `git diff --check` | Passed |

The real checks used synthetic input only. An initial passage-selection probe
did not select its expected index. The explicit JSON schema test and Qwen
non-thinking prompt switch passed the final run. This is API integration
evidence, not representative retrieval/grounding or latency acceptance.

Cloud image build, deployment, authenticated hosted checks, normal-role website
questions, cold starts and cloud ingestion remain unverified. See the
[step-by-step deployment runbook](cloudrun/DEEPINFRA.md). No credentials were
written into source or printed by the check scripts. No live app flags,
public IAM access or database settings changed.
