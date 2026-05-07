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
- `ENQUEUE_SHARED_SECRET_PROD`
  - must match Wrangler `wrangler secret put ENQUEUE_SHARED_SECRET --env prod`

Also for staging deploys (workflow dispatch):
- `ENQUEUE_SHARED_SECRET_STG` (same value you set in Wrangler for `--env stg`)

After secrets are set, pushes to `main` deploy prod via `.github/workflows/deploy-cloud-run.yml`.

### Staging deployment

Staging resources are deployed via workflow dispatch using:
- `.github/workflows/deploy-cloud-run-stg.yml`

Staging GCP bootstrap commands (queue / service accounts / Firestore db id) live in:
- `GCP_STAGING.md`

### GitHub Actions and Cloud Run env

The prod workflow sets **`cubewizard-enqueue`** environment from `ENQUEUE_SHARED_SECRET_PROD` and fixed values (queue, Firestore DB id, worker URL, OIDC SA). It **updates** **`cubewizard-worker`** Firestore-related env vars only (`--update-env-vars`) so existing secrets (OpenAI, R2, D1) stay on the service between deploys.

### Post-deploy manual configuration (worker secrets)
Worker still needs secrets that are not stored in GitHub (unless you add them yourself). Configure these in the Cloud Run console (Secret Manager recommended):

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

For **prod**, GitHub Actions (`.github/workflows/deploy-cloud-run.yml`) sets these on each deploy from `ENQUEUE_SHARED_SECRET_PROD` plus the values below. For **stg**, see `.github/workflows/deploy-cloud-run-stg.yml` and `ENQUEUE_SHARED_SECRET_STG`.

Reference list (must stay consistent with the workflows):

- `ENQUEUE_SHARED_SECRET`
- `GCP_PROJECT_ID=cubewizard`
- `GCP_LOCATION=us-east1`
- `CLOUD_TASKS_QUEUE=eval-queue` (prod) or `eval-queue-stg` (stg)
- `WORKER_URL=https://<cubewizard-worker-url>/tasks/eval` (resolved at deploy time)
- `TASK_OIDC_SERVICE_ACCOUNT=cloudtasks-invoker-sa@...` (prod) or `cloudtasks-invoker-sa-stg@...` (stg)
- `FIRESTORE_DATABASE_ID=cw-upload-status` (prod) or `cw-upload-status-stg` (stg)
- `FIRESTORE_COLLECTION=jobs`

Runtime service account should have:
- Cloud Tasks Enqueuer
- Firestore write access

#### `cubewizard-worker` env vars / secrets

GitHub Actions **updates** `FIRESTORE_DATABASE_ID` and `FIRESTORE_COLLECTION` on each deploy; set the rest in the Cloud Run console (or Secret Manager) and they persist across deploys:

- `OPENAI_API_KEY`
- `R2_ENDPOINT_URL`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `FIRESTORE_DATABASE_ID` / `FIRESTORE_COLLECTION` (also applied by CI; matches prod `cw-upload-status` / stg `cw-upload-status-stg`)
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

Deck list “processing uploads” status (`/api/processing-decks/:cubeId`) reads the same Firestore `jobs`
collection the enqueue/worker services write. Configure the Worker with a dedicated read-only service account:

- `GCP_FIRESTORE_SA_JSON` (Wrangler secret): full service account JSON with `roles/datastore.user` (read-only is fine)
- `GCP_PROJECT_ID` (optional if `project_id` exists in the JSON)
- `FIRESTORE_DATABASE_ID` (optional; should match enqueue/worker, e.g. `cw-upload-status`)
- `FIRESTORE_COLLECTION` (optional; defaults to `jobs`)

Firestore may prompt you to create a composite index the first time the Worker runs the `cube_id + status`
queries; click the console link from the error log if you see one.

The worker marks jobs as `done` in Firestore for idempotency (Cloud Tasks is at-least-once). The status UI
filters out `done` jobs, and you can use Firestore TTL / periodic cleanup if you want to prune old job docs.

Then deploy the Worker as you normally do (`wrangler deploy --env prod`, etc.).

