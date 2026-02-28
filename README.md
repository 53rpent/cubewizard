ï»¿# CubeWizard - MTG Cube Analytics Platform

**Site Maintainer Guide**

CubeWizard is a comprehensive Magic: The Gathering cube analysis platform that processes deck images using AI vision, enriches card data via Scryfall API, and generates detailed analytics dashboards. This README serves as a technical reference for site maintainers.

## System Architecture

- **Core Engine**: Python-based processing pipeline with SQLite database
- **AI Vision**: OpenAI GPT-4 Vision API with structured outputs for card recognition
- **Data Enrichment**: Scryfall API integration for comprehensive card metadata
- **Analytics**: Statistical analysis engine with performance metrics and synergy detection
- **Hosting**: Cloudflare Workers serving a static dashboard from `docs/` + R2 storage for deck submissions
- **Input Methods**: Web form upload (R2), single images, or manual card lists

## Environment Setup

### Prerequisites
- Python 3.8+ with virtual environment
- OpenAI API key with GPT-4 Vision access
- Internet connection for Scryfall API calls
- Cloudflare account with Workers and R2 (for hosting/uploads)

### Installation
```
# Activate virtual environment (Windows)
activate.bat

# Install dependencies
pip install -r requirements.txt

# Configure environment variables
# Edit .env file with your OpenAI API key:
OPENAI_API_KEY=your_actual_api_key_here
```

### Configuration

**`config.ini`** — OpenAI model selection, analysis thresholds, file paths, database settings, and R2 credentials:
```
[r2]
endpoint_url = https://<account_id>.r2.cloudflarestorage.com
access_key_id = ...
secret_access_key = ...
bucket_name = decklist-uploads
```

**`cube_mapping.csv`** — Maps human-readable cube names to CubeCobra IDs (used by the submit form and processing pipeline).

**`wrangler.jsonc`** — Cloudflare Workers configuration with R2 bucket binding.

## Command Line Interface

### Core Processing Commands

#### 1. Single Image Processing
```
# Basic image processing
python main.py path/to/deck_image.jpg

# With CubeCobra ID for improved accuracy
python main.py path/to/deck_image.jpg your_cubecobra_id
```

#### 2. Import Deck Submissions
```
# Process all submissions in submissions/ folder
python main.py import

# Process from custom directory
python main.py import path/to/custom_folder
```

#### 3. Interactive Mode
```
python main.py
```
Presents menu with options:
1. Process a single image file
2. Process deck submissions
3. Process a manual card list

### Database Management Commands

#### View Database Contents
```
python view_database.py
```
Interactive database browser showing:
- All stored decks and metadata
- Cube statistics and pilot performance
- Card frequency analysis
- Browse by user / rename and merge pilot names

#### Delete Specific Decks
```
# Interactive mode - select from list
python delete_deck.py

# Command line - specify deck ID
python delete_deck.py deck_id_here
```

#### Reset Database
```
python reset_database.py
```
Creates backup then completely resets the database.

### Cube Management Commands

#### Manage Cube Mappings
```
python manage_cubes.py
```
Manage human-readable cube names and their CubeCobra IDs.

#### View Deck Images
```
python view_deck_images.py
```
Browse stored deck images with metadata.

### Analytics and Dashboard Commands

#### Generate Static Dashboard
```
python generate_static_dashboard.py
```
Creates self-contained HTML dashboard in `docs/` folder, including the deck submission form.

#### Run Interactive Dashboard
```
python dashboard.py
```
Launches Flask web server for real-time analytics (development only).

## Cloudflare Workers + R2 Pipeline

### How It Works

1. **Players submit decklists** via a web form at `/submit.html` (served by Cloudflare Workers).
2. **The Worker** (`src/worker.js`) validates the upload and stores it in R2 under `{cube_id}/{timestamp}_{pilotName}/`.
3. **`pull_from_r2.py`** downloads new submissions from R2 into the local `submissions/` directory.
4. **`main.py import`** processes each submission folder (CSV metadata + deck image) through the AI vision pipeline.
5. Successfully processed folders are moved to `imported/` with a timestamp.

### R2 Pull Commands
```
# Pull new submissions from R2
python pull_from_r2.py --pull

# List submissions in R2 and their download status
python pull_from_r2.py --list

# Reset tracker to re-download everything
python pull_from_r2.py --reset

# Interactive mode
python pull_from_r2.py
```

### Deploying the Worker
```
# Deploy Worker + static site to Cloudflare
deploy.bat
```
This resets the `deployment` branch to match `main`, then pushes to trigger Cloudflare's automatic deployment.

### Automated Weekly Pull

A Windows Task Scheduler task named **CubeWizard R2 Pull** runs `scheduled_pull.bat` weekly (Mondays at 9 AM). This script:
1. Pulls new submissions from R2 into `submissions/`
2. Runs `python main.py import` to process them
3. Logs everything to `scheduled_pull.log`

## Website Update Workflow

```
# 1. Pull new submissions from R2
python pull_from_r2.py --pull

# 2. Process downloaded decklists
python main.py import

# 3. Regenerate the static dashboard
python generate_static_dashboard.py

# 4. Deploy to Cloudflare Workers
deploy.bat
```

### Dashboard Features

The generated dashboard includes:
- **Performance Analysis**: Win rates, match statistics, pilot rankings
- **Synergy Detection**: Card combination analysis and archetype identification
- **Meta Analysis**: Color distribution, mana curves, card frequency
- **Card Search**: Look up individual card stats across all drafts
- **Interactive Charts**: Plotly-powered visualizations with hover details
- **Warning System**: Automatic alerts for datasets under 30 decks
- **Contact Footer**: Maintainer email and last updated timestamp

## Project Structure

```
CubeWizard/
├── main.py                      # Primary entry point and core logic
├── image_processor.py           # OpenAI Vision API integration
├── scryfall_client.py           # Scryfall API wrapper
├── database_manager.py          # SQLite database operations
├── dashboard.py                 # Analytics and dashboard generation
├── generate_static_dashboard.py # Static site generator
├── config_manager.py            # Configuration handling
├── pull_from_r2.py              # R2 download tool
├── delete_deck.py               # Deck deletion utility
├── reset_database.py            # Database reset utility
├── view_database.py             # Database browser
├── view_deck_images.py          # Image viewer utility
├── manage_cubes.py              # Cube mapping management
├── config.ini                   # Configuration settings (incl. R2 creds)
├── cube_mapping.csv             # Cube name/ID mappings
├── requirements.txt             # Python dependencies
├── .env                         # Environment variables (API keys)
├── activate.bat                 # Windows venv activation
├── deploy.bat                   # Cloudflare deployment script
├── scheduled_pull.bat           # Automated pull + process script
├── wrangler.jsonc               # Cloudflare Workers config
├── src/
│   └── worker.js                # Cloudflare Worker (upload API + static serving)
├── templates/
│   ├── dashboard.html           # Main dashboard template
│   ├── detailed_analysis.html   # Per-cube analysis template
│   └── submit.html              # Deck submission form template
├── submissions/                 # Incoming deck submissions (from R2)
├── imported/                    # Processed submissions (archived)
├── output/
│   ├── cubewizard.db            # Primary SQLite database
│   └── stored_images/           # Processed deck images (PNG format)
└── docs/                        # Generated static website (deployed)
```

## Maintenance Tasks

### Regular Database Maintenance
```
# View database statistics
python view_database.py

# Clean up old/invalid entries if needed
python delete_deck.py

# Full reset if database becomes corrupted
python reset_database.py
```

### Submission Processing Pipeline
1. New submissions arrive in R2 via the web form
2. Run `python pull_from_r2.py --pull` to download them to `submissions/`
3. Run `python main.py import` to process all new folders
4. Successfully processed folders move to `imported/` with timestamp
5. Failed submissions remain in `submissions/` with error details

### Monitoring
- Check `submissions/` folder for unprocessed submissions
- Review `scheduled_pull.log` for automated run results
- Monitor database size growth in `output/cubewizard.db`
- Verify website accessibility after deployments

## Troubleshooting

### Common Issues
- **HEIC/HEIF Images**: Requires `pillow-heif` package (included in requirements.txt)
- **OpenAI API Errors**: Check API key in `.env` and account credit balance
- **Database Locks**: Close any open `view_database.py` sessions before processing
- **Missing Scryfall Data**: Some cards may not be found due to name variations
- **R2 Credential Errors**: Verify `[r2]` section in `config.ini` has correct endpoint, key ID, and secret

### Performance Optimization
- Large images are automatically resized to reduce API costs
- Database includes indexes for common queries
- Static dashboard embeds all data to minimize hosting requirements
- Submission processing includes retry logic for transient failures

---

**For technical support, contact the maintainer via the dashboard footer email.**
