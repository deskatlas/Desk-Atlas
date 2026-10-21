# Production embedding configuration repair

Traceability: PRD-F26/F27, SDD-C20/C21/C23/C24, QAD-TC44/45/46.

## Observed regression

The October 21 maintainer report gives the question `Someone left their phone, what should i do?` and the diagnostic `NO_RELEVANT_SOURCE`.

Read-only checks establish:

- The live catalog and published versions use hosted embedding fingerprint `b1525f4ca8f9625181691cabb3fbf33bb1274aa9229567de3f623f55053823ca`.
- The maintainer confirms the admin production gateway uses that fingerprint and similarity threshold `0.5`, followed by a redeployment.
- Production Cloud Run revision `deskatlas-rag-chat-production-00001-qcv` still uses old fingerprint `e8a8211561f2eeee9504e69cb6927ece0cf628c8ad52eb8da07a417849d7e2fe` and image `api@sha256:60954230b661887c442e42627d084d0e41116320586b11b0082ceaa57a053450`. Its embedding provider is unset, selecting the local encoder.
- At `2026-10-20T19:23:14Z` through `19:23:25Z`, production logs show successful plan, embed and embed-queries requests, with no subsequent selection request. This matches retrieval ending without usable candidates.
- The hosted encoder and current database search retrieve one SOP candidate for the exact reported question at threshold `0.5`. This is retrieval component evidence, not confirmation of a complete deployed answer.
- The prepared immutable image digest matches the active staging service. The focused hosted embedding provider suite passes: `python -m pytest tests/test_hosted_embeddings.py -q` from `services/rag` reports 23 passed.

The gateway labels old-space query vectors with the new fingerprint when searching the newly re-embedded corpus. Fingerprint agreement between gateway and database cannot detect this remote encoder mismatch.

## Prepared production update

The maintainer authorized deployment on October 21, 2026. The command below was executed successfully against the existing production service using the existing hosted image and matching embedding/provider settings.

```powershell
gcloud.cmd run services update deskatlas-rag-chat-production `
  --project=deskatlas-rag --region=us-central1 `
  --image=us-central1-docker.pkg.dev/deskatlas-rag/deskatlas-rag/api-hosted@sha256:6c7480857546cf5033aa40fec929c6dcac30bddd69f442f1a44f7e904733dff2 `
  --update-env-vars=RAG_MODEL_PROVIDER=deepinfra,RAG_ANSWER_MODEL=Qwen/Qwen3-32B,RAG_EMBEDDING_PROVIDER=deepinfra,RAG_EMBEDDING_FINGERPRINT=b1525f4ca8f9625181691cabb3fbf33bb1274aa9229567de3f623f55053823ca `
  --update-secrets=DEEPINFRA_API_KEY=deepinfra-api-key:1
```

After rollout, confirm the serving revision and provider configuration, then repeat the reported question through the deployed gateway and check grounded lost-property guidance and citations. Retest other previously working questions. This deployment does not require re-uploading published documents.

Do not restore the old runtime alone as an answer-restoration strategy: the database remains in the new embedding space. Any rollback must keep the encoder, gateway fingerprint and corpus aligned.

## Investigation limit

During investigation, read-only database requests intermittently returned HTTP 521/522. Database reads recovered before the rollout and gateway verification.

## Deployment verification

Cloud Run revision `deskatlas-rag-chat-production-00002-42m` is ready and serves 100 percent of production traffic. A post-deployment service read confirms the exact hosted image digest, `RAG_EMBEDDING_PROVIDER=deepinfra`, matching fingerprint, `RAG_MODEL_PROVIDER=deepinfra`, and `RAG_ANSWER_MODEL=Qwen/Qwen3-32B`.

A read-only component probe through `https://admin.thedeskatlas.com/api/assistant/query` returned HTTP 200, outcome `SUPPORTED`, mode `EXACT`, five citations, and relevant lost-property evidence for the exact reported question. It completed in approximately 23 seconds with no `NO_RELEVANT_SOURCE` limitation. This uses the repository's established ephemeral signed operator-probe pattern against an existing active admin profile. It does not replace verification in the user's normally signed-in browser.

The post-rollout repeat passed again in approximately 19 seconds with five citations. An additional noise/disturbance SOP question passed in approximately 21 seconds with three citations. Both returned HTTP 200, `SUPPORTED`, relevant evidence and no `NO_RELEVANT_SOURCE` limitation. No answer text, source passages, actor identifiers or credentials were saved in the report.
