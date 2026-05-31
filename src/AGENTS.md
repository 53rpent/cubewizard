# AGENTS.md — `src/` (Workers)

Cloudflare Worker entrypoints and shared JS used by the site and Hedron consumer. Deck vision/Scryfall/D1 writes live in **[pipeline/AGENTS.md](pipeline/AGENTS.md)** (eval consumer).

Parent index: [../AGENTS.md](../AGENTS.md).

## Files in this directory

| File | Role | Wrangler |
|------|------|----------|
| `worker.js` | HTTP: REST API, static `docs/` via `ASSETS`, upload → R2 → queues, cron Hedron sync (prod) | `wrangler.jsonc` :8787 |
| `hedron-consumer.js` | Queue: fetch Hedron image → normalize → R2 staging → `processing_jobs` → `EVAL_QUEUE` | `wrangler-hedron-consumer.jsonc` :8789 |
| `processingJobsD1.js` | `upsertQueuedProcessingJob`, `processingJobDocIdFromUploadId` — shared with pipeline | imported by workers |
| `queueMessageBody.js` | `parseQueueJsonBody` for Hedron queue payloads | hedron only |
| `redirect-worker.js` | `cubewizard.org` → `cube-wizard.com` (prod) | `wrangler-redirect.jsonc` |
| `shared/analyticsExcludedCardNames.js` | Card names excluded from analytics aggregates | imported by `worker.js` |

## Language and imports

- **JavaScript** with existing style (`function`, `var` in older blocks). Biome allows higher complexity in `worker.js` (max 65).
- **TypeScript from pipeline:** Workers may import `.ts` modules (e.g. `normalizeStagingImage.ts`). Wrangler bundles them; keep imports minimal and shared.
- Do **not** convert `worker.js` to TypeScript unless explicitly requested.

## Site Worker (`worker.js`)

Single `export default { fetch, scheduled }`.

### Request routing pattern

Path checks in `fetch` — add new API routes **before** the static-asset fallback (`env.ASSETS.fetch`). Pretty URLs map via `mapPrettyUrlToAsset` / `cw-paths.js` (see [docs/AGENTS.md](../docs/AGENTS.md)).

### API surface (representative)

| Path | Method | Notes |
|------|--------|--------|
| `/api/version` | GET | Deploy version (`CWW_DEPLOY_VERSION`) |
| `/api/cubes` | GET | List cubes |
| `/api/dashboard/:cubeId` | GET | Aggregates |
| `/api/charts/:cubeId/:chart` | GET | Chart data |
| `/api/decks/:cubeId` | GET | Deck list + image URLs |
| `/api/deck/:deckId` | GET | Deck + cards |
| `/api/deck/:deckId/cards` | PUT | Replace cards (Scryfall resolve in worker) |
| `/api/deck/:deckId/photo`, `/thumb` | GET | Proxy R2 deck images |
| `/api/processing-decks/:cubeId` | GET | In-flight `processing_jobs` |
| `/api/upload` | POST | Multipart upload → normalize → R2 → `EVAL_QUEUE` |
| `/api/hedron-sync/:cubeId` | POST | Enqueue Hedron consumer |
| `/api/validate-cube` | GET | CubeCobra validation |
| `/api/add-cube` | POST | Register cube in D1 |

### Upload flow

1. Validate cube / Turnstile (`TURNSTILE_SECRET`; skipped when `CWW_ENV=local`).
2. **`normalizeStagingImage`** via `env.IMAGES` (Cloudflare Images) — caps size before R2 (`CW_STAGING_MAX_IMAGE_SIDE`, default 3072).
3. Write `decklist-uploads` prefix (`metadata.json` + image).
4. `upsertQueuedProcessingJob` then `EVAL_QUEUE.send` task JSON (schema v1 — see [fixtures/pipeline/AGENTS.md](../fixtures/pipeline/AGENTS.md)).

### Scheduled (production)

`scheduled` runs Hedron auto-sync cron (`0 7 * * *` in `wrangler.jsonc` prod). **Skipped when `CWW_ENV` is `staging`.**

### Bindings (site)

`cubewizard_db`, `BUCKET`, `DECK_IMAGES_BLOB`, `HEDRON_QUEUE`, `EVAL_QUEUE`, `ASSETS`, `IMAGES`, `WORKER_SELF` (service binding for internal fetches).

## Hedron consumer (`hedron-consumer.js`)

- **One message per batch** (`max_concurrency: 1`).
- Downloads deck image URL from Hedron message → bytes cap 20 MiB → same **staging normalize** as upload → R2 under `hedron:…` upload ids.
- `upsertQueuedProcessingJob` then enqueue orient task on `EVAL_QUEUE`.
- Errors with `permanent: true` ack without retry; transient errors use exponential-style `message.retry`.
- **Does not call OpenAI** — tail **eval consumer** logs for vision failures.

## `processingJobsD1.js` ↔ pipeline

SQL for queued rows must stay aligned with `src/pipeline/orchestrator/processingJobRepo.ts` and `jobId.ts`. If you change columns or `processingJobDocIdFromUploadId`, update **both** JS and TS.

Job id format: `u_` + url-safe base64 of `upload_id` (see `migrations/004_processing_jobs.sql`).

## Environment (site + Hedron)

| Var | Purpose |
|-----|---------|
| `CWW_ENV` | `local` / `staging` / `production` |
| `CW_STAGING_MAX_IMAGE_SIDE` | Images binding downscale (default 3072) |
| `CW_STAGING_JPEG_QUALITY` | Staging JPEG quality (default 90) |
| `TURNSTILE_SECRET` | Upload bot check (optional locally) |

## Testing changes here

- No dedicated Vitest for `worker.js`; rely on manual E2E with `npm run dev:all` or targeted API calls.
- Pipeline unit tests cover shared TS (e.g. `normalizeStagingImage.test.ts`).
- After edits: `npm run lint` (includes `src/**/*.js`).

## When to edit pipeline instead

OpenAI, orientation, Scryfall enrichment, oriented R2 keys, extract queue messages, `processing_jobs` status transitions (`running` / `done` / `failed`) → **[pipeline/AGENTS.md](pipeline/AGENTS.md)**.
