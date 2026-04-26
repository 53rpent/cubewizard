## GCP deployment (Cloud Run + Artifact Registry + GitHub Actions)

This repo is set up to deploy two Cloud Run services:

- `cubewizard-enqueue` (fast): called by Cloudflare to create Cloud Tasks
- `cubewizard-worker` (slow): called by Cloud Tasks to process one upload

Region: `us-east1`  
Project: `cubewizard`  
Artifact Registry repo: `cubewizard`

### One-time setup in GCP

#### 1) Create a GitHub deployer service account
Create a service account (example name): `github-deployer`

Grant roles (project-level):
- Artifact Registry Writer
- Cloud Run Admin
- Service Account User (so it can deploy services using runtime SAs)

If you deploy with runtime service accounts (recommended), also grant:
- iam.serviceAccounts.actAs on the runtime service accounts you choose

#### 2) Configure Workload Identity Federation (GitHub OIDC)
Create:
- Workload identity pool (e.g. `github-pool`)
- Provider (e.g. `github-provider`) with issuer `https://token.actions.githubusercontent.com`

Bind the principal set for your repo to the `github-deployer` service account.

#### 3) Add GitHub repo secrets
In GitHub → Settings → Secrets and variables → Actions, add:
- `GCP_WORKLOAD_IDENTITY_PROVIDER`
  - format: `projects/<number>/locations/global/workloadIdentityPools/<pool>/providers/<provider>`
- `GCP_SERVICE_ACCOUNT_EMAIL`
  - format: `<github-deployer>@cubewizard.iam.gserviceaccount.com`

After this, pushes to `main` will deploy automatically via `.github/workflows/deploy-cloud-run.yml`.

### Post-deploy manual configuration (per service)
Cloud Run deployment does not automatically set your application secrets. Configure these in the Cloud Run console (or add to the workflow later):

### Runtime service accounts (recommended)
Create/confirm these service accounts (your chosen names):

1) `enqueue-sa@cubewizard.iam.gserviceaccount.com` (Cloud Run runtime for `cubewizard-enqueue`)
2) `worker-sa@cubewizard.iam.gserviceaccount.com` (Cloud Run runtime for `cubewizard-worker`)
3) `cloudtasks-invoker-sa@cubewizard.iam.gserviceaccount.com` (OIDC identity for Cloud Tasks → worker)

The GitHub Actions workflow deploys Cloud Run with:
- `--service-account enqueue-sa@cubewizard.iam.gserviceaccount.com`
- `--service-account worker-sa@cubewizard.iam.gserviceaccount.com`

If you pick different emails, update `.github/workflows/deploy-cloud-run.yml` accordingly.

#### IAM roles to grant

**`enqueue-sa`**
- `roles/cloudtasks.enqueuer` (create tasks)
- `roles/datastore.user` (Firestore read/write)

**`worker-sa`**
- `roles/datastore.user` (Firestore read/write)
- `roles/secretmanager.secretAccessor` (only if you mount secrets from Secret Manager)

**`cloudtasks-invoker-sa`**
- `roles/run.invoker` on the `cubewizard-worker` Cloud Run service (invoke authenticated worker)

**GitHub deployer SA (`github-deployer`)**
- Must be able to deploy Cloud Run *using* the runtime SAs:
  - `roles/run.admin`
  - `roles/iam.serviceAccountUser` on both runtime SAs (so it can set `--service-account`)

### Cloud Tasks queue (create once)
Create the queue in `us-east1` (example name `eval-queue`):

```bash
gcloud tasks queues create eval-queue \
  --project=cubewizard \
  --location=us-east1
```

You can tune rate limits later; start conservative if you want to avoid LLM rate-limit storms.

#### `cubewizard-enqueue` env vars / secrets
- `ENQUEUE_SHARED_SECRET` (Secret Manager recommended)
- `GCP_PROJECT_ID=cubewizard`
- `GCP_LOCATION=us-east1`
- `CLOUD_TASKS_QUEUE=eval-queue`
- `WORKER_URL=https://<cubewizard-worker-url>/tasks/eval`
- `TASK_OIDC_SERVICE_ACCOUNT=cloudtasks-invoker-sa@cubewizard.iam.gserviceaccount.com`
- `FIRESTORE_COLLECTION=jobs` (optional)

Runtime service account should have:
- Cloud Tasks Enqueuer
- Firestore write access

#### `cubewizard-worker` env vars / secrets
- `OPENAI_API_KEY`
- `R2_ENDPOINT_URL`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- (optional) `FIRESTORE_COLLECTION=jobs`
- (optional) `JOB_LEASE_MINUTES` (default `45`) — stale `running` jobs can be reclaimed after lease expiry
- Any Cloudflare D1 vars you rely on (see `d1_writer.py`)

Runtime service account should have:
- Firestore read/write
- Secret Manager Secret Accessor (if using secrets)

Also ensure the Cloud Run service requires authentication and that the Cloud Tasks invoker
service account has `Cloud Run Invoker` on `cubewizard-worker`.

### Notes on Cloud Tasks HTTP bodies
Cloud Tasks requires the HTTP request body to be **base64-encoded**. The `enqueue` service handles this for you.

### Cloudflare Worker configuration (Wrangler secrets)
`src/worker.js` will call your Cloud Run enqueue endpoint after a successful `/api/upload` once these Worker secrets exist:

```bash
# Pick the env you deploy (`stg` / `prod` / default)
wrangler secret put GCP_ENQUEUE_URL --env prod
wrangler secret put ENQUEUE_SHARED_SECRET --env prod
```

Recommended values:
- `GCP_ENQUEUE_URL`: `https://<your-cloud-run-enqueue-host>` (with or without trailing `/enqueue`)
- `ENQUEUE_SHARED_SECRET`: must match Cloud Run `ENQUEUE_SHARED_SECRET`

Optional Worker var/secret:
- `R2_STAGING_BUCKET_NAME`: defaults to `decklist-uploads` (must match the R2 bucket behind the Worker `BUCKET` binding)

Then deploy the Worker as you normally do (`wrangler deploy --env prod`, etc.).

