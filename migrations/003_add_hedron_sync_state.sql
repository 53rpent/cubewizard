-- Hedron Network sync cursor (resume pagination across many invocations).
-- `next_key` mirrors Hedron API `nextKey` for https://hedron.network/cube-results/search pagination.
-- `done=1` means we've reached the end at least once; we still poll page 1 for new decks.
CREATE TABLE IF NOT EXISTS hedron_sync_state (
    cube_id TEXT PRIMARY KEY,
    next_key TEXT,
    done INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL,
    last_error TEXT,
    FOREIGN KEY (cube_id) REFERENCES cubes (cube_id)
);

CREATE INDEX IF NOT EXISTS idx_hedron_sync_state_done
  ON hedron_sync_state(done);

