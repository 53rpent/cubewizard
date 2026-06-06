import { resolveEvalVisionLlm } from "../config/resolveEvalVisionLlm";
import type { TaskRequest } from "../contracts/taskRequest.zod";
import { parseEvalOpenAiLogLevel } from "../openai/chatCompletionsApi";
import { PermanentEvalError } from "./evalErrors";
import { parseEvalJpegQuality, parseEvalMaxImageSide } from "./evalImageLimits";
import type { D1DatabaseLike } from "./processingJobRepo";
import { upsertQueuedProcessingJob } from "./processingJobRepo";
import type { RunEvalTaskEnv } from "./runEvalTask";

export const HEDRON_MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export interface StagingMetadata {
  cube_id?: string;
  pilot_name?: string;
  match_wins?: number;
  match_losses?: number;
  match_draws?: number;
  win_rate?: number;
  record_logged?: string;
  image_key?: string;
  original_filename?: string;
  expected_deck_size?: number;
  expected_count?: number;
}

export interface EvalPipelineConfig {
  maxOut: number;
  reasoning: "low" | "medium" | "high";
  orientReasoning: "low" | "medium" | "high";
  maxCubeCards: number;
  useMultiPass: boolean;
  jpegQ: number;
  openAiLogLevel: ReturnType<typeof parseEvalOpenAiLogLevel>;
  maxImageSide: number;
  visionModel: string;
  visionApiKey: string;
  visionBaseUrl: string;
  openAiGatewayToken?: string;
  aiGatewayId?: string;
  openAiRequestTimeoutMs: number;
}

export function resolveEvalPipelineConfig(env: RunEvalTaskEnv): EvalPipelineConfig {
  const maxOut = Math.min(
    32000,
    Math.max(1000, parseInt(String(env.OPENAI_MAX_OUTPUT_TOKENS || "20000"), 10) || 20000),
  );
  const reasoning = (String(env.OPENAI_REASONING_EFFORT || "medium").trim() || "medium") as "low" | "medium" | "high";
  const orientReasoning = (String(env.OPENAI_ORIENT_REASONING_EFFORT || "low").trim() || "low") as
    | "low"
    | "medium"
    | "high";
  const maxCubeCards = Math.min(2000, parseInt(String(env.CW_EVAL_MAX_CUBECOBRA_CARDS || "1000"), 10) || 1000);
  const useMultiPass = !/^0|false|no$/i.test(String(env.CW_EVAL_USE_MULTI_PASS || "true"));
  const vision = resolveEvalVisionLlm(env);
  return {
    maxOut,
    reasoning,
    orientReasoning,
    maxCubeCards,
    useMultiPass,
    jpegQ: parseEvalJpegQuality(env.CW_EVAL_JPEG_QUALITY),
    openAiLogLevel: parseEvalOpenAiLogLevel(env),
    maxImageSide: parseEvalMaxImageSide(env.CW_EVAL_MAX_IMAGE_SIDE),
    visionModel: vision.model,
    visionApiKey: vision.apiKey,
    visionBaseUrl: vision.baseUrl,
    openAiGatewayToken: vision.gatewayToken,
    aiGatewayId: vision.aiGatewayId,
    openAiRequestTimeoutMs: vision.requestTimeoutMs,
  };
}

export function processingTimestampTag(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

export function stableProcessingTimestamp(uploadId: string): string {
  return String(uploadId || "").trim() || processingTimestampTag();
}

export async function ensureQueuedProcessingJob(
  db: D1DatabaseLike,
  task: Pick<TaskRequest, "upload_id" | "cube_id" | "pilot_name" | "submitted_at">,
): Promise<void> {
  const row = await db
    .prepare("SELECT id FROM processing_jobs WHERE upload_id = ? LIMIT 1")
    .bind(task.upload_id)
    .first();
  if (row) return;
  await upsertQueuedProcessingJob(db, task as TaskRequest);
}

export async function readStagingPackage(
  task: TaskRequest,
  bucket: RunEvalTaskEnv["BUCKET"],
): Promise<{ imageBytes: Uint8Array; metadata: StagingMetadata }> {
  const prefix = String(task.r2_prefix || "").replace(/\/?$/, "/");
  const metaKey = prefix + "metadata.json";
  const metaObj = await bucket.get(metaKey);
  if (!metaObj) throw new PermanentEvalError("staging_metadata_missing");
  const metadata = JSON.parse(new TextDecoder().decode(await metaObj.arrayBuffer())) as StagingMetadata;
  const imageKey = metadata.image_key;
  if (!imageKey || typeof imageKey !== "string") {
    throw new PermanentEvalError("staging_metadata_missing_image_key");
  }
  const imgObj = await bucket.get(imageKey);
  if (!imgObj) throw new PermanentEvalError("staging_image_missing");
  const imageBytes = new Uint8Array(await imgObj.arrayBuffer());
  return { imageBytes, metadata };
}

export async function readImageFromUrl(task: TaskRequest, fetchImpl?: typeof fetch): Promise<Uint8Array> {
  const f = fetchImpl ?? globalThis.fetch.bind(globalThis);
  const url = String(task.image_url || "");
  const res = await f(url, {
    headers: { Accept: "image/*,*/*;q=0.8", "User-Agent": "CubeWizard-Eval/1.0" },
  });
  if (!res.ok) throw new Error(`image_url_fetch_${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > HEDRON_MAX_IMAGE_BYTES) {
    throw new PermanentEvalError("image_url_too_large");
  }
  return buf;
}

export function resolveDeckMetadata(
  task: TaskRequest,
  metadata: StagingMetadata,
  _cubeId: string,
): {
  pilot: string;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  recordLogged: string;
  processingTs: string;
  expectedDeckSize: number;
} {
  const pilot = String(metadata.pilot_name || task.pilot_name || "Unknown").trim();
  const wins = Number(metadata.match_wins ?? task.match_wins ?? 0);
  const losses = Number(metadata.match_losses ?? task.match_losses ?? 0);
  const draws = Number(metadata.match_draws ?? task.match_draws ?? 0);
  const winRate =
    typeof metadata.win_rate === "number" ? metadata.win_rate : wins + losses > 0 ? wins / (wins + losses) : 0;
  const recordLogged = String(metadata.record_logged || task.submitted_at || new Date().toISOString());
  const processingTs = stableProcessingTimestamp(task.upload_id);
  const expectedDeckSize =
    typeof metadata.expected_deck_size === "number" && Number.isFinite(metadata.expected_deck_size)
      ? Math.floor(metadata.expected_deck_size)
      : typeof metadata.expected_count === "number" && Number.isFinite(metadata.expected_count)
        ? Math.floor(metadata.expected_count)
        : 40;
  return { pilot, wins, losses, draws, winRate, recordLogged, processingTs, expectedDeckSize };
}

export async function updateDeckAuxiliaryKeys(
  db: D1DatabaseLike,
  deckId: number,
  fields: {
    storedPath?: string;
    orientedKey?: string;
    thumbKey?: string;
    stagingKey?: string;
  },
): Promise<void> {
  const stmts: { sql: string; params: unknown[] }[] = [];
  if (fields.storedPath != null) {
    stmts.push({
      sql: "UPDATE decks SET stored_image_path = ? WHERE deck_id = ?;",
      params: [fields.storedPath, deckId],
    });
  }
  if (fields.orientedKey != null) {
    stmts.push({
      sql: "UPDATE decks SET oriented_image_r2_key = ? WHERE deck_id = ?;",
      params: [fields.orientedKey, deckId],
    });
  }
  if (fields.thumbKey != null) {
    stmts.push({
      sql: "UPDATE decks SET oriented_thumb_r2_key = ? WHERE deck_id = ?;",
      params: [fields.thumbKey, deckId],
    });
  }
  if (fields.stagingKey != null) {
    stmts.push({
      sql: "UPDATE decks SET staging_image_r2_key = ? WHERE deck_id = ?;",
      params: [fields.stagingKey, deckId],
    });
  }
  if (!stmts.length) return;
  const batcher = db as unknown as {
    batch: (statements: unknown[]) => Promise<unknown>;
    prepare: (sql: string) => { bind(...args: unknown[]): unknown };
  };
  await batcher.batch(stmts.map((s) => batcher.prepare(s.sql).bind(...s.params)));
}
