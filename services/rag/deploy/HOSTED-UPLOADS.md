# Hosted embeddings and file uploads: operator walkthrough

Authority: [October 20 contract](../DEEPINFRA-EMBEDDINGS.md), PRD-F26/F27,
SDD-C21/C23/C24, ERD-E25/E27, QAD-TC44/45/46.

Chat remains Qwen3-32B. Embeddings become Qwen3-Embedding-4B at 1024 dimensions.
Supabase keeps files and vectors. An Ubuntu VM runs the existing isolated Docker
parser and a Python worker. The worker uses DeepInfra, not local model weights.
Do each stage in order. Do not switch an embedding fingerprint by itself.
No live schema changes, re-index, build or VM creation are performed by reading
this guide. Builds, VMs and provider inference incur charges.

## 1. Apply the additive database migration

Open your existing Supabase project dashboard, then SQL Editor, then New query.
On your PC open `supabase/migrations/029_hosted_embedding_cutover.sql` in a text
editor, copy its entire contents into the query and run it once. This creates
private staging tables and a service-role-only maintenance RPC. It does not
replace vectors, delete files or change the active model.

Next apply `030_embedding_cleanup_independence.sql` once, the same way. It lets
cleanup jobs wait independently without blocking re-embedding active documents.
Do not run either `_down.sql` file, a reset script or older migrations again.
If an error appears, stop and retain the error. The production prerequisite is
the existing migrations through 028. Local migration testing used disposable
PostgreSQL and a test vector domain; verify deployed pgvector separately.

## 2. Prepare the replacement vectors

Finish in-progress uploads first. Pending/READY versions and queued or
running ingestion jobs cause a safe rejection. Cleanup jobs may remain queued
after migration 030. Do not discard documents simply to bypass
this guard. Resolve the backlog through normal UI controls and worker operation.

Open PowerShell on your PC:

```powershell
Set-Location C:\Users\reyna\Desk-Atlas
services/rag/.venv-service/Scripts/python.exe services/rag/reembed.py begin --from-saved-config
```

This reads Supabase configuration from your existing ignored admin `.env.local`.
Verify that file points to the same Supabase project used by the deployed site.
The only printed identifier is the run ID. Save it, then run:

```powershell
$embeddingRunId = Read-Host 'Paste the run ID'
services/rag/.venv-service/Scripts/python.exe services/rag/reembed.py prepare --run $embeddingRunId --from-saved-config
```

The command retrieves the existing DeepInfra secret through your signed-in Google
CLI, reads active chunk text through the private RPC, generates new document
vectors and stages them. Existing live vectors remain unchanged. Expected final
line: `SHADOW_EMBEDDINGS_PREPARED`. If interrupted, rerun `prepare` with the same
run ID. Never share your environment file or the raw database API response.
If the corpus changed, final commit will reject it; begin a fresh snapshot.

## 3. Build the smaller hosted API

```powershell
Set-Location C:\Users\reyna\Desk-Atlas\services\rag
gcloud.cmd meta list-files-for-upload
gcloud.cmd builds submit . --config=cloudrun/build-hosted.yaml --ignore-file=.gcloudignore --region=us-central1 --project=deskatlas-rag
```

The upload list must exclude environment files, private documents and caches.
Wait for SUCCESS, then obtain its digest:

```powershell
$hostedBuildId = Read-Host 'Paste the successful build ID'
gcloud.cmd builds describe $hostedBuildId --region=us-central1 --project=deskatlas-rag --format="table(results.images.name,results.images.digest)"
```

Use the `sha256:...` digest to prepare, but not deploy, the service configuration:

```powershell
Set-Location C:\Users\reyna\Desk-Atlas
$hostedDigest = Read-Host 'Paste the image digest including sha256:'
$hostedImage = 'us-central1-docker.pkg.dev/deskatlas-rag/deskatlas-rag/api-hosted@' + $hostedDigest.Trim()
services/rag/.venv-service/Scripts/python.exe services/rag/cloudrun/prepare_deepinfra.py --hosted-embeddings --image $hostedImage --output services/rag/.deepinfra-deploy-embeddings.json
```

The script preserves current scope, IAM/service-secret references, limits and
traffic settings. It adds the hosted embedding provider and fingerprint. It
does not read the secret value. Keep the generated configuration out of Git.
For a second preparation use another output filename; overwrites are rejected.

## 4. Perform the coordinated maintenance switch

In Vercel open the relevant admin and staff projects, Settings, Environment
Variables. Identify the exact environments/branches used by your deployed apps.
Set `RAG_ENABLED=false` and `KB_ENABLED=false` there and redeploy those apps so
the disabled settings take effect. Stop existing workers. Ensure no new uploads,
ingestion jobs are running. Independent cleanup remains protected by the same
database locks and active-corpus checks. Record the previous Cloud Run revision
and the old `RAG_EMBEDDING_FINGERPRINT` for rollback.

On the PC:

```powershell
Set-Location C:\Users\reyna\Desk-Atlas
services/rag/.venv-service/Scripts/python.exe services/rag/reembed.py commit --run $embeddingRunId --from-saved-config --maintenance-confirmed
gcloud.cmd run services replace services/rag/.deepinfra-deploy-embeddings.json --region=us-central1 --project=deskatlas-rag
services/rag/.venv-service/Scripts/python.exe services/rag/cloudrun/check_private.py
services/rag/.venv-service/Scripts/python.exe services/rag/reembed.py fingerprint
```

Do not deploy if `commit` fails. The commit atomically checks all snapshot
bindings, changes the complete active vectors/version fingerprints and bumps
the catalog epoch. It leaves exact text, IDs, source files, audiences, approval
and structural manifests unchanged. Previous vectors are retained privately.

Copy the fingerprint printed by the last command into the same Vercel
environments as `RAG_EMBEDDING_FINGERPRINT`. Keep `RAG_SERVICE_URL` and existing
Google identity configuration pointing to the same private Cloud Run service.
Also update your ignored local admin configuration before using local gateways.
Never give Vercel/browser code the DeepInfra key. The API uses Secret Manager.

Keep uploads disabled until the worker is configured below. Chat may be enabled
after matching API/catalog/gateway fingerprints pass authenticated tests. The
existing Cloud Run identity transport is scoped to admin dev Preview. Do not
assume this migration grants a different branch, production or staff access.

## 5. Create the worker VM

Open https://console.cloud.google.com/compute/instances?project=deskatlas-rag .
Enable Compute Engine if prompted, then Create instance. Use:

| Setting | Value |
|---|---|
| Name | deskatlas-rag-worker |
| Region / zone | us-central1 / us-central1-a |
| Machine type | e2-standard-2, 2 vCPU and 8 GB RAM |
| Operating system | Ubuntu 24.04 LTS, x86-64 |
| Disk | 50 GB |
| HTTP/HTTPS firewall | Leave unchecked |

Review the displayed cost, then create it. No inbound web server is needed.
On your PC build and copy the allowlisted source bundle:

```powershell
Set-Location C:\Users\reyna\Desk-Atlas
python services/rag/package_worker.py
gcloud.cmd compute scp services/rag/artifacts/hosted-worker.tar.gz deskatlas-rag-worker:~/hosted-worker.tar.gz --zone=us-central1-a --project=deskatlas-rag
```

If SSH key setup asks to create a key, follow the Google CLI prompts. This bundle
includes only code and dependency manifests, not credentials or model weights.

## 6. Install and configure inside the VM

In Google Cloud's VM instances page, click SSH beside the worker. Paste these
Linux commands in that browser SSH terminal, not in Windows PowerShell:

```bash
sudo mkdir -p /opt/deskatlas/rag
sudo tar -xzf ~/hosted-worker.tar.gz -C /opt/deskatlas/rag
cd /opt/deskatlas/rag
bash deploy/install-worker.sh
sudo python3 deploy/configure-worker.py
```

The install builds the existing offline parser with PDF/Word/OCR tools. It does
not download an embedding model. The configuration prompts ask for:

1. The deployed ADMIN website HTTPS origin, without `/manage` or other path.
2. Its existing `KB_WORKER_TOKEN` from that Vercel environment. This must match
   exactly; do not generate a different value for the worker.
3. Your DeepInfra API key. Both secret prompts are hidden.

The script stores configuration in a root-readable file, pins the parser image
by its local immutable ID and leaves the worker stopped. Supabase service-role
credentials never go onto this worker. Parser containers have no network or
credentials. The worker runs under a dedicated service account with Docker
access, resource limits on parsers and automatic restart.

Make sure the gateway URL is reachable by the worker. A Vercel deployment-login
protection page can block it before the application validates its worker token;
configure a narrowly scoped provider bypass if needed, not public app auth.
The worker currently receives only the existing gateway token, so such a bypass
needs explicit integration before using a protected Preview URL.

## 7. Enable and test

Set the matching Vercel `KB_ENABLED=true` and `RAG_ENABLED=true`, with the new
fingerprint, then redeploy. In the VM SSH terminal:

```bash
sudo systemctl enable --now deskatlas-worker
sudo systemctl status deskatlas-worker --no-pager
sudo journalctl -u deskatlas-worker -n 30 --no-pager
```

Service active means the process is running, not proof of a reachable gateway.
Upload a small synthetic Markdown file from Settings, Knowledge Base. Wait for
Available, ask a question about its contents, and verify citations. Then test
DOCX/PDF and cleanup separately. Restart the VM and repeat to verify supervision.
Test after idle and with all local PC workers stopped. Avoid private source text
in screenshots or logs. Hosted document/query embeddings send selected source
text to DeepInfra by design.

## Rollback

Disable RAG/KB, redeploy apps and stop workers first. If no catalog/corpus changes
occurred since cutover, run on the PC:

```powershell
services/rag/.venv-service/Scripts/python.exe services/rag/reembed.py rollback --run $embeddingRunId --from-saved-config --maintenance-confirmed
```

Restore the prior Cloud Run revision, old gateway fingerprint and prior worker
configuration together before reenabling apps. Rollback refuses a changed corpus
or epoch: do not force fingerprint updates or discard new uploads. A later
rollback needs a freshly prepared complete index migration instead. Never use
the down migration as an index rollback. No source files need deletion.
