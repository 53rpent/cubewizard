ï»¿# CubeWizard - MTG Cube Analytics Platform

**Site Maintainer Guide**

CubeWizard is a Magic: The Gathering cube analysis platform that processes deck images using AI vision, enriches card data via Scryfall API, and serves interactive analytics dashboards. This README serves as a technical reference for site maintainers.

## System Architecture

- **Frontend**: Single-page app served as static assets by Cloudflare Workers (`docs/`)
- **Backend API**: Cloudflare Worker (`src/worker.js`) serving analytics endpoints from D1
- **Database**: Cloudflare D1 (SQLite-compatible, serverless)
- **Storage**: Cloudflare R2 for deck image uploads
- **Processing Pipeline**: Python — OpenAI Vision for card recognition, Scryfall for enrichment, writes to D1 via wrangler CLI
- **Input**: Web form upload (R2) or direct image processing

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
2. **The Worker** (`src/worker.js`) validates the upload and stores it in R2 under `{cube_id}/{timestamp}_{pilotName}/`.
3. **`pull_from_r2.py`** downloads new submissions from R2 into the local `submissions/` directory.
4. **`main.py import`** processes each submission (CSV metadata + deck image) through the AI vision pipeline, enriches with Scryfall data, and writes directly to Cloudflare D1.
5. Successfully processed folders are moved to `imported/` with a timestamp.
6. The live site immediately reflects new data (no deploy needed — D1 is the source of truth).

### Command Line Interface

#### Single Image Processing
```bash
# Basic image processing
python main.py path/to/deck_image.jpg

# With CubeCobra ID for improved accuracy
python main.py path/to/deck_image.jpg your_cubecobra_id
```

#### Import Deck Submissions
```bash
# Process all submissions in submissions/ folder
python main.py import

# Process from custom directory
python main.py import path/to/custom_folder
```

#### Interactive Mode
```bash
python main.py
```
Presents menu with options:
1. Process a single image file
2. Process deck submissions
3. Process a manual card list

### R2 Pull Commands
```bash
# Pull new submissions from R2
python pull_from_r2.py --pull

# List submissions in R2 and their download status
python pull_from_r2.py --list

# Reset tracker to re-download everything
python pull_from_r2.py --reset

# Interactive mode
python pull_from_r2.py
```

### Automated Weekly Pull

`scheduled_pull.bat` can be run via Windows Task Scheduler. It:
1. Pulls new submissions from R2 into `submissions/`
2. Runs `python main.py import` to process and write to D1
3. Logs output to `scheduled_pull.log`

## Website Update Workflow

Since the Worker reads from D1 directly, the typical workflow is:

```bash
# 1. Pull new submissions from R2
python pull_from_r2.py --pull

# 2. Process downloaded decklists (writes to D1 automatically)
python main.py import
```

No deploy step needed — the live site reflects D1 data immediately.

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

Apply D1 schema additions for deck image keys (run once against remote D1):

```bash
npx wrangler d1 execute cubewizard-db --env prod --remote --file=./migrations/001_oriented_image_r2_columns.sql
npx wrangler d1 execute cubewizard-db --env prod --remote --file=./migrations/002_oriented_thumb_r2_key.sql
```

Backfill oriented images from local `output/stored_images/` into the blob bucket (requires `.env` R2 + D1). This also uploads a small WebP thumbnail per deck (`{cube_id}/{image_id}_thumb.webp`):

```bash
python migrate_stored_images_to_r2.py --dry-run
python migrate_stored_images_to_r2.py
```

If decks were processed but `output/stored_images/` was never populated, copy each **staging** object from R2 into the filename the pipeline would use (`stored_images/{image_id}.{ext}`). `image_id` comes from D1 (same hash as ingest), not from metadata alone — the script lists staging, looks up the deck by `staging_image_r2_key` or by cube + pilot + W–L–D, then downloads only if the file is missing:

```bash
python recover_staging_to_stored_images.py --dry-run
python recover_staging_to_stored_images.py
# Optional: set stored_image_path in D1 after download; resolve duplicate D1 matches
python recover_staging_to_stored_images.py --update-d1 --pick-latest
```

After full images exist in R2, generate any missing list thumbnails (or `--force` to rebuild):

```bash
python backfill_thumbnails.py --dry-run
python backfill_thumbnails.py
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
├── main.py                      # Primary entry point — image processing + D1 writes
├── d1_writer.py                 # Cloudflare D1 writer (primary storage backend)
├── image_processor.py           # OpenAI Vision API integration
├── scryfall_client.py           # Scryfall API wrapper
├── config_manager.py            # Configuration handling
├── pull_from_r2.py              # R2 download tool (staging bucket)
├── oriented_r2.py               # Upload oriented deck images to blob R2 bucket
├── migrate_stored_images_to_r2.py # One-time migration: local stored_images → blob bucket + D1 (+ WebP thumbs)
├── backfill_thumbnails.py         # Build WebP thumbs for decks that have full image in R2 but no thumb row
├── recover_staging_to_stored_images.py # Download staging R2 images into stored_images/ by image_id
├── migrations/                  # D1 SQL migrations (e.g. oriented_image_r2 columns)
├── config.ini                   # Configuration (R2 creds, OpenAI settings)
├── schema.sql                   # D1 database schema reference
├── requirements.txt             # Python dependencies
├── .env                         # Environment variables (API keys)
├── scheduled_pull.bat           # Automated pull + process script
├── wrangler.jsonc               # Cloudflare Workers config (stg/prod)
├── wrangler-redirect.jsonc      # Redirect worker config
├── src/
│   ├── worker.js                # Main Cloudflare Worker (API + static assets)
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
├── submissions/                 # Incoming deck submissions (from R2)
├── imported/                    # Processed submissions (archived)
└── output/
    └── stored_images/           # Processed deck images (local archive)
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

Optional Worker var **`DECK_IMAGE_PUBLIC_BASE_URL`**: set to your public R2 custom domain (no trailing slash) so APIs return absolute image URLs instead of same-origin `/api/deck/.../photo` or `/thumb`.

## Maintenance

### Submission Processing
1. New submissions arrive in R2 via the web form
2. Run `python pull_from_r2.py --pull` to download to `submissions/`
3. Run `python main.py import` to process and write to D1
4. Successfully processed folders move to `imported/` with timestamp
5. Failed submissions remain in `submissions/` with error details

### Monitoring
- Check `submissions/` for unprocessed submissions
- Query D1 directly for database statistics
- Review `scheduled_pull.log` for automated run results

## Troubleshooting

### Common Issues
- **HEIC/HEIF Images**: Requires `pillow-heif` package (included in requirements.txt)
- **OpenAI API Errors**: Check API key in `.env` and account credit balance
- **Missing Scryfall Data**: Some cards may not be found due to name variations
- **R2 Credential Errors**: Verify `[r2]` section in `config.ini` has correct endpoint, key ID, and secret
- **D1 Write Failures**: Ensure `npx wrangler` is available and authenticated (`npx wrangler whoami`)
- **Wrangler Auth**: Run `npx wrangler login` if D1 commands return authorization errors
