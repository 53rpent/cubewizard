-- CubeWizard D1 Schema
-- Mirrors local SQLite schema from database_manager.py

-- Cubes table - stores cube metadata
CREATE TABLE IF NOT EXISTS cubes (
    cube_id TEXT PRIMARY KEY,
    created TIMESTAMP NOT NULL,
    last_updated TIMESTAMP NOT NULL,
    total_decks INTEGER DEFAULT 0
);

-- Decks table - stores deck metadata
CREATE TABLE IF NOT EXISTS decks (
    deck_id INTEGER PRIMARY KEY AUTOINCREMENT,
    cube_id TEXT NOT NULL,
    pilot_name TEXT NOT NULL,
    match_wins INTEGER NOT NULL,
    match_losses INTEGER NOT NULL,
    match_draws INTEGER DEFAULT 0,
    win_rate REAL NOT NULL,
    record_logged TIMESTAMP NOT NULL,
    image_source TEXT,
    stored_image_path TEXT,  -- relative to output dir only (e.g. stored_images/<id>.ext); not output/stored_images/...
    oriented_image_r2_key TEXT,
    oriented_thumb_r2_key TEXT,
    staging_image_r2_key TEXT,
    image_id TEXT UNIQUE,
    processing_timestamp TEXT NOT NULL,
    total_cards INTEGER NOT NULL,
    created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (cube_id) REFERENCES cubes (cube_id)
);

-- Cards table - stores individual card data for each deck
CREATE TABLE IF NOT EXISTS deck_cards (
    card_id INTEGER PRIMARY KEY AUTOINCREMENT,
    deck_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    mana_cost TEXT,
    cmc REAL,
    type_line TEXT,
    colors TEXT,
    color_identity TEXT,
    rarity TEXT,
    set_code TEXT,
    set_name TEXT,
    collector_number TEXT,
    power TEXT,
    toughness TEXT,
    oracle_text TEXT,
    scryfall_uri TEXT,
    image_uris TEXT,
    prices TEXT,
    created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (deck_id) REFERENCES decks (deck_id)
);

-- Deck statistics summary table
CREATE TABLE IF NOT EXISTS deck_stats (
    deck_id INTEGER PRIMARY KEY,
    total_found INTEGER DEFAULT 0,
    total_not_found INTEGER DEFAULT 0,
    processing_notes TEXT,
    FOREIGN KEY (deck_id) REFERENCES decks (deck_id)
);

-- Cube mapping table - replaces cube_mapping.csv
CREATE TABLE IF NOT EXISTS cube_mapping (
    cube_id TEXT PRIMARY KEY,
    cube_name TEXT NOT NULL,
    description TEXT DEFAULT ''
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_decks_cube_id ON decks(cube_id);
CREATE INDEX IF NOT EXISTS idx_decks_pilot_name ON decks(pilot_name);
CREATE INDEX IF NOT EXISTS idx_decks_processing_timestamp ON decks(processing_timestamp);
CREATE INDEX IF NOT EXISTS idx_deck_cards_deck_id ON deck_cards(deck_id);
CREATE INDEX IF NOT EXISTS idx_deck_cards_name ON deck_cards(name);
