/**
 * D1 `processing_jobs` helpers shared by the site Worker, Hedron consumer, and eval pipeline.
 * Keep SQL aligned with `src/pipeline/orchestrator/processingJobRepo.ts`.
 */

/** Stable `processing_jobs.id`: `u_` + url-safe base64 of `upload_id`. */
export function processingJobDocIdFromUploadId(uploadId) {
  var s = String(uploadId || "");
  var bytes = new TextEncoder().encode(s);
  var bin = "";
  for (var i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  var b64 = btoa(bin);
  return "u_" + b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/**
 * Insert or refresh a queued row so `/api/processing-decks/:cubeId` can list it immediately
 * after upload / Hedron staging — before the eval consumer runs.
 *
 * @param {D1Database} db
 * @param {object} task
 */
export async function upsertQueuedProcessingJob(db, task) {
  var uploadId = String(task.upload_id || "");
  if (!uploadId) return;

  var id = processingJobDocIdFromUploadId(uploadId);
  var cube = String(task.cube_id || "");
  var pilot = task.pilot_name != null ? String(task.pilot_name) : null;
  var submitted = task.submitted_at ? String(task.submitted_at) : new Date().toISOString();

  var sql =
    "INSERT INTO processing_jobs (" +
    "id, upload_id, cube_id, status, pilot_name, submitted_at, schema_version, " +
    "r2_bucket, r2_prefix, image_url, image_source, match_wins, match_losses, match_draws, " +
    "created_at, updated_at" +
    ") VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch()) " +
    "ON CONFLICT(upload_id) DO UPDATE SET " +
    "cube_id = excluded.cube_id, " +
    "status = 'queued', " +
    "pilot_name = excluded.pilot_name, " +
    "submitted_at = excluded.submitted_at, " +
    "schema_version = excluded.schema_version, " +
    "r2_bucket = excluded.r2_bucket, " +
    "r2_prefix = excluded.r2_prefix, " +
    "image_url = excluded.image_url, " +
    "image_source = excluded.image_source, " +
    "match_wins = excluded.match_wins, " +
    "match_losses = excluded.match_losses, " +
    "match_draws = excluded.match_draws, " +
    "updated_at = unixepoch()";

  await db
    .prepare(sql)
    .bind(
      id,
      uploadId,
      cube,
      pilot,
      submitted,
      task.schema_version != null ? task.schema_version : 1,
      task.r2_bucket != null ? String(task.r2_bucket) : null,
      task.r2_prefix != null ? String(task.r2_prefix) : null,
      task.image_url != null ? String(task.image_url) : null,
      task.image_source != null ? String(task.image_source) : null,
      task.match_wins != null ? task.match_wins : null,
      task.match_losses != null ? task.match_losses : null,
      task.match_draws != null ? task.match_draws : null
    )
    .run();
}
