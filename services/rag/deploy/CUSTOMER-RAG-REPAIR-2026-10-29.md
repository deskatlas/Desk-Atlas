# Customer conversational RAG service deployment

Date: October 29, 2026, Asia/Irkutsk.
Authority: maintainer requested RAG-only deployment and reserved application
deployment for themselves. Traceability: PRD-F1-F4/F26/F27, SDD-C20-C24,
MS77-TC01/05/08/12 and QAD-TC44/46.

## Delivered

The existing private Cloud Run service `deskatlas-rag-chat-production` now
routes 100% of production traffic to
`deskatlas-rag-chat-production-conv1029-q35`.

| Identity | Value |
|---|---|
| Project / region | deskatlas-rag / us-central1 |
| Cloud Build | 185ab813-d53a-4e51-948c-c301cbf318fb |
| Immutable image | us-central1-docker.pkg.dev/deskatlas-rag/deskatlas-rag/api-hosted@sha256:5d9ae641a9ea8699a2981173e3a97b00e8136d546541fece604f2f2f08c3757b |
| Loaded implementation | 307f0a7dc710e652eb25718907bcc834f2f57b93269bef6dbbc6447a44cab433 |
| Planning and document model | Qwen/Qwen3.6-35B-A3B, standard tier, reasoning disabled |
| Previous traffic revision | deskatlas-rag-chat-production-00014-7xz |
| Stable service URL | https://deskatlas-rag-chat-production-2ttaxxsoaa-uc.a.run.app |

Only the allowlisted RAG serving sources and hosted image build recipes were
uploaded. Environment files, credentials, document uploads, local caches,
audits and test artifacts were excluded. Focused Python customer and Qwen
transport suites passed 81 tests immediately before the build.

No Vercel application, application environment variable, database, migration,
worker or published source was deployed or changed. The stable service URL,
runtime secret references, embedding provider/fingerprint, scope, feature
flags, service account, request timeout, concurrency and 1 CPU / 1 GiB resource
limits were compared with the original configuration and preserved. IAM remains
private with no allUsers/allAuthenticatedUsers grant. Temporary revision tags
were removed after release verification.

## Model admission findings

The previous production revision selected Gemini Flash Lite. The repaired
candidate retains the approved Qwen family. The first no-traffic revision used
Qwen3-32B for planning and Qwen3.6-35B-A3B for document work. Although startup and
auth checks passed, two real legacy-plan attempts timed out after approximately
45 seconds. It never received production traffic.

A second no-traffic revision used the already-approved Qwen3.6-35B-A3B for both
roles. Legacy and new direct-plan checks passed, as did compact catalog checks.
This explicit profile was promoted; there is no runtime model fallback or
priority-tier pricing. Individual probes are not a latency SLA or broad
customer-answer quality campaign.

## Hosted verification

`scripts/rag-verify-deployment.py` uses the signed-in operator CLI to load
existing referenced secret versions into process memory and invoke the private
service. It prints only stage/status/timing metadata and saves no credentials,
raw provider responses, documents or customer records. The catalog probe uses
one synthetic public fixture; it does not read the real corpus.

| Check through the final stable URL | Result |
|---|---|
| Missing Google identity | 403 |
| Google identity without application token | 401 |
| Invalid capability | 401 |
| Fully authenticated health | 200, ready, exact local fingerprint and Qwen profile |
| Internal capability on customer endpoint | 401 |
| Legacy first-time booking plan | 200, KNOWLEDGE, original field shape; 1,187 ms |
| New Focus Pod / 7am / today plan | 200, WORKSPACE, category/time/relative date retained, duration absent; 1,860 ms |
| Private booking request | 200, BOOKING |

Before promotion, the compact catalog route also passed both old and new
contracts (4,531 ms and 2,141 ms). Runtime configuration and final 100% traffic
allocation were separately verified after the switch.

Receipts:

- [Tagged direct-plan checks](../../../outputs/customer-rag-audit-2026-10-29/deployment-tag-verification.json)
- [Tagged catalog checks](../../../outputs/customer-rag-audit-2026-10-29/deployment-catalog-verification.json)
- [Final stable-URL checks](../../../outputs/customer-rag-audit-2026-10-29/deployment-live-verification.json)

## Application handoff and rollback

The RAG service accepts older gateway requests and omits newly negotiated plan
fields unless `conversation_contract=constraints-v1` is requested. Deploy the
prepared application code to use conversational constraint resolution, saved
discovery updates, offered-label follow-ups and failed-turn presentation. No
RAG_SERVICE_URL or credential change is needed for that application release.

The original broad-question website failures are not all resolved on the hosted
website until the maintainer deploys its matching application code. This release
verifies RAG service readiness, private boundaries and plan compatibility; it
does not claim the yet-to-be-deployed website has passed browser acceptance.

Rollback, if needed, uses the existing prior revision and requires no source
rebuild or secret change:

`gcloud.cmd run services update-traffic deskatlas-rag-chat-production --project=deskatlas-rag --region=us-central1 --to-revisions=deskatlas-rag-chat-production-00014-7xz=100`

The prior immutable image and revision were retained. This command is recorded
for recovery, not executed as part of the successful deployment.
