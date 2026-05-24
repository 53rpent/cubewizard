import type { EvalRunReport } from "../evalUsage/evalUsageReport";
import type { D1DatabaseLike } from "../orchestrator/processingJobRepo";
import { processingJobDocIdFromUploadId } from "../orchestrator/jobId";

export interface ProcessingJobOutcome {
  status: string;
  error: string | null;
  result_json: string | null;
  eval_report: EvalRunReport | null;
}

export function parseEvalReportFromResultJson(resultJson: string | null): EvalRunReport | null {
  if (!resultJson?.trim()) return null;
  try {
    const parsed = JSON.parse(resultJson) as { eval_report?: EvalRunReport };
    if (parsed?.eval_report && typeof parsed.eval_report === "object") {
      return parsed.eval_report;
    }
  } catch {
    return null;
  }
  return null;
}

export async function readProcessingJobOutcome(
  db: D1DatabaseLike,
  uploadId: string
): Promise<ProcessingJobOutcome | null> {
  const id = processingJobDocIdFromUploadId(uploadId);
  const row = await db
    .prepare(
      "SELECT status, error, result_json FROM processing_jobs WHERE id = ? LIMIT 1"
    )
    .bind(id)
    .first<{ status: string; error: string | null; result_json: string | null }>();

  if (!row) return null;
  return {
    status: row.status,
    error: row.error,
    result_json: row.result_json,
    eval_report: parseEvalReportFromResultJson(row.result_json),
  };
}
