import { processingJobDocIdFromUploadId } from "./jobId";
import type { TaskRequest } from "../contracts/taskRequest.zod";

/** SQL must stay aligned with [`src/processingJobsD1.js`](../../processingJobsD1.js) (site upload + Hedron enqueue). */

export interface D1DatabaseLike {
  prepare(sql: string): {
    bind(...args: unknown[]): {
      run(): Promise<unknown>;
      first<T = unknown>(): Promise<T | null>;
    };
  };
  batch(stmts: unknown[]): Promise<Array<{ meta?: { changes?: number } } | undefined>>;
}

export async function upsertQueuedProcessingJob(
  db: D1DatabaseLike,
  task: TaskRequest
): Promise<void> {
  const id = processingJobDocIdFromUploadId(task.upload_id);
  const pilot = task.pilot_name ?? null;
  const submitted = task.submitted_at ?? new Date().toISOString();
  const cube = task.cube_id ?? "";
  const sql =
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
      task.upload_id,
      cube,
      pilot,
      submitted,
      task.schema_version ?? 1,
      task.r2_bucket ?? null,
      task.r2_prefix ?? null,
      task.image_url ?? null,
      task.image_source ?? null,
      task.match_wins ?? null,
      task.match_losses ?? null,
      task.match_draws ?? null
    )
    .run();
}

export async function markJobRunning(db: D1DatabaseLike, uploadId: string): Promise<void> {
  const id = processingJobDocIdFromUploadId(uploadId);
  await db
    .prepare(
      "UPDATE processing_jobs SET status = 'running', started_at = unixepoch(), " +
        "attempt_count = attempt_count + 1, updated_at = unixepoch(), error = NULL " +
        "WHERE id = ?"
    )
    .bind(id)
    .run();
}

export async function markJobDone(
  db: D1DatabaseLike,
  uploadId: string,
  resultJson: string
): Promise<void> {
  const id = processingJobDocIdFromUploadId(uploadId);
  await db
    .prepare(
      "UPDATE processing_jobs SET status = 'done', finished_at = unixepoch(), " +
        "updated_at = unixepoch(), result_json = ?, error = NULL WHERE id = ?"
    )
    .bind(resultJson, id)
    .run();
}

export async function markJobFailed(
  db: D1DatabaseLike,
  uploadId: string,
  error: string
): Promise<void> {
  const id = processingJobDocIdFromUploadId(uploadId);
  await db
    .prepare(
      "UPDATE processing_jobs SET status = 'failed', finished_at = unixepoch(), " +
        "updated_at = unixepoch(), error = ? WHERE id = ?"
    )
    .bind(error.slice(0, 4000), id)
    .run();
}
