## Staging GCP resources (same project)

This repo’s GCP pipeline is designed so you can run **prod** and **stg** side-by-side in the **same** GCP project (`cubewizard`), while still keeping your **deck database shared** (Cloudflare D1).

Staging duplicates:
- Cloud Run services (`cubewizard-enqueue-stg`, `cubewizard-worker-stg`)
- Cloud Tasks queue (`eval-queue-stg`)
- Firestore upload-status database id (`cw-upload-status-stg`)
- Runtime identities (`*-stg` service accounts)

Shared across environments (by design):
- Cloudflare D1 deck database (`env.cubewizard_db` binding in the Worker)

### Naming conventions used below

- **Project**: `cubewizard`
- **Region** (Cloud Run + Cloud Tasks): `us-east1`
- **Queue**: `eval-queue-stg`
- **Firestore status DB id**: `cw-upload-status-stg`
- **Firestore collection**: `jobs`

---

## 1) Create the staging Cloud Tasks queue

```bash
gcloud tasks queues create eval-queue-stg \
  --project=cubewizard \
  --location=us-east1
```

---

## 2) Create staging service accounts

Create 3 service accounts:
- Cloud Run runtime for enqueue
- Cloud Run runtime for worker
- OIDC identity for Cloud Tasks → invoke the worker

```bash
gcloud iam service-accounts create enqueue-sa-stg \
  --project=cubewizard \
  --display-name="cubewizard enqueue (stg)"

gcloud iam service-accounts create worker-sa-stg \
  --project=cubewizard \
  --display-name="cubewizard worker (stg)"

gcloud iam service-accounts create cloudtasks-invoker-sa-stg \
  --project=cubewizard \
  --display-name="cloudtasks invoker (stg)"
```

Grant IAM roles:

```bash
# enqueue runtime: create Cloud Tasks + write Firestore status
gcloud projects add-iam-policy-binding cubewizard \
  --member="serviceAccount:enqueue-sa-stg@cubewizard.iam.gserviceaccount.com" \
  --role="roles/cloudtasks.enqueuer"

gcloud projects add-iam-policy-binding cubewizard \
  --member="serviceAccount:enqueue-sa-stg@cubewizard.iam.gserviceaccount.com" \
  --role="roles/datastore.user"

# worker runtime: write Firestore status (and read it for idempotency)
gcloud projects add-iam-policy-binding cubewizard \
  --member="serviceAccount:worker-sa-stg@cubewizard.iam.gserviceaccount.com" \
  --role="roles/datastore.user"
```

Later (after you deploy `cubewizard-worker-stg`), grant Cloud Tasks invoker SA permission to call it:

```bash
gcloud run services add-iam-policy-binding cubewizard-worker-stg \
  --project=cubewizard \
  --region=us-east1 \
  --member="serviceAccount:cloudtasks-invoker-sa-stg@cubewizard.iam.gserviceaccount.com" \
  --role="roles/run.invoker"
```

---

## 3) Create a staging Firestore database id for upload status

This keeps **stg** job status isolated from **prod** job status. It does *not* affect the shared Cloudflare D1 deck DB.

Pick a Firestore location that matches your existing setup:
- If your existing Firestore is multi-region (common): `nam5`
- If your existing Firestore is regional: use that region (example: `us-east1`)

Create the database id:

```bash
# Example: multi-region North America (recommended default)
gcloud firestore databases create \
  --project=cubewizard \
  --database=cw-upload-status-stg \
  --location=nam5
```

If you already created the database id, this will fail; that’s fine.

---

## 4) Cloud Run env vars for staging

You will set these on the **stg** services (either via GitHub Actions, or in the Cloud Run console).

### `cubewizard-enqueue-stg`

- `ENQUEUE_SHARED_SECRET` = (stg secret; different from prod)
- `GCP_PROJECT_ID=cubewizard`
- `GCP_LOCATION=us-east1`
- `CLOUD_TASKS_QUEUE=eval-queue-stg`
- `WORKER_URL=https://<cubewizard-worker-stg-url>/tasks/eval`
- `TASK_OIDC_SERVICE_ACCOUNT=cloudtasks-invoker-sa-stg@cubewizard.iam.gserviceaccount.com`
- `FIRESTORE_DATABASE_ID=cw-upload-status-stg`
- `FIRESTORE_COLLECTION=jobs`

### `cubewizard-worker-stg`

- `OPENAI_API_KEY` (can be separate from prod)
- `R2_ENDPOINT_URL`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `FIRESTORE_DATABASE_ID=cw-upload-status-stg`
- `FIRESTORE_COLLECTION=jobs`

Important: keep your **deck DB** shared by keeping the worker’s D1-writing configuration identical to prod (same Cloudflare account + D1 database id/token vars, as used by `d1_writer.py`).

