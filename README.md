# CubeWizard - MTG Cube Analytics Platform

**Site Maintainer Guide**

CubeWizard is a Magic: The Gathering cube analysis platform that processes deck images using AI vision, enriches card data via Scryfall API, and serves interactive analytics dashboards. This README serves as a technical reference for site maintainers.

## System Architecture

- **Frontend**: Single-page app served as static assets by Cloudflare Workers (`docs/`)
- **Backend API**: Cloudflare Worker (`src/worker.js`) serving analytics endpoints from D1
- **Database**: Cloudflare D1 (SQLite-compatible, serverless)
- **Storage**: Cloudflare R2 for deck image uploads
- **Processing Pipeline**: GCP Cloud Run — `services/enqueue` accepts uploads from the Worker and enqueues Cloud Tasks; `services/worker` downloads from R2, runs OpenAI Vision + Scryfall enrichment (`main.py` / shared Python modules), writes to Cloudflare D1 and uploads oriented images to R2
- **Input**: Web form upload (R2); optional local `python main.py` only for maintainer debugging (same code path as the Cloud Run worker)

## Environment Setup

### Prerequisites
- Python 3.8+ with virtual environment
- Node.js (for `npx wrangler` CLI)
- OpenAI API key with GPT-4 Vision access
- Cloudflare account with Workers, D1, and R2

### Installation
```bash
# Create and activate virtual environment (Windows)
python -m venv .venv
.venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure environment variables
# Create .env file with your OpenAI API key:
OPENAI_API_KEY=your_actual_api_key_here
```

### Configuration

**`config.ini`** — OpenAI model selection, analysis thresholds, and R2 credentials:
```ini
[r2]
endpoint_url = https://<account_id>.r2.cloudflarestorage.com
access_key_id = ...
secret_access_key = ...
bucket_name = decklist-uploads
```

**`wrangler.jsonc`** — Cloudflare Workers configuration with D1 and R2 bindings. Has `stg` and `prod` environments.

**`wrangler-redirect.jsonc`** — Configuration for the domain redirect worker (cubewizard.org → cube-wizard.com).

## Processing Pipeline

### How It Works

1. **Players submit decklists** via the web form at `/submit.html`.
2. **The Cloudflare Worker** (`src/worker.js`) validates the upload, stores objects in R2 under `{cube_id}/{timestamp}_{pilotName}/`, and calls **`services/enqueue`** on GCP with bucket/prefix metadata.
3. **Cloud Tasks** invokes **`services/worker`**, which downloads that prefix into a temporary folder, normalizes it to `pilot_data.csv` + `deck_image.*`, and runs **`CubeWizard.process_submissions`** (same Python stack as below).
4. The worker writes enriched decks to **Cloudflare D1**, uploads oriented images to the **`cubewizard-deck-images`** R2 bucket, and updates **Firestore** job status (`GCP_DEPLOYMENT.md`).
5. The live site reads D1 directly — no static redeploy is required for new deck rows.

### Python Modules (shared with Cloud Run)

Repo-root modules **`main.py`**, **`image_processor.py`**, **`scryfall_client.py`**, **`d1_writer.py`**, **`oriented_r2.py`**, and **`config_manager.py`** are copied into the worker container (`services/worker/Dockerfile`) and are the canonical processing implementation.

### Optional local CLI

Maintainers can still run **`python main.py`** for one-off debugging (single image, `import` against a local folder, or interactive menu). Production traffic does **not** depend on this; use **`GCP_DEPLOYMENT.md`** / GitHub Actions for deploys.

## Website Update Workflow

- **Deck data**: arrives via uploads → GCP worker → D1 (site picks it up automatically).
- **Frontend / Worker**: change files under `docs/` or `src/` and **`npx wrangler deploy`** (or rely on CI if configured).

## Deploying Workers

```bash
# Deploy to staging
npx wrangler deploy --env stg

# Deploy to production
npx wrangler deploy --env prod

# Deploy the redirect worker (cubewizard.org → cube-wizard.com)
npx wrangler deploy --config wrangler-redirect.jsonc
```

### Worker Environments

| Environment | Worker Name | URL |
|---|---|---|
| Staging | `cubewizard-stg` | https://cubewizard-stg.amatveyenko.workers.dev |
| Production | `cubewizard-prod` | https://cubewizard-prod.amatveyenko.workers.dev |
| Redirect | `cubewizard-redirect` | cubewizard.org (redirects to cube-wizard.com) |

Both stg and prod share the same D1 database. The Worker binds two R2 buckets: **`decklist-uploads`** (staging — raw uploads + `metadata.json`) and **`cubewizard-deck-images`** (oriented deck photos for the site). Create the blob bucket before deploy:

```bash
npx wrangler r2 bucket create cubewizard-deck-images
```

### Staging GCP processing pipeline (Cloud Run)

Your Cloudflare Worker `stg` environment can be wired to **staging GCP resources** (Cloud Run + Cloud Tasks + Firestore upload status) while still writing decks to the **shared** D1 database.

- GCP setup commands: `GCP_STAGING.md`
- GCP deployment docs: `GCP_DEPLOYMENT.md`

Required GitHub Actions secrets for GCP deploy (**OIDC only**; enqueue shared secret is not in GitHub):

- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_SERVICE_ACCOUNT_EMAIL`

Store enqueue shared secrets in **Google Secret Manager** (`enqueue-shared-secret-prod` / `enqueue-shared-secret-stg`); **`GCP_DEPLOYMENT.md`** section 4 has `gcloud` commands. **`Wrangler`** must use the **same plaintext** (`ENQUEUE_SHARED_SECRET`) per environment.

Required Cloudflare Worker `stg` secrets (Wrangler):

```bash
wrangler secret put ENQUEUE_SHARED_SECRET --env stg

# For /api/processing-decks/:cubeId — reads Firestore upload-status DB (see wrangler.jsonc FIRESTORE_* vars per env).
wrangler secret put GCP_FIRESTORE_SA_JSON --env stg
```

### Hedron Cloudflare Queue pipeline

Hedron sync uses Cloudflare Queues so the site Worker only fetches/parses Hedron JSON and publishes deck jobs. The dedicated consumer Workers download Hedron images to R2, then call the existing GCP enqueue service with the staged `r2_bucket` and `r2_prefix`.

Create the queues once per environment:

```bash
npx wrangler queues create cubewizard-hedron-stg
npx wrangler queues create cubewizard-hedron-stg-dlq
npx wrangler queues create cubewizard-hedron-prod
npx wrangler queues create cubewizard-hedron-prod-dlq
```

Set the same enqueue shared secret on the main Workers and the Hedron consumer Workers:

```bash
npx wrangler secret put ENQUEUE_SHARED_SECRET --env stg
npx wrangler secret put ENQUEUE_SHARED_SECRET --env prod
npx wrangler secret put ENQUEUE_SHARED_SECRET --config wrangler-hedron-consumer.jsonc --env stg
npx wrangler secret put ENQUEUE_SHARED_SECRET --config wrangler-hedron-consumer.jsonc --env prod
```

Deploy the producer and consumer Workers:

```bash
npx wrangler deploy --env stg
npx wrangler deploy --env prod
npx wrangler deploy --config wrangler-hedron-consumer.jsonc --env stg
npx wrangler deploy --config wrangler-hedron-consumer.jsonc --env prod
```

Validate staging first by triggering `/api/hedron-sync/:cubeId` for a small cube, then for a cube with more than 50 Hedron decks to confirm `sendBatch` publishing and queue consumer delivery.

Apply D1 migrations as needed (repository ships SQL under `migrations/`):

```bash
npx wrangler d1 execute cubewizard-db --env prod --remote --file=./migrations/001_add_auto_sync_hedron_network.sql
npx wrangler d1 execute cubewizard-db --env prod --remote --file=./migrations/002_add_hedron_synced_decks.sql
npx wrangler d1 execute cubewizard-db --env prod --remote --file=./migrations/003_add_hedron_sync_state.sql
```

### Dashboard Features

The site includes:
- **Performance Dashboard**: Win rates, match statistics, pilot rankings
- **Detailed Analysis**: Color performance, card win rates, mana curves
- **Scatter Charts**: Win rate vs. appearances with performance metrics
- **Card Search**: Look up individual card stats across all drafts
- **Interactive Charts**: Plotly-powered visualizations with hover details
- **Deck Submission Form**: Upload deck images with metadata
- **Add Cube**: Register new cubes for tracking

## Project Structure

```
CubeWizard/
├── main.py                      # CubeWizard class — shared with Cloud Run worker (CLI optional)
├── d1_writer.py                 # Cloudflare D1 REST writer
├── image_processor.py           # OpenAI Vision API integration
├── scryfall_client.py           # Scryfall API wrapper
├── oriented_r2.py               # Upload oriented deck images / thumbnails to R2 (blob bucket)
├── config_manager.py            # Loads OpenAI / paths from config.ini
├── migrations/                  # D1 SQL migrations (oriented_image_r2 columns, etc.)
├── config.ini                   # OpenAI + optional local R2 defaults (worker uses Secret/env too)
├── schema.sql                   # D1 database schema reference
├── requirements.txt             # Python dependencies
├── wrangler.jsonc               # Cloudflare Workers config (stg/prod)
├── wrangler-hedron-consumer.jsonc # Hedron Queue consumer config (stg/prod)
├── wrangler-redirect.jsonc      # Redirect worker config
├── services/
│   ├── enqueue/                 # Cloud Run: enqueue Cloud Tasks
│   └── worker/                  # Cloud Run: R2 download + processing + Firestore
├── src/
│   ├── worker.js                # Main Cloudflare Worker (API + static assets)
│   ├── hedron-consumer.js       # Cloudflare Queue consumer for Hedron images
│   └── redirect-worker.js       # Domain redirect worker
├── docs/                        # Static site assets (served by Worker)
│   ├── index.html               # Main dashboard SPA
│   ├── analysis-card.html       # Card data (/cube/cards)
│   ├── analysis-color.html      # Color data (/cube/colors)
│   ├── analysis-synergy.html    # Synergy data (/cube/synergies)
│   ├── analysis-shared.css      # Shared layout for data pages + decks
│   ├── analysis-shared.js       # Card/color/synergy data page boot (CWDataPage)
│   ├── decks-main.js            # Deck list + modal for decks.html
│   ├── decks.html               # Deck list (/cube/decks)
│   ├── submit.html              # Deck submission form
│   ├── add_cube.html            # Add new cube form
│   └── CubeWizard.png           # Site logo
└── output/stored_images/        # Created when running main.py locally (optional archive)
```

## D1 Database

The D1 database (`cubewizard-db`) contains five tables:

| Table | Purpose |
|---|---|
| `cubes` | Cube metadata (ID, name, deck count) |
| `decks` | Deck metadata (pilot, record, win rate) |
| `deck_cards` | Individual card data per deck (Scryfall-enriched) |
| `deck_stats` | Processing statistics per deck |
| `cube_mapping` | Human-readable name ↔ cube ID mapping |

### Direct D1 Queries
```bash
# Query D1 via wrangler
npx wrangler d1 execute cubewizard-db --env prod --remote --command "SELECT COUNT(*) FROM decks;"

# JSON output for scripting
npx wrangler d1 execute cubewizard-db --env prod --remote --json --command "SELECT * FROM cubes;"
```

## Worker API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/cubes` | GET | List all cubes |
| `/api/dashboard/:cubeId` | GET | Full dashboard data for a cube |
| `/api/charts/:cubeId/:chartType` | GET | Chart HTML (color-bar, scatter, etc.) |
| `/api/upload` | POST | Upload deck submission to R2 |
| `/api/validate-cube` | POST | Validate a CubeCobra cube ID |
| `/api/add-cube` | POST | Register a new cube in D1 |
| `/api/decks/:cubeId` | GET | Deck list (`deck_photo_url` full, `deck_thumb_url` small WebP for grids) |
| `/api/trophy-decks/:cubeId` | GET | Undefeated decks (same URL fields) |
| `/api/deck/:deckId` | GET | Single deck + cards (`deck_photo_url`, `deck_thumb_url`) |
| `/api/deck/:deckId/photo` | GET | Full oriented image from blob bucket |
| `/api/deck/:deckId/thumb` | GET | WebP thumbnail (~256px long edge) for list views |
| `/api/deck/:deckId/cards` | PUT | Replace deck list: JSON `{ "names": ["Card A", "Card B", ...] }` (one name per card; duplicates allowed). Resolves names via Scryfall **POST /cards/collection** in batches of 75 (500ms between batches), then **GET /cards/named?fuzzy=** for misses, with **~12s timeout** per fuzzy call and parallel fuzzy waves so large decks stay within Worker limits. |
| `/api/internal/release-hedron-sync-dedupe` | POST | Internal: JSON `{ "deck_image_uuid": "<id>" }`, header `X-Shared-Secret` (same as GCP enqueue). Deletes that row from D1 `hedron_synced_decks`. Called by **`cubewizard-enqueue`** `/cleanup/stale-hedron-jobs` after verifying the Cloud Task is gone; not for browsers. |

Optional Worker var **`DECK_IMAGE_PUBLIC_BASE_URL`**: set to your public R2 custom domain (no trailing slash) so APIs return absolute image URLs instead of same-origin `/api/deck/.../photo` or `/thumb`.

## Maintenance

### Submission Processing

1. New submissions land in R2 from the web form.
2. The Cloudflare Worker calls GCP **enqueue**, which creates a Cloud Task for **worker**.
3. Monitor job status in **Firestore** (and optional Worker endpoints such as `/api/processing-decks/:cubeId` when configured); see **`GCP_DEPLOYMENT.md`** and **`STG_VALIDATION.md`** for staging checks.

### Monitoring

- Cloud Run logs for **`cubewizard-enqueue`** / **`cubewizard-worker`** (and `*-stg` variants).
- Cloud Tasks queue depth and retries in the GCP console.
- D1 queries (examples above) for deck counts and recent rows.

## Troubleshooting

### Common Issues
- **HEIC/HEIF Images**: Requires `pillow-heif` package (included in requirements.txt)
- **OpenAI API Errors**: Check API key in `.env` and account credit balance
- **Missing Scryfall Data**: Some cards may not be found due to name variations
- **R2 Credential Errors**: Verify `[r2]` section in `config.ini` has correct endpoint, key ID, and secret
- **D1 Write Failures**: Ensure `npx wrangler` is available and authenticated (`npx wrangler whoami`)
- **Wrangler Auth**: Run `npx wrangler login` if D1 commands return authorization errors

## License

CubeWizard is free software: you may redistribute and/or modify it under the terms of the [GNU General Public License](https://www.gnu.org/licenses/gpl-3.0.html) as published by the Free Software Foundation, either **version 3** of the License or **(at your option) any later version**. See [LICENSE](LICENSE) for the full license text.

Copyright © 2026 CubeWizard contributors.
