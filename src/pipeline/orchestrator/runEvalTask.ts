import { TaskRequestSchema, type TaskRequest } from "../contracts/taskRequest.zod";
import { createEvalScryfallClient } from "../scryfall/client";
import type { CardsEnrichmentBlock, DeckCardRow, DeckPayload } from "../d1/types";
import { executeDeckWritePlan } from "../d1/executeDeckWritePlan";
import { fetchCubeCobraMainboardNames } from "../cubecobra/fetchCubeList";
import { orientDeckImageRgba } from "../orientation/orientDeckImage";
import { extractCardNamesFromRgba } from "../openai/extractCardNames";
import { ModelOutputInvalidError, parseEvalOpenAiLogLevel } from "../openai/responsesApi";
import {
  markJobDone,
  markJobFailed,
  markJobRunning,
  upsertQueuedProcessingJob,
  type D1DatabaseLike,
} from "./processingJobRepo";
import { uploadOrientedImageAndThumb } from "./uploadOriented";
import { resolveOpenAiApiKey } from "../config/resolveOpenAiApiKey";
import { parseEvalMaxImageSide, parseEvalOrientMaxSide } from "./evalImageLimits";
import { isLocalEvalEnv } from "../evalEnv/isLocalEvalEnv";
import {
  assertVisionPublishConfigured,
  createVisionImagePublisher,
  type VisionImagePublisher,
} from "../images/visionPublish";
import { PermanentEvalError } from "./evalErrors";
import { safeMarkJobFailed } from "./safeMarkJobFailed";
import { formatEvalError } from "../util/formatEvalError";
import {
  createEvalUsageReporter,
  logEvalUsageReport,
  runWithEvalUsageReporter,
  type EvalRunReport,
} from "../evalUsage/evalUsageReport";

export { PermanentEvalError } from "./evalErrors";

const HEDRON_MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export interface R2BucketGetPut {
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  put(
    key: string,
    value: Uint8Array | ReadableStream,
    options?: { httpMetadata?: { contentType?: string } }
  ): Promise<void>;
}

export interface RunEvalTaskEnv {
  /** `local` in default wrangler eval config; `staging` / `production` in hosted envs. */
  CWW_ENV?: string;
  /** Set via `.dev.vars` locally or `wrangler secret put OPENAI_API_KEY` when deployed. */
  OPENAI_API_KEY?: string;
  OPENAI_VISION_MODEL?: string;
  OPENAI_MAX_OUTPUT_TOKENS?: string;
  OPENAI_REASONING_EFFORT?: string;
  CW_EVAL_MAX_CUBECOBRA_CARDS?: string;
  CW_EVAL_USE_MULTI_PASS?: string;
  CW_EVAL_JPEG_QUALITY?: string;
  /** `off` | `low` | `medium` | `high` — OpenAI eval consumer logging (see docs). */
  CW_EVAL_LOG_LEVEL?: string;
  /** Legacy: `1` / `true` / `yes` → same as `CW_EVAL_LOG_LEVEL=high` when that var is unset/invalid. */
  CW_EVAL_VERBOSE_LOG?: string;
  /** Expected queue `max_concurrency` (Scryfall throttle; default 1 — shares 128 MiB isolate). */
  CW_EVAL_MAX_CONSUMERS?: string;
  /** Match queue `max_retries` in wrangler (default 5). */
  CW_EVAL_MAX_RETRIES?: string;
  /** Max decoded image width/height in px (default 2048; keeps RGBA under Workers memory cap). */
  CW_EVAL_MAX_IMAGE_SIDE?: string;
  /** Max side for orientation OpenAI previews only (default 1280; extraction uses full side). */
  CW_EVAL_ORIENT_MAX_SIDE?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  CW_EVAL_VISION_R2_BUCKET?: string;
  cubewizard_db: D1DatabaseLike;
  BUCKET: R2BucketGetPut;
  DECK_IMAGES_BLOB: R2BucketGetPut;
}

interface StagingMetadata {
  cube_id?: string;
  pilot_name?: string;
  match_wins?: number;
  match_losses?: number;
  match_draws?: number;
  win_rate?: number;
  record_logged?: string;
  image_key?: string;
  original_filename?: string;
}

function processingTimestampTag(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

async function ensureQueuedProcessingJob(db: D1DatabaseLike, task: TaskRequest): Promise<void> {
  const row = await db
    .prepare("SELECT id FROM processing_jobs WHERE upload_id = ? LIMIT 1")
    .bind(task.upload_id)
    .first();
  if (row) return;
  await upsertQueuedProcessingJob(db, task);
}

async function readStagingPackage(
  task: TaskRequest,
  bucket: R2BucketGetPut
): Promise<{ imageBytes: Uint8Array; metadata: StagingMetadata }> {
  const prefix = String(task.r2_prefix || "").replace(/\/?$/, "/");
  const metaKey = prefix + "metadata.json";
  const metaObj = await bucket.get(metaKey);
  if (!metaObj) throw new PermanentEvalError("staging_metadata_missing");
  const metadata = JSON.parse(
    new TextDecoder().decode(await metaObj.arrayBuffer())
  ) as StagingMetadata;
  const imageKey = metadata.image_key;
  if (!imageKey || typeof imageKey !== "string") {
    throw new PermanentEvalError("staging_metadata_missing_image_key");
  }
  const imgObj = await bucket.get(imageKey);
  if (!imgObj) throw new PermanentEvalError("staging_image_missing");
  const imageBytes = new Uint8Array(await imgObj.arrayBuffer());
  return { imageBytes, metadata };
}

async function readImageFromUrl(task: TaskRequest, fetchImpl?: typeof fetch): Promise<Uint8Array> {
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

async function updateDeckAuxiliaryKeys(
  db: D1DatabaseLike,
  deckId: number,
  fields: {
    storedPath?: string;
    orientedKey?: string;
    thumbKey?: string;
    stagingKey?: string;
  }
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

/**
 * End-to-end eval for one task: image → orientation → OpenAI extraction → Scryfall → D1 → oriented R2 uploads.
 */
export async function runEvalTask(
  rawBody: unknown,
  env: RunEvalTaskEnv,
  fetchImpl?: typeof fetch
): Promise<void> {
  const parsed = TaskRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    throw new PermanentEvalError(`invalid_task_request: ${parsed.error.message}`);
  }
  const task = parsed.data;

  const cubeId = (task.cube_id || "").trim();
  if (!cubeId) {
    throw new PermanentEvalError("cube_id_required");
  }

  const apiKey = resolveOpenAiApiKey(env);

  const model = String(env.OPENAI_VISION_MODEL || "gpt-5-mini-2025-08-07").trim();
  const maxOut = Math.min(
    32000,
    Math.max(1000, parseInt(String(env.OPENAI_MAX_OUTPUT_TOKENS || "20000"), 10) || 20000)
  );
  const reasoning = (String(env.OPENAI_REASONING_EFFORT || "medium").trim() ||
    "medium") as "low" | "medium" | "high";
  const maxCubeCards =
    Math.min(2000, parseInt(String(env.CW_EVAL_MAX_CUBECOBRA_CARDS || "1000"), 10) || 1000);
  const useMultiPass = !/^0|false|no$/i.test(String(env.CW_EVAL_USE_MULTI_PASS || "true"));
  const jpegQ = Math.min(100, Math.max(60, parseInt(String(env.CW_EVAL_JPEG_QUALITY || "95"), 10) || 95));

  const openAiLogLevel = parseEvalOpenAiLogLevel(env);
  const maxImageSide = parseEvalMaxImageSide(env.CW_EVAL_MAX_IMAGE_SIDE);
  const orientMaxSide = parseEvalOrientMaxSide(env.CW_EVAL_ORIENT_MAX_SIDE);
  const localVision = isLocalEvalEnv(env);
  if (!localVision) assertVisionPublishConfigured(env);
  const vision: VisionImagePublisher | undefined = localVision
    ? undefined
    : createVisionImagePublisher({
        uploadId: task.upload_id,
        blob: env.DECK_IMAGES_BLOB,
        env,
        fetchImpl,
      });

  const evalStarted = Date.now();
  const usageReporter = createEvalUsageReporter(task.upload_id);

  try {
    await runWithEvalUsageReporter(usageReporter, async () => {
    await ensureQueuedProcessingJob(env.cubewizard_db, task);

    let imageBytes: Uint8Array;
    let metadata: StagingMetadata;

    if (task.image_url) {
      imageBytes = await readImageFromUrl(task, fetchImpl);
      metadata = {
        cube_id: cubeId,
        pilot_name: task.pilot_name,
        match_wins: task.match_wins ?? 0,
        match_losses: task.match_losses ?? 0,
        match_draws: task.match_draws ?? 0,
        win_rate:
          (task.match_wins ?? 0) + (task.match_losses ?? 0) > 0
            ? (task.match_wins ?? 0) / ((task.match_wins ?? 0) + (task.match_losses ?? 0))
            : 0,
        record_logged: task.submitted_at || new Date().toISOString(),
      };
    } else {
      const pack = await readStagingPackage(task, env.BUCKET);
      imageBytes = pack.imageBytes;
      metadata = pack.metadata;
    }

    await markJobRunning(env.cubewizard_db, task.upload_id);

    const pilot = String(metadata.pilot_name || task.pilot_name || "Unknown").trim();
    const wins = Number(metadata.match_wins ?? task.match_wins ?? 0);
    const losses = Number(metadata.match_losses ?? task.match_losses ?? 0);
    const draws = Number(metadata.match_draws ?? task.match_draws ?? 0);
    const winRate =
      typeof metadata.win_rate === "number"
        ? metadata.win_rate
        : wins + losses > 0
          ? wins / (wins + losses)
          : 0;
    const recordLogged = String(
      metadata.record_logged || task.submitted_at || new Date().toISOString()
    );
    // Stable across Cloudflare Queue retries: a fresh wall-clock tag each attempt changes
    // `image_id`, defeats INSERT OR IGNORE on `decks.image_id`, duplicates rows, and leaves
    // the message retrying (e.g. WASM/OpenAI flakes before thumb upload).
    const processingTs =
      String(task.upload_id || "").trim() || processingTimestampTag();

    const cubeList = await fetchCubeCobraMainboardNames(cubeId, {
      fetchImpl,
      maxCards: maxCubeCards,
    });

    console.log("eval_phase orient_start", {
      upload_id: task.upload_id,
      cube_id: cubeId,
      vision_mode: localVision ? "inline" : "presigned",
    });
    const { frame: orientedRgba } = await orientDeckImageRgba(imageBytes, undefined, {
      apiKey,
      model,
      maxOutputTokens: 2000,
      reasoningEffort: "medium",
      jpegQuality: jpegQ,
      maxImageWidth: maxImageSide,
      maxImageHeight: maxImageSide,
      orientMaxSide,
      visionEnv: env,
      vision,
      fetchImpl,
      openAiLogLevel,
    });
    imageBytes = new Uint8Array(0);

    console.log("eval_phase orient_done", { upload_id: task.upload_id });
    const cardNames = await extractCardNamesFromRgba(orientedRgba, {
      apiKey,
      model,
      maxOutputTokens: maxOut,
      reasoningEffort: reasoning,
      cubeCardList: cubeList,
      maxCardsInPrompt: maxCubeCards,
      useMultiPass: useMultiPass,
      jpegQuality: jpegQ,
      maxImageSide,
      visionEnv: env,
      vision,
      fetchImpl,
      openAiLogLevel,
    });

    if (!cardNames.length) {
      throw new PermanentEvalError("no_cards_extracted");
    }

    usageReporter.setExtractedCardNames(cardNames);

    console.log("eval_phase extract_done", {
      upload_id: task.upload_id,
      card_count: cardNames.length,
    });
    const scryfall = createEvalScryfallClient({ fetchImpl });
    const enriched = await scryfall.enrichCardList(cardNames);
    console.log("eval_scryfall_enrichment", {
      upload_id: task.upload_id,
      total_requested: enriched.total_requested,
      total_found: enriched.total_found,
      not_found_count: enriched.not_found.length,
    });

    const cardsBlock: CardsEnrichmentBlock = {
      cards: enriched.cards as DeckCardRow[],
      total_requested: enriched.total_requested,
      total_found: enriched.total_found,
      not_found: enriched.not_found,
      success_rate: enriched.success_rate,
    };

    const deckPayload: DeckPayload = {
      deck: {
        metadata: {
          pilot_name: pilot,
          match_wins: wins,
          match_losses: losses,
          match_draws: draws,
          record_logged: recordLogged,
          win_rate: winRate,
          image_source: task.image_url || metadata.image_key || "",
          processing_timestamp: processingTs,
          total_cards: cardNames.length,
        },
        cards: cardsBlock,
      },
    };

    console.log("eval_phase scryfall_done", {
      upload_id: task.upload_id,
      total_found: enriched.total_found,
    });
    const write = await executeDeckWritePlan(env.cubewizard_db, cubeId, deckPayload);
    if (!write.success) {
      throw new PermanentEvalError("d1_deck_write_failed");
    }
    const evalReport = usageReporter.finish(Date.now() - evalStarted);
    logEvalUsageReport(evalReport);

    if (write.duplicate || write.deckId == null) {
      await markJobDone(
        env.cubewizard_db,
        task.upload_id,
        JSON.stringify({
          duplicate: true,
          image_id: write.imageId,
          eval_report: evalReport,
        })
      );
      return;
    }

    const deckId = write.deckId;
    const imageId = write.imageId;

    console.log("eval_phase d1_done", { upload_id: task.upload_id, deck_id: deckId });
    const uploaded = await uploadOrientedImageAndThumb({
      blob: env.DECK_IMAGES_BLOB,
      cubeId,
      imageId,
      orientedRgba,
    });

    await updateDeckAuxiliaryKeys(env.cubewizard_db, deckId, {
      storedPath: uploaded.storedImagePath,
      orientedKey: uploaded.orientedKey,
      thumbKey: uploaded.thumbKey,
      stagingKey: metadata.image_key,
    });

    console.log("eval_phase upload_done", {
      upload_id: task.upload_id,
      oriented_key: uploaded.orientedKey,
    });
    await markJobDone(
      env.cubewizard_db,
      task.upload_id,
      JSON.stringify({
        duplicate: false,
        deck_id: deckId,
        image_id: imageId,
        oriented_image_r2_key: uploaded.orientedKey,
        oriented_thumb_r2_key: uploaded.thumbKey,
        eval_report: evalReport,
      })
    );
    console.log("eval_phase complete", { upload_id: task.upload_id });
    });
  } catch (e) {
    if (e instanceof ModelOutputInvalidError || e instanceof PermanentEvalError) {
      await safeMarkJobFailed(env.cubewizard_db, task.upload_id, formatEvalError(e));
    }
    throw e;
  }
}
