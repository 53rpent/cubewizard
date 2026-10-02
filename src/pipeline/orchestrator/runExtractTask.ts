import { normalizeNamesToCubeList } from "../cards/normalizeToCubeList";
import { ExtractTaskRequestSchema } from "../contracts/extractTaskRequest.zod";
import { fetchCubeCobraMainboardNames } from "../cubecobra/fetchCubeList";
import { executeDeckWritePlan } from "../d1/executeDeckWritePlan";
import type { CardsEnrichmentBlock, DeckCardRow, DeckPayload } from "../d1/types";
import { isLocalEvalEnv } from "../evalEnv/isLocalEvalEnv";
import { createEvalUsageReporter, logEvalUsageReport, runWithEvalUsageReporter } from "../evalUsage/evalUsageReport";
import { decodeToRgba } from "../images/decode";
import type { RgbaFrame } from "../images/types";
import { assertVisionPublishConfigured, createVisionImagePublisher } from "../images/visionPublish";
import { ModelOutputInvalidError } from "../openai/chatCompletionsApi";
import { extractCardNamesFromRgba } from "../openai/extractCardNames";
import { createEvalScryfallClient } from "../scryfall/client";
import { bytesToMb, mergeActiveEvalBufferEstimates, rgbaFrameBytes } from "../util/evalMemoryProbe";
import { formatEvalError } from "../util/formatEvalError";
import { PermanentEvalError } from "./evalErrors";
import { deleteReplacedDeckRows, resolveEvalPipelineConfig, updateDeckAuxiliaryKeys } from "./evalTaskShared";
import { markJobDone } from "./processingJobRepo";
import type { RunEvalTaskEnv } from "./runEvalTask";
import { safeMarkJobFailed } from "./safeMarkJobFailed";
import { uploadOrientedThumb } from "./uploadOriented";

/**
 * Phase 2: load oriented JPEG from R2 → extract → thumb upload → release RGBA → Scryfall → D1.
 */
export async function runExtractTask(rawBody: unknown, env: RunEvalTaskEnv, fetchImpl?: typeof fetch): Promise<void> {
  const parsed = ExtractTaskRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    throw new PermanentEvalError(`invalid_extract_task: ${parsed.error.message}`);
  }
  const task = parsed.data;

  const cfg = resolveEvalPipelineConfig(env);
  const localVision = isLocalEvalEnv(env);
  if (!localVision) assertVisionPublishConfigured(env);
  const vision = localVision
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
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: extract phase loads image, vision, Scryfall, and D1 writes
    await runWithEvalUsageReporter(usageReporter, async () => {
      const imgObj = await env.DECK_IMAGES_BLOB.get(task.oriented_image_r2_key);
      if (!imgObj) {
        throw new PermanentEvalError("oriented_image_missing");
      }
      const orientedJpeg = new Uint8Array(await imgObj.arrayBuffer());

      const orientedRgba: RgbaFrame = await decodeToRgba(orientedJpeg, "jpeg");

      mergeActiveEvalBufferEstimates({
        est_oriented_jpeg_mb: bytesToMb(orientedJpeg.byteLength),
        est_rgba_mb: bytesToMb(rgbaFrameBytes(orientedRgba)),
        oriented_w: orientedRgba.width,
        oriented_h: orientedRgba.height,
      });

      const cubeList = await fetchCubeCobraMainboardNames(task.cube_id, {
        fetchImpl,
        maxCards: cfg.maxCubeCards,
      });

      let cardNames = await extractCardNamesFromRgba(orientedRgba, {
        apiKey: cfg.visionApiKey,
        model: cfg.visionModel,
        maxOutputTokens: cfg.maxOut,
        reasoningEffort: cfg.reasoning,
        cubeCardList: cubeList,
        maxCardsInPrompt: cfg.maxCubeCards,
        useMultiPass: cfg.useMultiPass,
        jpegQuality: cfg.jpegQ,
        maxImageSide: cfg.maxImageSide,
        expectedDeckSize: task.expected_deck_size ?? 40,
        cubeId: task.cube_id,
        visionEnv: env,
        vision,
        fetchImpl,
        openAiLogLevel: cfg.openAiLogLevel,
        baseUrl: cfg.visionBaseUrl,
        gatewayToken: cfg.openAiGatewayToken,
        aiGatewayId: cfg.aiGatewayId,
        requestTimeoutMs: cfg.openAiRequestTimeoutMs,
      });

      if (cubeList.length) {
        cardNames = normalizeNamesToCubeList(cardNames, cubeList);
      }
      if (!cardNames.length) {
        throw new PermanentEvalError("no_cards_extracted");
      }

      usageReporter.setExtractedCardNames(cardNames);

      const thumb = await uploadOrientedThumb({
        blob: env.DECK_IMAGES_BLOB,
        cubeId: task.cube_id,
        imageId: task.image_id,
        orientedRgba,
      });

      const scryfall = createEvalScryfallClient({ fetchImpl });
      const enriched = await scryfall.enrichCardList(cardNames);

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
            pilot_name: task.pilot_name,
            match_wins: task.match_wins ?? 0,
            match_losses: task.match_losses ?? 0,
            match_draws: task.match_draws ?? 0,
            record_logged: task.record_logged,
            win_rate: task.win_rate ?? 0,
            image_source: task.image_source ?? "",
            processing_timestamp: task.processing_timestamp,
            total_cards: cardNames.length,
            owner_user_id: task.owner_user_id ?? null,
          },
          cards: cardsBlock,
        },
      };

      const write = await executeDeckWritePlan(env.cubewizard_db, task.cube_id, deckPayload);
      if (!write.success) {
        throw new PermanentEvalError("d1_deck_write_failed");
      }

      const evalReport = usageReporter.finish(Date.now() - evalStarted);
      logEvalUsageReport(evalReport);

      if (write.duplicate || write.deckId == null) {
        if (write.deckId != null && task.replace_deck_id != null && task.replace_deck_id !== write.deckId) {
          await updateDeckAuxiliaryKeys(env.cubewizard_db, write.deckId, {
            storedPath: `stored_images/${task.image_id}.jpg`,
            orientedKey: task.oriented_image_r2_key,
            thumbKey: thumb.thumbKey,
            stagingKey: task.staging_image_r2_key,
          });
          await deleteReplacedDeckRows(env.cubewizard_db, task.replace_deck_id, task.cube_id);
        }
        await markJobDone(
          env.cubewizard_db,
          task.upload_id,
          JSON.stringify({
            duplicate: true,
            image_id: write.imageId,
            eval_report: evalReport,
          }),
        );
        return;
      }

      const storedPath = `stored_images/${task.image_id}.jpg`;
      await updateDeckAuxiliaryKeys(env.cubewizard_db, write.deckId, {
        storedPath,
        orientedKey: task.oriented_image_r2_key,
        thumbKey: thumb.thumbKey,
        stagingKey: task.staging_image_r2_key,
      });
      if (task.replace_deck_id != null && task.replace_deck_id !== write.deckId) {
        await deleteReplacedDeckRows(env.cubewizard_db, task.replace_deck_id, task.cube_id);
      }

      await markJobDone(
        env.cubewizard_db,
        task.upload_id,
        JSON.stringify({
          duplicate: false,
          deck_id: write.deckId,
          image_id: task.image_id,
          oriented_image_r2_key: task.oriented_image_r2_key,
          oriented_thumb_r2_key: thumb.thumbKey,
          eval_report: evalReport,
        }),
      );
    });
  } catch (e) {
    if (e instanceof ModelOutputInvalidError || e instanceof PermanentEvalError) {
      await safeMarkJobFailed(env.cubewizard_db, task.upload_id, formatEvalError(e));
    }
    throw e;
  }
}
