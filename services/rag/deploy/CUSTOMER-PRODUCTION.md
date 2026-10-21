# Customer production deployment

Authority: October 21 maintainer request to deploy directly to
https://www.thedeskatlas.com using Vercel project
`desk-atlas-customer-website` and the existing hosted models and API.
Traceability: PRD-F26/F27, SDD-C20-C24, QAD-TC44/46, MS76-MS79.

The initial production transport is an explicit customer-only mode,
`vercel-oidc-customer-production`. A dedicated Google identity pool and service
account admit only subject
`owner:desk-atlas:project:desk-atlas-customer-website:environment:production`.
The account can invoke the existing production Cloud Run service but has no
Secret Manager, database or admin service-account authority. Existing admin
and Preview IAM remain intact. Google still validates every signed assertion.
Request-scoped identity tokens are never exposed to browsers or stored globally.

Transport configuration is staged before activation. All four customer feature
flags stay false until database, hosted endpoints, role boundaries and abuse
controls pass. CUSTOMER knowledge must be public general policy. Owned booking
information requires verified customer authority. Deployment reuses existing
DeepInfra chat/embedding models and corpus fingerprint, without re-indexing.

## Staged Google identity

October 21: created pool `vercel-customer-production`, provider `vercel` with
issuer `https://oidc.vercel.com/desk-atlas`, audience
`https://vercel.com/desk-atlas` and the exact subject condition above. Granted
that subject Workload Identity User on
`vercel-rag-customer@deskatlas-rag.iam.gserviceaccount.com`; granted the account
Cloud Run Invoker only on `deskatlas-rag-chat-production`. Existing admin
bindings were preserved; no public invocation or secret access was granted.

The explicit customer production transport is implemented in
`packages/server/src/cloudRun.ts`. Existing Preview behavior remains scoped to
the dev branch. Provider/account/target/environment mismatches are rejected
before credentials leave the request. Fifty focused transport/customer gateway
tests, lint, typecheck and all application builds passed. Customer backend
feature flags and the website have not been activated by this preparation.
The 66 focused Python customer tests passed. The full TypeScript suite recorded
2500 passed, 43 skipped and four failures in the previously documented unrelated
MS35/MF71/MF78/MF79 suites. It is not a clean full-suite result. Cloud source
upload allowlist was inspected; it includes customer modules and excludes
credentials, caches and test artifacts.

## Customer Vercel Production configuration

Set only on `desk-atlas-customer-website`, Production environment:

| Variable | Value |
|---|---|
| RAG_GOOGLE_AUTH | vercel-oidc-customer-production |
| RAG_GOOGLE_WORKLOAD_PROVIDER | projects/252244258272/locations/global/workloadIdentityPools/vercel-customer-production/providers/vercel |
| RAG_GOOGLE_SERVICE_ACCOUNT | vercel-rag-customer@deskatlas-rag.iam.gserviceaccount.com |
| RAG_SERVICE_URL | https://deskatlas-rag-chat-production-2ttaxxsoaa-uc.a.run.app |
| RAG_SCOPE_ID | deskatlas |
| RAG_EMBEDDING_FINGERPRINT | b1525f4ca8f9625181691cabb3fbf33bb1274aa9229567de3f623f55053823ca |
| RAG_MIN_SIMILARITY | Match the accepted production admin threshold |
| CUSTOMER_ASSISTANT_ALLOWED_ORIGINS | https://www.thedeskatlas.com |
| CUSTOMER_ASSISTANT_TRUSTED_IP_HEADER | x-vercel-forwarded-for |
| CUSTOMER_ASSISTANT_ENABLED | false during staging |
| CUSTOMER_ASSISTANT_VERIFIED_ENABLED | false during staging |
| NEXT_PUBLIC_CUSTOMER_ASSISTANT_ENABLED | false during staging |
| NEXT_PUBLIC_CUSTOMER_ASSISTANT_VERIFIED_ENABLED | false during staging |

`RAG_SERVICE_TOKEN` and `RAG_CAPABILITY_SECRET` must exactly match the production
Cloud Run service's corresponding secret versions. Keep these server-only.
Preserve the existing stable `REWARDS_RATE_LIMIT_SECRET` and Supabase server
configuration. Never add DeepInfra keys or service secrets as NEXT_PUBLIC vars.

Next stages: verify full migration/contract inventory and published CUSTOMER
audience bindings; build and deploy compatible Python customer endpoints with
customer access disabled, preserving admin/staff settings; publish matching
customer website code with all four flags off; verify private transport,
customer capability isolation, synthetic public knowledge and ownership checks;
then activate public and verified features independently with rollback flags.
Saving Vercel variables does not deploy these local code changes.

## October 21 backend rollout

Build `5486e3e8-9e66-4b95-9bb3-a3ea4d2fda2d` succeeded. Deployed immutable
`api-hosted@sha256:7c283ffa2c4d2a2aa3e713c73649a4066c53ffe99336458ac839f27ef80fcaaf`
to production revision `deskatlas-rag-chat-production-00004-g58`, receiving 100%
traffic. Preserved existing model/provider/embedding/secrets settings and set
`CUSTOMER_ASSISTANT_ENABLED=false`. Previous revision: `00003-hlt`.
Authenticated health returned 200 and matched the local serving fingerprint.
An internal capability on the customer plan route returned 401; no Google
identity returned 403 on health. Website/customer activation is still pending.
