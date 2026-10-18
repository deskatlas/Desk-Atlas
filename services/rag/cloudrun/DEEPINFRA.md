# Deploy the DeepInfra answer provider

Authority and requirements: [October 18 amendment](../DEEPINFRA-MIGRATION.md),
PRD-F26/F27, SDD-C20-C22, QAD-TC44/46. Selected provider model:
`Qwen/Qwen3-32B`, reasoning disabled. Existing document embeddings stay unchanged.

This deploys answering to the existing private staging service. It does not
deploy ingestion, change Vercel settings, or authorize production activation.
Questions and authorized evidence used for inference are sent to DeepInfra.
Provider model IDs are not immutable weight digests. Existing local evaluation
identity reports based on `answer-model.json` do not certify this hosted model.

## 1. Verify the provider

Run in Windows PowerShell from the repository root:

```powershell
Set-Location C:\Users\reyna\Desk-Atlas
services/rag/.venv-service/Scripts/python.exe services/rag/cloudrun/check_deepinfra.py
```

Expected final line: `DEEPINFRA_SCHEMA_CHECKS_PASSED`. The command reads version
1 of `deepinfra-api-key` into memory using your Google CLI login. It sends only
synthetic requests, incurs small inference charges, and never prints the key.
This verifies the actual serving adapter, including nested JSON schemas. It is
not representative answer-quality or website acceptance.

## 2. Verify source and build the API image

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
Set-Location C:\Users\reyna\Desk-Atlas\services\rag
gcloud.cmd meta list-files-for-upload
```

Inspect the upload list. It must exclude environment files, uploads, caches,
tests, credentials and deployment artifacts. Then run:

```powershell
gcloud.cmd builds submit . --config=cloudrun/build-deepinfra.yaml --ignore-file=.gcloudignore --region=us-central1 --project=deskatlas-rag
```

This builds only the API and the existing pinned embedding model. It does not
build an Ollama image. Cloud Build and image storage charges apply.
Copy the successful build's ID. Use it in the next command:

```powershell
$deepinfraBuildId = Read-Host 'Paste the successful build ID'
gcloud.cmd builds describe $deepinfraBuildId --region=us-central1 --project=deskatlas-rag --format="table(results.images.name,results.images.digest)"
```

Copy the returned digest beginning with `sha256:`. Do not use a mutable image tag.

## 3. Prepare a reviewable revision

Return to the repository root. Paste the digest at the prompt:

```powershell
Set-Location C:\Users\reyna\Desk-Atlas
$deepinfraImageDigest = Read-Host 'Paste the image digest including sha256:'
$deepinfraImage = 'us-central1-docker.pkg.dev/deskatlas-rag/deskatlas-rag/api-deepinfra@' + $deepinfraImageDigest.Trim()
services/rag/.venv-service/Scripts/python.exe services/rag/cloudrun/prepare_deepinfra.py --image $deepinfraImage --output services/rag/.deepinfra-deploy.json
```

The preparation script reads current Cloud Run settings. It retains the API's
resource limits, scope, embedding fingerprint, evidence settings and service
credential references. It replaces the image, removes the Ollama sidecar and
container dependency, selects DeepInfra and references secret version 1 as
`DEEPINFRA_API_KEY`. It neither reads the secret nor deploys anything.
If the secret was created under another numbered version, pass
`--secret-version NUMBER`. It refuses to overwrite an existing output artifact;
use another filename for a subsequent preparation.

Review the generated file locally. Check the image digest, model, provider,
secret reference and unchanged embedding fingerprint. Keep the artifact private
and out of Git. Preserve the existing revision name from Cloud Run for rollback.
If traffic is pinned to an older revision, the preparation preserves that split;
the new revision will need an explicit traffic switch after verification.

## 4. Deploy the reviewed revision

After reviewing the prepared artifact:

```powershell
gcloud.cmd run services replace services/rag/.deepinfra-deploy.json --region=us-central1 --project=deskatlas-rag
gcloud.cmd run services describe deskatlas-rag-chat-staging --region=us-central1 --project=deskatlas-rag --format="yaml(status.conditions,status.url,status.latestReadyRevisionName,status.traffic)"
services/rag/.venv-service/Scripts/python.exe services/rag/cloudrun/check_private.py
```

Expect Ready=True and `PRIVATE_HEALTH_CHECK_PASSED`. The private check validates
Google IAM, service token, capability and the loaded serving fingerprint. Startup
also performs the hosted schema canary before accepting traffic. The runtime
identity needs Secret Accessor on `deepinfra-api-key`; no browser or Vercel
environment variable contains the DeepInfra key. Do not grant public Cloud Run
access. Rollback by restoring traffic to the prior known-good revision using
the Cloud Run Revisions page. Keep its Ollama images available.

## 5. Test the deployed application

The API URL remains the same when replacing a revision on the same service.
The website's `RAG_SERVICE_URL` must point to that service, with existing Google
identity configuration intact. The existing transport is limited to admin dev
Preview. Production and staff access require separately scoped identities.

Ask a known question over an existing published synthetic document and check
the answer and exact citations. Test an unsupported question and a role boundary.
Repeat with the PC's local RAG stopped, then after idle. Readiness does not prove
cold-start latency fits the gateway deadline. New document uploads still need
the independently hosted ingestion/cleanup worker and parser sandbox.

Provider references: [chat API](https://deepinfra.com/Qwen/Qwen3-32B/api),
[reasoning](https://docs.deepinfra.com/chat/reasoning),
[structured output](https://docs.deepinfra.com/chat/structured-outputs).
