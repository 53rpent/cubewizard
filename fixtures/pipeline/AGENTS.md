# AGENTS.md — `fixtures/pipeline/`

Frozen **eval task request** contract for queue messages (orient phase). Source of truth for external documentation; runtime validation is Zod in `src/pipeline/contracts/taskRequest.zod.ts`.

Extract-phase messages (schema v2) are defined only in code: `src/pipeline/contracts/extractTaskRequest.zod.ts` — add a JSON schema here if you introduce external consumers.

Parent: [../AGENTS.md](../AGENTS.md).

## Files

| File | Role |
|------|------|
| `task-request.schema.json` | Draft-07 JSON Schema for orient tasks |
| `examples/enqueue-r2-staging.example.json` | Manual upload: `r2_bucket` + `r2_prefix` |
| `examples/enqueue-minimal-url.example.json` | Minimal URL-based task |
| `examples/enqueue-url-hedron.example.json` | Hedron-style `image_url` task |
| `examples/r2-metadata.example.json` | Shape of `metadata.json` beside staging image |

## Orient task rules (`schema_version` 1)

**Required:** `upload_id`, `schema_version`.

**Exactly one source:**

- `r2_bucket` + `r2_prefix` — staging package under `decklist-uploads` (prefix includes `metadata.json` + image key referenced inside metadata).
- `image_url` — direct image fetch (Hedron path).

**Common optional fields:** `cube_id`, `pilot_name`, `submitted_at`, `image_source`, `match_wins` / `match_losses` / `match_draws`.

`cube_id` is **required at runtime** by `runOrientTask` even if omitted from JSON Schema optional set — producers must send it.

## Staging layout (R2)

Under `r2_prefix` (typically `{upload_id}/`):

- `metadata.json` — must include pointer to image object key (see `r2-metadata.example.json`).
- Image file — JPEG/PNG/WebP/HEIC as uploaded.

Site Worker and Hedron consumer write this layout before enqueueing.

## When changing the contract

1. Edit `task-request.schema.json`.
2. Update `src/pipeline/contracts/taskRequest.zod.ts` + `taskRequest.zod.test.ts`.
3. Refresh `examples/*.json` if shapes change.
4. Note downstream: `processingJobsD1.js` / `processingJobRepo.ts` column mapping for task fields.

Extract task (`schema_version: 2`) is produced by `runOrientTask` — fields include `oriented_image_r2_key`, `image_id`, `processing_timestamp`, `record_logged`, `pilot_name`.
