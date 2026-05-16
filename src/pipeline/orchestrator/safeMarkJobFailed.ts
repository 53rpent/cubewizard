import { markJobFailed, type D1DatabaseLike } from "./processingJobRepo";
import { evalErrorFields } from "../util/formatEvalError";

export async function safeMarkJobFailed(
  db: D1DatabaseLike,
  uploadId: string,
  error: string
): Promise<void> {
  try {
    await markJobFailed(db, uploadId, error);
  } catch (e) {
    console.error("eval_mark_job_failed_error", {
      upload_id: uploadId,
      ...evalErrorFields(e),
    });
  }
}
