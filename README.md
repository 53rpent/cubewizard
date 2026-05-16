# CubeWizard

Magic: The Gathering cube analytics: deck photos are processed with OpenAI Vision, enriched via Scryfall, stored in Cloudflare D1, and served from a Worker-hosted dashboard (`docs/`).

## Architecture

| Piece | Role |
|--------|------|
| **Site Worker** (`src/worker.js`, `wrangler.jsonc`) | Static SPA, REST API, upload → R2, enqueue `EVAL_QUEUE` / `HEDRON_QUEUE`, read D1 |
| **Eval consumer** (`src/pipeline/entry/evalQueueEntry.ts`, `wrangler-eval-consumer.jsonc`) | Queue consumer: orientation → card extraction → Scryfall → D1 → oriented images on R2 |
| **Hedron consumer** (`src/hedron-consumer.js`, `wrangler-hedron-consumer.jsonc`) | One message per invocation (`max_batch_size: 1`, `max_concurrency: 1`); ack only after R2 + D1 + eval enqueue |
| **D1** | Decks, cards, cubes, `processing_jobs` status |
| **R2** | `decklist-uploads` (staging uploads), `cubewizard-deck-images` (oriented photos + thumbs) |

Eval task JSON is defined in `fixtures/pipeline/task-request.schema.json` and validated in `src/pipeline/contracts/taskRequest.zod.ts`.

## Prerequisites

- Node.js 18+ and `npm install`
- Cloudflare account (Workers, D1, R2, Queues) for deploy
- OpenAI API key for the eval consumer
- Optional: Python 3.11+ and `pip install -r requirements.txt` only if you use the legacy Cloud Run stack under `services/`

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # fill OPENAI_API_KEY and any optional keys
npm run d1:bootstrap:local       # once per fresh .wrangler/local-shared
npm run dev:all                  # site + eval + hedron consumers, shared local queue/D1/R2
```

- Dashboard: **http://127.0.0.1:8787** (site Worker port in `wrangler.jsonc`).
- Use **one** Wrangler process with all three configs. Separate terminals each running `wrangler dev` do **not** share the in-memory local queue.
- Persist path: `--persist-to .wrangler/local-shared` (set on all `dev:*` scripts).

### Environment (`.dev.vars`)

| Variable | Used by |
|----------|---------|
| `OPENAI_API_KEY` | Eval consumer secret (`.dev.vars` locally; Cloudflare secret when deployed) |
| `CW_EVAL_LOG_LEVEL` | `off` \| `low` \| `medium` \| `high` (OpenAI logs in eval consumer) |
| `CW_EVAL_MAX_CONSUMERS` | Expected queue `max_concurrency` (Scryfall throttle; default 1, match wrangler) |
| `CW_EVAL_MAX_IMAGE_SIDE` | Max decode/extract/upload dimension in px (default 2048; Workers isolate cap is 128 MiB) |
| `CW_EVAL_ORIENT_MAX_SIDE` | Max side for orientation OpenAI previews only (default 1280; full side used for card extraction) |
| `CWW_ENV` | Eval consumer: `local` → OpenAI vision uses **inline JPEG (base64)**; `staging` / `production` → R2 HTTPS URLs |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID (eval consumer var) for R2 presigned vision URLs (hosted) |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 API token with read/write on `cubewizard-deck-images` (eval consumer secrets; hosted) |
| `DECK_IMAGE_PUBLIC_BASE_URL` | Optional public CDN base for `cubewizard-deck-images`; when set, vision uses public URLs instead of presigned |
| `CW_EVAL_VERBOSE_LOG` | Legacy: `1`/`true` → `high` if log level unset |
| `TURNSTILE_SECRET` | Site upload Turnstile (optional locally when `CWW_ENV=local`) |

### Eval consumer

- Bundled by Wrangler from `src/pipeline/entry/evalQueueEntry.ts` (no separate build step).
- Dry-run bundle: `npm run build:eval-consumer`
- **Secrets (hosted):** `OPENAI_API_KEY`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` in `wrangler-eval-consumer.jsonc` `secrets.required` for stg/prod. Local dev only requires `OPENAI_API_KEY` in `.dev.vars`.
- **Vision:** With `CWW_ENV=local`, OpenAI receives inline JPEG (base64 data URLs) — no R2 presign secrets. Hosted eval publishes to `cubewizard-deck-images` (`tmp/vision/{uploadId}/…`) and uses presigned GET or `DECK_IMAGE_PUBLIC_BASE_URL`.
- **Deploy checklist (stg/prod eval consumer):** (1) R2 API token for `cubewizard-deck-images`; (2) `wrangler secret put` for `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`; (3) set `CLOUDFLARE_ACCOUNT_ID` in eval consumer vars; (4) redeploy; (5) tail and confirm `vision_url_mode: presigned` on `eval_phase orient_start` (no base64 in logs).
- **`nodejs_compat`** is enabled for JPEG encoding (`jpeg-js` / `Buffer`).
- **WebP / WASM:** codec files live in `vendor/jsquash-webp/` and are imported as precompiled `WebAssembly.Module` values (Workers disallow runtime `WebAssembly.compile` on raw bytes).
- **Throughput:** one deck per invocation (`max_batch_size: 1`); up to **1** concurrent consumer invocations (`max_concurrency: 1`). Each isolate has a **128 MiB** memory cap (paid plan does not raise this). `CW_EVAL_MAX_IMAGE_SIDE=2048` limits RGBA size; raise `max_concurrency` only after profiling memory.
- **Processing UI:** upload/Hedron enqueue upserts `processing_jobs` in D1 immediately; `GET /api/processing-decks/:cubeId` lists `queued` / `running` / `failed` jobs.

### OpenAI log levels (`CW_EVAL_LOG_LEVEL`)

| Level | Behavior |
|-------|----------|
| `off` | No extra OpenAI logs |
| `low` | Model structured JSON text only |
| `medium` | Human-readable phase lines (orientation, extraction, multi-pass) |
| `high` | Request metadata, raw JSON (truncated), structured text, parsed objects |

### Tests

```bash
npm run test:pipeline
# Optional visual QA on a folder of images:
# set PIPELINE_QA_INPUT=/path/to/images then:
npm run test:pipeline:qa
```

Validate fixture JSON against the schema:

```bash
npx --yes ajv-cli validate -s fixtures/pipeline/task-request.schema.json -d fixtures/pipeline/examples/enqueue-r2-staging.example.json
```

### Reset local data

Stop Wrangler, then:

```powershell
Remove-Item -Recurse -Force .wrangler\local-shared -ErrorAction SilentlyContinue
npm run d1:bootstrap:local
```

To clear stuck processing rows only:

```bash
npx wrangler d1 execute cubewizard-db --local --persist-to .wrangler/local-shared --command "DELETE FROM processing_jobs;"
```

## Deploy (Cloudflare)

### Workers

```bash
npx wrangler deploy --env stg
npx wrangler deploy --env prod
npx wrangler deploy --config wrangler-eval-consumer.jsonc --env stg
npx wrangler deploy --config wrangler-eval-consumer.jsonc --env prod
npx wrangler deploy --config wrangler-hedron-consumer.jsonc --env stg
npx wrangler deploy --config wrangler-hedron-consumer.jsonc --env prod
npx wrangler deploy --config wrangler-redirect.jsonc   # cubewizard.org → cube-wizard.com
```

Validate configs: `npm run wrangler:check`

Create R2 blob bucket once: `npx wrangler r2 bucket create cubewizard-deck-images`

### Queues (hosted; create once per environment)

| Env | Eval | Eval DLQ | Hedron | Hedron DLQ |
|-----|------|----------|--------|------------|
| Staging | `cubewizard-eval-stg` | `cubewizard-eval-stg-dlq` | `cubewizard-hedron-stg` | `cubewizard-hedron-stg-dlq` |
| Production | `cubewizard-eval-prod` | `cubewizard-eval-prod-dlq` | `cubewizard-hedron-prod` | `cubewizard-hedron-prod-dlq` |

```bash
npx wrangler queues create cubewizard-eval-stg
# …repeat for each name above for stg/prod
```

Local `*-local` queue names in wrangler configs are Miniflare-only; you do not need to create them in the Cloudflare dashboard for local dev.

### D1 migrations

Apply `schema.sql` for a fresh database, or run files under `migrations/` incrementally on hosted D1 (including `004_processing_jobs.sql`).

```bash
npx wrangler d1 execute cubewizard-db --env prod --remote --file=./migrations/004_processing_jobs.sql
```

## WebP WASM vendor

Binaries under `vendor/jsquash-webp/` match `@jsquash/webp` in `package.json`. After bumping that package, re-download (PowerShell example):

```powershell
$v = "1.5.0"
Invoke-WebRequest "https://unpkg.com/@jsquash/webp@$v/codec/enc/webp_enc.wasm" -OutFile vendor/jsquash-webp/webp_enc.wasm
Invoke-WebRequest "https://unpkg.com/@jsquash/webp@$v/codec/enc/webp_enc_simd.wasm" -OutFile vendor/jsquash-webp/webp_enc_simd.wasm
Invoke-WebRequest "https://unpkg.com/@jsquash/webp@$v/codec/dec/webp_dec.wasm" -OutFile vendor/jsquash-webp/webp_dec.wasm
```

## Worker API (summary)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/cubes` | GET | List cubes |
| `/api/dashboard/:cubeId` | GET | Dashboard aggregates |
| `/api/decks/:cubeId` | GET | Deck list with image URLs |
| `/api/deck/:deckId` | GET | Single deck + cards |
| `/api/deck/:deckId/cards` | PUT | Replace deck card list (Scryfall resolve) |
| `/api/upload` | POST | Upload deck image → R2 → eval queue |
| `/api/processing-decks/:cubeId` | GET | In-flight `processing_jobs` |
| `/api/hedron-sync/:cubeId` | POST | Trigger Hedron import |
| `/api/validate-cube` | POST | CubeCobra cube check |
| `/api/add-cube` | POST | Register cube in D1 |

Optional Worker var `DECK_IMAGE_PUBLIC_BASE_URL`: public base URL for deck images (no trailing slash).

## Database (D1)

Tables: `cubes`, `decks`, `deck_cards`, `deck_stats`, `cube_mapping`, `processing_jobs`, Hedron sync tables (see `schema.sql`).

```bash
npx wrangler d1 execute cubewizard-db --env prod --remote --command "SELECT COUNT(*) FROM decks;"
```

## Project layout

```
CubeWizard/
├── src/
│   ├── worker.js                 # Site Worker
│   ├── hedron-consumer.js        # Hedron queue consumer
│   ├── processingJobsD1.js       # Shared processing_jobs upsert
│   └── pipeline/                 # Eval pipeline (TypeScript, Vitest)
├── docs/                         # Static site (HTML/CSS/JS)
├── fixtures/pipeline/            # Task JSON schema + examples
├── vendor/jsquash-webp/          # Vendored WebP WASM
├── migrations/                   # D1 incremental SQL
├── schema.sql
├── wrangler.jsonc
├── wrangler-eval-consumer.jsonc
├── wrangler-hedron-consumer.jsonc
├── wrangler-redirect.jsonc
├── services/                     # Optional legacy Cloud Run (GCP)
└── …                             # Root Python modules used only by services/ Docker image
```

## GitHub Actions

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| [`ci.yml`](.github/workflows/ci.yml) | PR / push to `staging` or `main` | `npm ci`, `test:pipeline`, `wrangler:check` |
| [`deploy-cloudflare-stg.yml`](.github/workflows/deploy-cloudflare-stg.yml) | Push to `staging` | Deploy site, eval, and hedron Workers (`--env stg`) |
| [`deploy-cloudflare-prod.yml`](.github/workflows/deploy-cloudflare-prod.yml) | Push to `main` | Deploy site, eval, hedron, and redirect Workers (`--env prod`) |

**Repo secrets:** `CLOUDFLARE_API_TOKEN` (Workers, Queues, D1, R2). Optional `CLOUDFLARE_ACCOUNT_ID` if Wrangler cannot infer it from the token.

Local Python CLI (`python main.py`) remains for one-off image debugging against `config.ini`.

## Troubleshooting

- **Queue not draining locally:** use `npm run dev:all`, not separate `dev` + `dev:eval-consumer` terminals.
- **Stale processing card in UI:** row stuck in `processing_jobs` (`running`/`queued`); delete rows or reset `.wrangler/local-shared` (see above).
- **`WebAssembly.compile` disallowed:** ensure eval consumer uses vendored `.wasm` imports (Wrangler bundle), not runtime compile of wasm bytes.
- **Scryfall 429:** lower queue `max_concurrency` / `CW_EVAL_MAX_CONSUMERS` or retry.
- **`exceededCpu`:** eval consumer uses `limits.cpu_ms: 30000` (30s CPU per invocation, one deck each).
- **`exceededMemory`:** Workers allow **128 MiB per isolate** (not raised on Paid). Peak usage is mostly **RGBA decode** (≈4×width×height bytes). Hosted eval uses HTTPS vision URLs (no base64 in bodies); local `CWW_ENV=local` uses inline base64. Lower `CW_EVAL_MAX_IMAGE_SIDE` / `CW_EVAL_ORIENT_MAX_SIDE` if needed; keep `max_concurrency` at 1.
- **Vision URL config (hosted):** Stg/prod eval requires R2 presign secrets or `DECK_IMAGE_PUBLIC_BASE_URL`. OpenAI must reach `*.r2.cloudflarestorage.com` for presigned URLs.
- **`exception`:** Uncaught JS error in the consumer. The queue name in the dashboard is not the cause — run `npx wrangler tail cubewizard-eval-consumer-stg --config wrangler-eval-consumer.jsonc` and look for `eval_consumer_error` (includes `message` + `stack`) or the last `eval_phase_*` line before failure.
- **DLQ / retries exhausted:** On the last delivery attempt (`attempts >= CW_EVAL_MAX_RETRIES`), the consumer sets `processing_jobs.status = failed` with `retries_exhausted (n/5): …`. Messages that still reach `*-dlq` are consumed by the same Worker (`batch.queue` ends with `-dlq`) and marked `dead_letter_queue (…): …`.
- **Hedron failures:** When a Hedron eval job fails (`upload_id` prefix `hedron:`), the row is removed from `hedron_synced_decks` so the next sync can retry that deck.
- **Hedron “staged” burst but no decks:** `hedron_consumer_complete` / `job_staged_and_enqueued` only means **staging + eval enqueue** on the hedron Worker. OpenAI / Scryfall / `decks` rows run on the **eval consumer** — tail both:
  `npx wrangler tail cubewizard-hedron-consumer-stg --config wrangler-hedron-consumer.jsonc`
  `npx wrangler tail cubewizard-eval-consumer-stg --config wrangler-eval-consumer.jsonc`
  Look for `eval_consumer received` → `eval_phase orient_start` → `eval_consumer finished`. If hedron logs succeed but eval never logs `received`, check the `cubewizard-eval-stg` queue depth and that `cubewizard-eval-consumer-stg` is deployed.
- **Wrangler auth:** `npx wrangler login`

## License

See [LICENSE](LICENSE) and [CONTRIBUTORS.md](CONTRIBUTORS.md). CubeWizard is licensed under GPL-3.0-or-later.
