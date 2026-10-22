# Staff production assistant configuration

Traceability: PRD-F26/F27, SDD-C20/C21, DSD-UI16, QAD-TC44/46.

The maintainer authorized repairing the missing deployed staff chatbot on
October 22, 2026. The production staff deployment already contains the launcher
and assistant route adapters at commit `00a18fe`. Its Vercel project had no RAG
variables. An ephemeral, one-hour signed staff probe against the existing
active staff profile returned HTTP 200, role STAFF, enabled false. No actor
identifier, credential, answer text or source text was printed or recorded.

## Configuration

Project: `desk-atlas-staff-dashboard`, Production only.
Domain: `https://staff.thedeskatlas.com`.

| Variable | Value |
|---|---|
| RAG_ENABLED | true |
| KB_ENABLED | true |
| RAG_GOOGLE_AUTH | vercel-oidc-production |
| RAG_GOOGLE_WORKLOAD_PROVIDER | projects/252244258272/locations/global/workloadIdentityPools/vercel-production/providers/vercel |
| RAG_GOOGLE_SERVICE_ACCOUNT | vercel-rag-staff@deskatlas-rag.iam.gserviceaccount.com |
| RAG_SERVICE_URL | https://deskatlas-rag-chat-production-2ttaxxsoaa-uc.a.run.app |
| RAG_SCOPE_ID | deskatlas |
| RAG_EMBEDDING_FINGERPRINT | b1525f4ca8f9625181691cabb3fbf33bb1274aa9229567de3f623f55053823ca |
| RAG_MIN_SIMILARITY | 0.5 |
| RAG_REQUEST_DEADLINE_MS | 55000 |
| RAG_CAPACITY | 5 |
| RAG_SOP_FAST_PATH | true |
| RAG_SYNTHESIS_ENABLED | true |

The server-only RAG_SERVICE_TOKEN and RAG_CAPABILITY_SECRET are copied in
process memory from the production Cloud Run service's corresponding Secret
Manager version 1 references. Values are hidden and never committed.

The existing `vercel-production` provider condition now accepts exactly the
admin Production subject and the staff Production subject. The new staff
service account grants workloadIdentityUser only to the staff Production
subject and has run.invoker on the production RAG service. Admin and customer
service account bindings are preserved. No public invocation is introduced.
The existing shared production transport supports this provider without
application code changes. The hosted chat and embedding models remain
Qwen/Qwen3-32B and Qwen/Qwen3-Embedding-4B.

## Verification

Initial live staff availability: HTTP 200, enabled false, role STAFF.
Redeployed the existing production commit as
`desk-atlas-staff-dashboard-9evhmluzt-desk-atlas.vercel.app`, aliased to
`https://staff.thedeskatlas.com`. The Vercel build completed successfully.

Post-redeployment availability: HTTP 200, enabled true, role STAFF. The first
lost-property probe timed out after 55.66 seconds; Cloud Run request metadata
showed its planning call alone took 51.08 seconds. Immediate probes using the
same staff identity encountered CAPACITY_BUSY. A subsequent probe using another
existing active staff profile returned HTTP 200, SUPPORTED, SYNTHESIZED, five
citations, in 37.56 seconds. Its only limitation was the informational notice
that quotations retain the published source language. No answer or source text
was printed. Hosted latency is variable; this check does not establish a broad
performance guarantee or replace the maintainer's normal signed-in browser test.

Full repository builds and tests are not required for an environment-only
repair; the Vercel redeployment builds the existing production commit.
