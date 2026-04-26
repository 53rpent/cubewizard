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

#### `cubewizard-enqueue` env vars / secrets
- `ENQUEUE_SHARED_SECRET` (Secret Manager recommended)
- `GCP_PROJECT_ID=cubewizard`
- `GCP_LOCATION=us-east1`
- `CLOUD_TASKS_QUEUE=eval-queue`
- `WORKER_URL=https://<cubewizard-worker-url>/tasks/eval`
- `TASK_OIDC_SERVICE_ACCOUNT=<cloudtasks-invoker-sa email>`
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
- Any Cloudflare D1 vars you rely on (see `d1_writer.py`)

Runtime service account should have:
- Firestore read/write
- Secret Manager Secret Accessor (if using secrets)

Also ensure the Cloud Run service requires authentication and that the Cloud Tasks invoker
service account has `Cloud Run Invoker` on `cubewizard-worker`.

