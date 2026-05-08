-- Track Hedron Network deck images already staged to R2 / enqueued (dedupe across cron + add-cube).
CREATE TABLE IF NOT EXISTS hedron_synced_decks (
    deck_image_uuid TEXT PRIMARY KEY,
    cube_id TEXT NOT NULL,
    draft_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    r2_prefix TEXT NOT NULL,
    synced_at TIMESTAMP NOT NULL,
    FOREIGN KEY (cube_id) REFERENCES cubes (cube_id)
);

CREATE INDEX IF NOT EXISTS idx_hedron_synced_decks_cube_id
  ON hedron_synced_decks(cube_id);
