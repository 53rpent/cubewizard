# CubeWizard

Magic: The Gathering cube analytics: deck photos are processed with OpenAI Vision, enriched via Scryfall, stored in Cloudflare D1, and served from a Worker-hosted dashboard (`docs/`).

## Architecture

| Piece | Role |
|--------|------|
| **Site Worker** (`src/worker.js`, `wrangler.jsonc`) | Static SPA, REST API, upload → R2, enqueue `EVAL_QUEUE` / `HEDRON_QUEUE`, read D1 |
| **Eval consumer** (`src/pipeline/entry/evalQueueEntry.ts`, `wrangler-eval-consumer.jsonc`) | Queue consumer: orientation → card extraction → Scryfall → D1 → oriented images on R2 |
| **Hedron consumer** (`src/hedron-consumer.js`, `wrangler-hedron-consumer.jsonc`) | Fetches Hedron images, stages R2, enqueues eval tasks |
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
| `OPENAI_API_KEY` | Eval consumer (required for vision) |
| `CW_EVAL_LOG_LEVEL` | `off` \| `low` \| `medium` \| `high` (OpenAI logs in eval consumer) |
| `CW_EVAL_QUEUE_CONCURRENCY` | Parallel decks per batch (1–5, default 5) |
| `CW_EVAL_VERBOSE_LOG` | Legacy: `1`/`true` → `high` if log level unset |
| `TURNSTILE_SECRET` | Site upload Turnstile (optional locally when `CWW_ENV=local`) |

### Eval consumer

- Bundled by Wrangler from `src/pipeline/entry/evalQueueEntry.ts` (no separate build step).
- Dry-run bundle: `npm run build:eval-consumer`
- Secrets (hosted): `npx wrangler secret put OPENAI_API_KEY --config wrangler-eval-consumer.jsonc [--env stg|prod]`
- **`nodejs_compat`** is enabled for JPEG encoding (`jpeg-js` / `Buffer`).
- **WebP / WASM:** codec files live in `vendor/jsquash-webp/` and are imported as precompiled `WebAssembly.Module` values (Workers disallow runtime `WebAssembly.compile` on raw bytes).
- **Parallelism:** up to `CW_EVAL_QUEUE_CONCURRENCY` decks per queue batch (default 5). Scryfall HTTP is globally throttled (~10 req/s total across parallel work in one isolate).
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

## Optional legacy GCP (Cloud Run)

Not used by the Cloudflare upload path. Deploy via GitHub Actions (`.github/workflows/deploy-cloud-run.yml`, `deploy-cloud-run-stg.yml`) and `services/enqueue`, `services/worker`. Enqueue secrets live in Google Secret Manager; the site Worker does not read them.

Local Python CLI (`python main.py`) remains for one-off image debugging against `config.ini`.

## Troubleshooting

- **Queue not draining locally:** use `npm run dev:all`, not separate `dev` + `dev:eval-consumer` terminals.
- **Stale processing card in UI:** row stuck in `processing_jobs` (`running`/`queued`); delete rows or reset `.wrangler/local-shared` (see above).
- **`WebAssembly.compile` disallowed:** ensure eval consumer uses vendored `.wasm` imports (Wrangler bundle), not runtime compile of wasm bytes.
- **Scryfall 429:** reduce `CW_EVAL_QUEUE_CONCURRENCY` or retry; global throttle targets ~10 req/s per isolate.
- **Wrangler auth:** `npx wrangler login`

## License

See [LICENSE](LICENSE) and [CONTRIBUTORS.md](CONTRIBUTORS.md). CubeWizard is licensed under GPL-3.0-or-later.
