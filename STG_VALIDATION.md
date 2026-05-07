## Staging validation (Cloudflare stg → GCP stg)

This is a practical end-to-end checklist to confirm your **Cloudflare Worker `stg`** is interacting with **stg GCP** resources (while still using the **shared** D1 deck database).

### Prereqs

- Staging Cloud Run services deployed:
  - `cubewizard-enqueue-stg`
  - `cubewizard-worker-stg`
- Staging Cloud Tasks queue exists: `eval-queue-stg`
- Staging Firestore DB id exists: `cw-upload-status-stg`
- Cloudflare Worker `stg` secrets set:
  - `GCP_ENQUEUE_URL` → stg enqueue base URL
  - `ENQUEUE_SHARED_SECRET` → stg secret (must match enqueue)
  - `GCP_FIRESTORE_SA_JSON` → SA JSON with Firestore read access
  - `FIRESTORE_DATABASE_ID=cw-upload-status-stg`

---

## 1) Sanity check Cloud Run health endpoints

```bash
curl -sS "https://<enqueue-stg-host>/healthz"
curl -sS "https://<worker-stg-host>/healthz"
```

Expected: JSON like `{\"ok\":\"true\"}` for both.

---

## 2) Verify the enqueue secret is enforced

```bash
curl -sS -X POST "https://<enqueue-stg-host>/enqueue" \
  -H "Content-Type: application/json" \
  -d "{\"upload_id\":\"test\",\"r2_bucket\":\"x\",\"r2_prefix\":\"y/\"}"
```

Expected: HTTP `401`.

---

## 3) Verify enqueue creates a task (and worker accepts OIDC)

Trigger an enqueue with the correct secret (use dummy bucket/prefix if you just want to verify Cloud Tasks wiring):

```bash
curl -sS -X POST "https://<enqueue-stg-host>/enqueue" \
  -H "Content-Type: application/json" \
  -H "X-Shared-Secret: <stg-secret>" \
  -d "{\"upload_id\":\"stg-smoke-1\",\"r2_bucket\":\"decklist-uploads\",\"r2_prefix\":\"__does_not_exist__/\"}"
```

Expected:
- HTTP `200` from enqueue (task created)
- Worker will likely mark the job `failed` (because the R2 prefix doesn’t exist), which is fine for the wiring test.

---

## 4) Verify Firestore status is written to the stg database id

In Firestore console, check:
- Database: `cw-upload-status-stg`
- Collection: `jobs`
- A document exists for `upload_id=stg-smoke-1` with `status` eventually `failed` (or `done` for a real upload).

---

## 5) Verify Cloudflare Worker `stg` reads the stg Firestore status

Call the status endpoint for any cube id you used during upload tests:

```bash
curl -sS "https://cubewizard-stg.amatveyenko.workers.dev/api/processing-decks/<cubeId>"
```

Expected: JSON `{ "jobs": [...] }` including queued/running/failed jobs from **stg** only.

---

## 6) Verify shared D1 deck database behavior

Because D1 is shared across `stg` and `prod` by design, confirm:
- A deck created/updated through the pipeline appears in both stg and prod UI routes that read from D1.

