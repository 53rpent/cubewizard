# CubeWizard - MTG Cube Analytics Platform

**Site Maintainer Guide**

CubeWizard is a comprehensive Magic: The Gathering cube analysis platform that processes deck images using AI vision, enriches card data via Scryfall API, and generates detailed analytics dashboards. This README serves as a technical reference for site maintainers.

## 🏗️ System Architecture

- **Core Engine**: Python-based processing pipeline with SQLite database
- **AI Vision**: OpenAI GPT-4 Vision API with structured outputs for card recognition
- **Data Enrichment**: Scryfall API integration for comprehensive card metadata
- **Analytics**: Statistical analysis engine with performance metrics and synergy detection
- **Output Formats**: Interactive web dashboards and static HTML for hosting
- **Input Methods**: Single images, MASV batch processing, manual card lists

## 🚀 Environment Setup

### Prerequisites
- Python 3.8+ with virtual environment
- OpenAI API key with GPT-4 Vision access
- Internet connection for Scryfall API calls

### Installation
```bash
# Activate virtual environment (Windows)
activate.bat

# Install dependencies  
pip install -r requirements.txt

# Configure environment variables
# Edit .env file with your OpenAI API key:
OPENAI_API_KEY=your_actual_api_key_here
```

### Configuration
Edit `config.ini` to customize:
- OpenAI model selection
- Analysis thresholds and parameters
- File paths and database settings

## 📋 Command Line Interface

### Core Processing Commands

#### 1. Single Image Processing
```bash
# Basic image processing
python main.py path/to/deck_image.jpg

# With CubeCobra ID for improved accuracy
python main.py path/to/deck_image.jpg your_cubecobra_id
```

#### 2. MASV Batch Processing
```bash
# Process all submissions in masv_data/ folder
python main.py masv

# Process from custom directory
python main.py masv path/to/custom_masv_folder
```

#### 3. Interactive Mode
```bash
python main.py
```
Presents menu with options:
1. Process a single image file
2. Process MASV submissions  
3. Process a manual card list

### Database Management Commands

#### View Database Contents
```bash
python view_database.py
```
Interactive database browser showing:
- All stored decks and metadata
- Cube statistics and pilot performance
- Card frequency analysis

#### Delete Specific Decks
```bash
# Interactive mode - select from list
python delete_deck.py

# Command line - specify deck ID
python delete_deck.py deck_id_here
```

#### Reset Database
```bash
python reset_database.py
```
Creates backup then completely resets the database.

### Cube Management Commands

#### Manage Cube Mappings
```bash
python manage_cubes.py
```
Manage human-readable cube names and their CubeCobra IDs.

#### View Deck Images
```bash
python view_deck_images.py
```
Browse stored deck images with metadata.

### Analytics and Dashboard Commands

#### Generate Static Dashboard
```bash
python generate_static_dashboard.py
```
Creates self-contained HTML dashboard in `docs/` folder.

#### Run Interactive Dashboard  
```bash
python dashboard.py
```
Launches Flask web server for real-time analytics (development only).

#### Google Forms Import
```bash
python google_forms_import.py
```
Bulk import tournament data from Google Forms CSV exports.

## 🌐 Website Publishing

### Static Dashboard Deployment

The `generate_static_dashboard.py` command creates a complete static website in the `docs/` folder that can be hosted anywhere:

#### Publishing Options:

**1. Surge.sh (Recommended)**
```bash
# Install surge globally
npm install -g surge

# Deploy to surge
cd docs
surge
```

### Website Update Workflow

```bash
# 1. Process any new MASV submissions
python main.py masv

# 2. Generate updated static dashboard
python generate_static_dashboard.py

# 3. Deploy to hosting platform
cd docs && surge
```

### Analytics Features

The generated dashboard includes:
- **Performance Analysis**: Win rates, match statistics, pilot rankings
- **Synergy Detection**: Card combination analysis and archetype identification  
- **Meta Analysis**: Color distribution, mana curves, card frequency
- **Interactive Charts**: Plotly-powered visualizations with hover details
- **Warning System**: Automatic alerts for datasets under 30 decks
- **Contact Footer**: Maintainer email and last updated timestamp

## 📁 Project Structure

```
CubeWizard/
├── main.py                    # Primary entry point and core logic
├── image_processor.py         # OpenAI Vision API integration  
├── scryfall_client.py         # Scryfall API wrapper
├── database_manager.py        # SQLite database operations
├── dashboard.py               # Analytics and dashboard generation
├── generate_static_dashboard.py # Static site generator
├── config_manager.py          # Configuration handling
├── google_forms_import.py     # Google Forms CSV processing
├── delete_deck.py            # Deck deletion utility
├── reset_database.py         # Database reset utility
├── view_database.py          # Database browser
├── view_deck_images.py       # Image viewer utility
├── manage_cubes.py           # Cube mapping management
├── config.ini                # Configuration settings
├── requirements.txt          # Python dependencies
├── .env                      # Environment variables (API keys)
├── activate.bat              # Windows environment activation
├── cube_mapping.csv          # Cube name/ID mappings
├── masv_data/               # Incoming MASV submissions
├── masv_imported/           # Processed MASV submissions  
├── output/                  # Database and processed images
│   ├── cubewizard.db        # Primary SQLite database
│   └── stored_images/       # Processed deck images (PNG format)
├── docs/                    # Generated static website
└── templates/               # Jinja2 templates for dashboard
    ├── dashboard.html       # Main dashboard template
    ├── detailed_analysis.html # Performance analysis template  
    └── submit.html          # Submission form template
```

## 🔧 Maintenance Tasks

### Regular Database Maintenance
```bash
# View database statistics
python view_database.py

# Clean up old/invalid entries if needed  
python delete_deck.py

# Full reset if database becomes corrupted
python reset_database.py
```

### MASV Processing Pipeline
1. New submissions appear in `masv_data/` folder
2. Run `python main.py masv` to process all new folders
3. Successfully processed folders move to `masv_imported/` with timestamp
4. Failed submissions remain in `masv_data/` with error details

### Updating Live Website
1. Process new data: `python main.py masv`
2. Regenerate dashboard: `python generate_static_dashboard.py`
3. Deploy: `cd docs && surge`

### Monitoring
- Check `masv_data/` folder for unprocessed submissions
- Monitor database size growth in `output/cubewizard.db`
- Review error logs during MASV processing
- Verify website accessibility after deployments

## 🛠️ Troubleshooting

### Common Issues
- **HEIC/HEIF Images**: Requires `pillow-heif` package (included in requirements.txt)
- **OpenAI API Errors**: Check API key in `.env` and account credit balance
- **Database Locks**: Close any open `view_database.py` sessions before processing
- **Missing Scryfall Data**: Some cards may not be found due to name variations

### Performance Optimization
- Large images are automatically resized to reduce API costs
- Database includes indexes for common queries
- Static dashboard embeds all data to minimize hosting requirements
- MASV processing includes retry logic for transient failures

---

**For technical support, contact the maintainer via the dashboard footer email.**