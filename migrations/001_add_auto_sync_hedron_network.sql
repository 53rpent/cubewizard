-- Existing cubes default to syncing (1 = true in SQLite).
ALTER TABLE cubes ADD COLUMN auto_sync_hedron_network INTEGER NOT NULL DEFAULT 1;
