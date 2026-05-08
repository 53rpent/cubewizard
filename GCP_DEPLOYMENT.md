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

`ENQUEUE_SHARED_SECRET` for Cloud Run enqueue is **not** stored in GitHub Actions anymore; keep it in **Secret Manager** (next section) and in **Wrangler** for Workers that call enqueue.

After secrets are set, pushes to `main` deploy prod via `.github/workflows/deploy-cloud-run.yml`. (You may remove unused repository secrets `ENQUEUE_SHARED_SECRET_PROD` / `ENQUEUE_SHARED_SECRET_STG` if you added them earlier; they are no longer read by workflows.)

#### 4) Secret Manager — `ENQUEUE_SHARED_SECRET` (prod + stg)

The deploy workflows bind `ENQUEUE_SHARED_SECRET` from Secret Manager (`:latest`). Create one secret **per environment**:

| GCP secret id (`secretId`)     | Used by                                              | Matches Wrangler        |
|-------------------------------|------------------------------------------------------|-------------------------|
| `enqueue-shared-secret-prod`  | Cloud Run `cubewizard-enqueue`, `--env prod`        | `ENQUEUE_SHARED_SECRET` |
| `enqueue-shared-secret-stg` | Cloud Run `cubewizard-enqueue-stg`, `--env stg`       | `ENQUEUE_SHARED_SECRET` |

**Create** (example prod — use a strong random string, different from stg):

```bash
printf '%s' 'YOUR_LONG_RANDOM_SECRET' | gcloud secrets create enqueue-shared-secret-prod \
  --project=cubewizard \
  --data-file=- \
  --replication-policy=automatic
```

Staging:

```bash
printf '%s' 'YOUR_LONG_RANDOM_SECRET_STG' | gcloud secrets create enqueue-shared-secret-stg \
  --project=cubewizard \
  --data-file=- \
  --replication-policy=automatic
```

**Rotate** (add a new version; Cloud Run refers to `:latest`):

```bash
printf '%s' 'NEW_SECRET' | gcloud secrets versions add enqueue-shared-secret-prod \
  --project=cubewizard \
  --data-file=-
# Update Wrangler to the same value, then redeploy the Worker / Cloud Run enqueue as needed.
```

**IAM** — grant the **enqueue runtime** service account **`roles/secretmanager.secretAccessor`** on each secret:

```bash
gcloud secrets add-iam-policy-binding enqueue-shared-secret-prod \
  --project=cubewizard \
  --member="serviceAccount:enqueue-sa@cubewizard.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding enqueue-shared-secret-stg \
  --project=cubewizard \
  --member="serviceAccount:enqueue-sa-stg@cubewizard.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

If `gcloud run deploy` fails with permission errors resolving the secret, also grant **`secretAccessor`** on that secret to **`github-deployer@...`** (the GitHub Actions deployer SA).

To use different GCP secret IDs, edit `ENQUEUE_SECRET_RESOURCE` in `.github/workflows/deploy-cloud-run.yml` and `deploy-cloud-run-stg.yml`.

### Staging deployment

Staging resources are deployed via workflow dispatch using:
- `.github/workflows/deploy-cloud-run-stg.yml`

Staging GCP bootstrap commands (queue / service accounts / Firestore db id) live in:
- `GCP_STAGING.md`

The staging upload-status database **`cw-upload-status-stg`** is **regional** in **`us-east1`** (not multi-region **`nam5`**).

### GitHub Actions and Cloud Run env

The prod workflow **updates** **`cubewizard-enqueue`** non-secret env vars and binds **`ENQUEUE_SHARED_SECRET`** from Secret Manager (`enqueue-shared-secret-prod:latest`). It **updates** **`cubewizard-worker`** Firestore-related env vars only (`--update-env-vars`) so existing secrets (OpenAI, R2, D1) stay on the service between deploys.

### Post-deploy manual configuration (worker secrets)
Worker still needs secrets that are not stored in GitHub (unless you add them yourself). Configure these in the Cloud Run console (Secret Manager recommended):

### Troubleshooting

- **Enqueue deploy fails because of `[ENQUEUE_SHARED_SECRET]` env type**: workflows run best-effort `gcloud run services update ... --remove-env-vars` and `--remove-secrets` for `ENQUEUE_SHARED_SECRET` before deploy. If migration still fails, run those manually once, then rerun the workflow.
- **Deploy cannot read Secret Manager**: ensure `ENQUEUE_SHARED_SECRET_PROD|STG` exists and **`enqueue-sa` / `enqueue-sa-stg`** has **`secretAccessor`** on that secret (see section 4). Add the same binding for **`github-deployer`** if the deploy step itself is denied access.

  Example error (`enqueue-shared-secret-prod`):

  > Permission denied on secret ... for Revision service account **enqueue-sa@...**

  Fix (bind at the **secret** resource):

  ```bash
  gcloud secrets add-iam-policy-binding enqueue-shared-secret-prod \
    --project=cubewizard \
    --member="serviceAccount:enqueue-sa@cubewizard.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
  ```

  For staging enqueue, use **`enqueue-shared-secret-stg`** and **`enqueue-sa-stg@...`**.

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
- `roles/secretmanager.secretAccessor` on secret `ENQUEUE_SHARED_SECRET_PROD` (see section 4; not necessarily project-wide)
- **`roles/iam.serviceAccountUser` on `cloudtasks-invoker-sa@...`** (`add-iam-policy-binding` on **that invoker SA**): grant **both** (1) **`enqueue-sa`** and (2) the **Cloud Tasks service agent** **`service-<PROJECT_NUMBER>@gcp-sa-cloudtasks.iam.gserviceaccount.com`** so Cloud Tasks can mint OIDC for the worker (**same pattern for staging** → **`GCP_STAGING.md`**)

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

Workflows configure prod/stg enqueue as follows: **`ENQUEUE_SHARED_SECRET`** is supplied **from Secret Manager** (`ENQUEUE_SHARED_SECRET_PROD` / `ENQUEUE_SHARED_SECRET_STG`, version `latest`). The rest are **`--update-env-vars`**:

Reference list:

- `ENQUEUE_SHARED_SECRET` (Secret Manager, not plaintext in Cloud Run)
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
- Secret Manager accessor on the enqueue shared secret resource (section 4)

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
wrangler secret put ENQUEUE_SHARED_SECRET --env prod
```

Recommended values:
- `GCP_ENQUEUE_URL`: `https://<your-cloud-run-enqueue-host>` (with or without trailing `/enqueue`)
- `ENQUEUE_SHARED_SECRET`: **same string** as the Secret Manager secret **`enqueue-shared-secret-prod`** (active version; Wrangler sends it as `X-Shared-Secret`)

Optional Worker var/secret:
- `R2_STAGING_BUCKET_NAME`: defaults to `decklist-uploads` (must match the R2 bucket behind the Worker `BUCKET` binding)

Deck list “processing uploads” status (`/api/processing-decks/:cubeId`) reads the same Firestore `jobs`
collection the enqueue/worker services write. Configure the Worker with a dedicated read-only service account:

- `GCP_FIRESTORE_SA_JSON` (Wrangler secret): full service account JSON with `roles/datastore.user` (read-only is fine)
- `GCP_PROJECT_ID` (optional if `project_id` exists in the JSON)
- `FIRESTORE_DATABASE_ID` / `FIRESTORE_COLLECTION`: set in **[`wrangler.jsonc`](wrangler.jsonc)** under `env.stg.vars` / `env.prod.vars` (`cw-upload-status-stg` vs `cw-upload-status`) so `/api/processing-decks` hits the same Firestore DB as enqueue/worker. Do **not** add a Wrangler **secret** with the same name unless you intend to override; Worker secrets take precedence over `vars`.

Firestore may prompt you to create a composite index the first time the Worker runs the `cube_id + status`
queries; click the console link from the error log if you see one.

The worker marks jobs as `done` in Firestore for idempotency (Cloud Tasks is at-least-once). The status UI
filters out `done` jobs, and you can use Firestore TTL / periodic cleanup if you want to prune old job docs.

Then deploy the Worker as you normally do (`wrangler deploy --env prod`, etc.).

