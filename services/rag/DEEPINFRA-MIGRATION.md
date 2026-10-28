# DeepInfra answer provider amendment

## October 28 additional latency benchmark

The maintainer explicitly authorized another DeepInfra model benchmark with a
$1 cumulative ceiling. `google/gemini-3.1-flash-lite` and
`google/gemini-3.5-flash` and `deepseek-ai/DeepSeek-V4-Flash` are eligible benchmark candidates. This does not
change serving defaults or authorize production adoption before useful-answer
and complete-response acceptance. The read-only diagnostic reserves conservative
input/output cost before each candidate request, retains failed reservations,
and serializes benchmark processes through an exclusive local ledger lock.
Successful reservations settle against validated provider token counts at
undiscounted rates; missing, invalid or failed usage retains the full reservation.
PRD-F26/F27, SDD-C20-C24 and QAD-TC44/46 retain full-original, independent
verification, principal, source and epoch requirements.

## October 28 RAG repair benchmark authorization

The maintainer explicitly approved benchmarking
`Qwen/Qwen3-235B-A22B-Instruct-2507` and adopting it only after answer quality
and complete-response tests pass the under-10-second gate. `Qwen/Qwen3-32B`
remains the default. The explicit allowlist is extended by the later approval
below; no provider/model fallback is introduced. Embedding configuration
is unchanged. See [the RAG repair evidence](RAGFIX-IMPLEMENTATION.md).

For the new candidate, internal complete-document batching may use a scoped
131,072-token limit, below its documented 262,144 native context, and the same
240,000-byte transport and existing aggregate-work limits. Its pinned upstream
tokenizer at revision `ac9c66cc9b46af7306746a9250f23d47083d689e` is byte-identical
to the hash-verified tokenizer already provisioned for the 32B candidate.
No deployment or model adoption is implied by this benchmark authorization.

The maintainer subsequently approved a benchmark of up to twelve questions
with `Qwen/Qwen3.6-35B-A3B`, with adoption subject to the same quality and
under-10-second gate. This adds a third explicitly permitted model ID; it does
not enable a fallback. The planner may remain on 32B while
`RAG_DOCUMENT_ANSWER_MODEL` explicitly selects the document model. Both roles
must pass separate startup canaries when they differ. The 235B mixed-role
benchmark did not pass the latency gate and has not been adopted.

Qwen3.6 uses a conservative UTF-8 byte input bound within its documented
262,144-token native context, rather than borrowing the Qwen3 tokenizer.
The 240,000-byte model transport limit, output/template headroom, aggregate
work ceilings, full original-source checks and independent verification remain.

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
