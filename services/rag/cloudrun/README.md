# Cloud Run staging image preparation

Authority: maintainer's October 17, 2026 Cloud Run deployment request; PRD-F26,
SDD-C20-C22, QAD-TC44/46, SPEC-6 phase 7. This stage builds the chat images only.
It does not deploy a service, change Vercel, apply migrations, activate feature
flags, or implement Cloud Run ingestion. The master specifications are ignored
by Git and were read from the primary checkout's docs directory.

The API packages the unchanged pinned float32 Qwen encoder. Ollama 0.40.5 uses
the registry-verified Linux amd64 base digest and packages the existing Qwen3 4B
candidate. Its build refuses a changed model manifest digest. Model selection
and retrieval fingerprints are unchanged. Runtime evaluation remains required.
Runtime images never download models. Keep license/model card notices in images.

## Manifest verification repair

Build `0a798d56-435d-4b77-9375-72bad23064e5` completed the API image but failed
in Ollama provisioning because the original script hashed the named manifest.
Ollama 0.40.5 can append an original-manifest reference layer to that local file.
The wrapper checksum differs even though the serving API reports the pinned
registry digest. The same mismatch was reproduced against the local artifacts.

The build now verifies in a separate stage with the existing Python base and
standard library. It accepts a directly pinned original or a wrapper exactly
equal to that original plus its reference layer. It hashes the original bytes
and every config/model/template/license/parameter blob, checking sizes too.
No model digest or runtime authentication check changed. The runtime stage
depends on a marker copied only after successful verification.

Verification: five standard-library regression tests passed, including corrupt
weights, a changed original and a changed wrapper. Verification of the actual
local Qwen3 4B artifacts passed. Full repaired Cloud Build remains to be run.
Repository-wide checks remain unavailable in this worktree without its missing
JavaScript dependencies. No live resource or application setting was changed.

```powershell
python -m unittest discover -s services/rag/cloudrun -p test_verify_answer.py -v
```

Run from this worktree's services/rag directory in Windows PowerShell:

```powershell
gcloud.cmd config get-value project
gcloud.cmd meta list-files-for-upload
gcloud.cmd builds submit . --config=cloudrun/build.yaml --ignore-file=.gcloudignore --region=us-central1
```

Inspect the upload list before submitting. Only the API, serving libraries,
model manifest, dependency lock and build recipes should appear. No credentials,
uploaded files, model caches, audit documents or test fixtures are needed.
The command incurs Cloud Build, source staging storage, image storage and any
applicable network charges. It does not create a continuously running service.
Images are tagged with the unique Cloud Build ID. Preserve both resulting image
URLs and digests for the service deployment step. A successful image build does
not establish model quality, capacity or production readiness.

Build identities and deployment identities are separate. If a build fails due
to IAM, inspect the exact denied operation and account before granting narrowly
scoped access. Do not grant Owner/Editor or create downloadable service keys.

The eventual service must expose only API port 8000, keep Ollama on loopback,
retain API token and capability checks, inject secrets at runtime, and start
with minimum instances zero, maximum one and conservative concurrency. Use
authenticated Cloud Run ingress for initial testing. Vercel identity integration,
startup probes, cold-start request flow and measured resource allocation remain
separate implementation steps. Do not directly change the existing production
deadline or publish unauthenticated Ollama to make startup tests pass.

Ingestion still requires a finite job runner, authenticated durable dispatch
and recovery, and a parser transport preserving the current network-disabled,
credential-free sandbox. The existing nested Docker worker cannot simply run
inside a Cloud Run Job unchanged.

## Private startup deployment

`chat-staging.yaml` targets project `deskatlas-rag` and immutable image digests
from successful build `005f9e44-ce56-4ae3-b3fb-b2dae7cb86aa`. It uses two CPUs and
8 GiB for each container, one concurrent request, zero minimum instances and one
maximum instance per revision. This is a benchmark allocation, not a capacity
claim or hard spending cap. Cloud Run can briefly exceed instance limits during
replacement; avoid accumulating revisions with their own traffic allocations.

Before deployment, create `rag-chat-runtime` with access only to secret versions
of `rag-service-token` and `rag-capability-secret`, both separate random values
of at least 32 characters. The manifest pins secret version 1. No secrets are
stored in YAML. Create these with Secret Manager and grant the runtime identity
Secret Accessor on each individual secret. Do not grant database access.

The new service starts private under Cloud Run IAM by default. `ingress: all`
allows authenticated external callers; it does not grant unauthenticated IAM
access. Do not grant allUsers. API requests additionally require the existing
service token and signed capability. Ollama has no ingress port. Its socket
accepts instance startup probes, and API startup waits for Ollama's probe.
API TCP readiness waits for FastAPI lifespan, which loads the encoder and checks
and preloads the pinned answering model. Do not use an unauthenticated HTTP
probe on the existing capability-protected /health endpoint.

```powershell
gcloud.cmd run services replace cloudrun/chat-staging.yaml --region=us-central1 --project=deskatlas-rag
gcloud.cmd run services describe deskatlas-rag-chat-staging --region=us-central1 --project=deskatlas-rag --format="yaml(status.conditions,status.url)"
```

The 300-second platform timeout does not override application deadlines or the
60-second signed capability lifetime. This step verifies startup only. Keep
Vercel feature flags disabled until private identity transport, request budgets,
held-out answers, role boundaries and cold-start latency have been verified.
KB_ENABLED in the Python container loads the embedding model; it does not
enable the Vercel upload UI or deploy an ingestion worker.

Private hosted health check on October 17, 2026 passed for revision
`deskatlas-rag-chat-staging-00001-zgb`: no Google identity returned 403; Google
identity alone returned 401; an invalid capability returned 401; all valid
credentials returned 200 and ready=true. The reported serving fingerprint
matched the current worktree. These are warm checks, not cold-start or answer
quality measurements. Both models were required by the configured startup.

`cloudrun/check_private.py` repeats this bounded check using the signed-in
operator CLI. It reads secret version 1 into process memory, sends a Google ID
token in X-Serverless-Authorization, and retains the application's Bearer token
in Authorization. It prints only statuses and timings, never secrets or bodies.
It rejects public IAM bindings and compares the deployed implementation hash.
No prompts, source documents or customer records are sent or persisted.

Vercel workload identity federation and signed application calls still need
integration before enabling the app flags. Do not solve the missing Google
identity header by granting unauthenticated access to the service.

## Admin dev Preview gateway

The maintainer configured team issuer `https://oidc.vercel.com/desk-atlas`,
audience `https://vercel.com/desk-atlas`, and subject
`owner:desk-atlas:project:desk-atlas-admin-portal:environment:preview` in
`projects/252244258272/locations/global/workloadIdentityPools/vercel-preview/providers/vercel`.
Only that subject can use the separate
`vercel-rag-preview@deskatlas-rag.iam.gserviceaccount.com` caller, which has
Cloud Run Invoker on the staging chat service. The caller does not need Secret
Accessor. Workload Identity User on the caller permits ID-token minting.

`cloudRun.ts` reads the runtime x-vercel-oidc-token request header. It exchanges
the assertion at Google's fixed STS endpoint, then mints a service-audience ID
token at Google's fixed IAM Credentials endpoint. It uses existing fetch and
AbortSignal APIs, introduces no dependency and keeps both token responses in
request memory. The single request's exchange promise is reused across model
calls. No token is cached globally or accepted from the browser as a Google
credential. Remote response bodies and network errors never enter diagnostics.

Set these server variables only for this project's Preview environment and dev
branch. RAG_GOOGLE_AUTH=vercel-oidc additionally requires VERCEL=1,
VERCEL_ENV=preview and VERCEL_GIT_COMMIT_REF=dev. Google still verifies the full
assertion. Missing headers, unsupported modes and malformed targets fail closed.
Local transport retains the existing behavior when the mode is unset. Public
run.app targets require the cloud mode; redirects are rejected.

| Variable | Value |
|---|---|
| RAG_GOOGLE_AUTH | vercel-oidc |
| RAG_GOOGLE_WORKLOAD_PROVIDER | projects/252244258272/locations/global/workloadIdentityPools/vercel-preview/providers/vercel |
| RAG_GOOGLE_SERVICE_ACCOUNT | vercel-rag-preview@deskatlas-rag.iam.gserviceaccount.com |
| RAG_SERVICE_URL | https://deskatlas-rag-chat-staging-2ttaxxsoaa-uc.a.run.app |
| RAG_SCOPE_ID | deskatlas |
| RAG_EMBEDDING_FINGERPRINT | e8a8211561f2eeee9504e69cb6927ece0cf628c8ad52eb8da07a417849d7e2fe |
| RAG_SERVICE_TOKEN | Exact version 1 value of rag-service-token |
| RAG_CAPABILITY_SECRET | Exact version 1 value of rag-capability-secret |

Keep RAG_ENABLED=false during environment and code deployment. Preserve current
knowledge catalog/fingerprint, evidence contract and calibrated similarity
settings; do not initialize, rewrite or publish knowledge to bypass an error.
This work does not enable ingestion. The existing gateway deadline and 60-second
capability remain intact; a complete cold start may still exceed the request
budget. First verify a warm synthetic request before cold-start acceptance.

The outgoing RAG request keeps its original service Bearer token and capability
and adds Google's ID token in X-Serverless-Authorization. These credentials are
not interchangeable. Every model operation in the gateway uses this transport;
role authorization, evidence checking, arithmetic and DB interfaces stay intact.
The staff app imports this gateway, but its Preview project has not been granted
Google access and must not receive the admin Preview configuration.

Local verification of this gateway change: pnpm typecheck and pnpm build
passed for all apps; pnpm lint passed with RAG_LINT_PYTHON pointing to the primary
checkout's existing isolated Python interpreter. The complete TypeScript suite
reported 2,304 passed and 43 skipped. Focused transport/gateway tests passed
53 cases, including independent Google/service/capability headers, per-request
token isolation, dev Preview restrictions, missing runtime assertions, provider
errors, cancellation and unchanged local transport. Hosted Vercel federation
remains unverified until matching code and environment configuration are deployed.
