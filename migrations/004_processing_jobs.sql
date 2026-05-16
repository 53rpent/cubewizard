-- Upload / eval job status for /api/processing-decks (Phase B: read path; writers added in later phases).
-- id matches Firestore document id: u_<urlsafe-base64(upload_id) without padding> (see services/enqueue/app.py _job_doc_id).

CREATE TABLE IF NOT EXISTS processing_jobs (
    id TEXT PRIMARY KEY,
    upload_id TEXT NOT NULL UNIQUE,
    cube_id TEXT NOT NULL,
    status TEXT NOT NULL,
    pilot_name TEXT,
    submitted_at TEXT,
    schema_version INTEGER NOT NULL DEFAULT 1,
    r2_bucket TEXT,
    r2_prefix TEXT,
    image_url TEXT,
    image_source TEXT,
    match_wins INTEGER,
    match_losses INTEGER,
    match_draws INTEGER,
    cloud_task_name TEXT,
    lease_expires_at TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    result_json TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    started_at INTEGER,
    finished_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_processing_jobs_cube_status
    ON processing_jobs (cube_id, status);

CREATE INDEX IF NOT EXISTS idx_processing_jobs_submitted
    ON processing_jobs (cube_id, submitted_at);
