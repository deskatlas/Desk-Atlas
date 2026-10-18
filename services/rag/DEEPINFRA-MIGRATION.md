# DeepInfra answer provider amendment

Authority: maintainer's October 18, 2026 request to use DeepInfra, explicit
selection of `Qwen/Qwen3-32B`, successful direct API test, creation of the
`deepinfra-api-key` secret and instruction to implement on `Remote-model`.

Traceability: PRD-F26/F27, SDD-C20/C21/C22, QAD-TC44/46. This amendment supersedes
the local-inference-only restriction for an explicitly selected DeepInfra answer
provider. It authorizes no automatic hosted fallback or additional dependency.
This tracked amendment accompanies the local documentation index because the
repository ignores the master `docs/` specifications.

The Python service sends existing bounded prompts and currently authorized
evidence to the fixed DeepInfra HTTPS endpoint using existing HTTPX. Service
authentication, signed capabilities, cancellation, context/work budgets, strict
output validation, evidence checks and final gateway authorization remain.
The existing float32 embedding model and catalog fingerprint stay unchanged.

DeepInfra model IDs are provider-managed, not immutable weight revisions.
Ollama digest checks remain mandatory for the local provider. DeepInfra startup
instead requires a successful synthetic constrained-output request. Health
metadata additionally reports `answer_provider` and `answer_model`, behind the
existing authentication. Failed/truncated/refused completions fail closed.
Reasoning is disabled through the provider parameter and Qwen prompt switch.
Secrets are injected server-side and not forwarded to ingestion/cleanup workers.

The prepared Cloud Run revision reuses the existing private staging service,
removes its Ollama sidecar and keeps existing API resources and embedding
artifacts. Previous revisions support rollback. This change does not implement
cloud ingestion or enable production/staff identity access. Representative
grounding, role boundaries, cold starts and latency require separate acceptance.

See [deployment steps](cloudrun/DEEPINFRA.md) and
[verification](DEEPINFRA-IMPLEMENTATION.md).
