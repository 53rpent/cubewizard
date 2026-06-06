import { decodeToRgba } from "../images/decode";
import { encodeJpeg } from "../images/encode";
import { sniffImageFormat } from "../images/sniff";
import { cropCenter, resizeToMaxSide, rotateClockwise } from "../images/transform";
import type { ImageFormatHint, RgbaFrame } from "../images/types";
import { visionInputFromJpegBytes } from "../images/visionImageInput";
import type { VisionImagePublisher } from "../images/visionPublish";
import { callOpenAiVisionJsonSchema, type EvalOpenAiLogLevel } from "../openai/chatCompletionsApi";
import { orientationConfirmJsonSchema } from "../openai/jsonSchemas";
import { ORIENTATION_CONFIRM_DEVELOPER_PROMPT, ORIENTATION_CONFIRM_USER_PROMPT } from "../openai/prompts";
import { OrientationConfirmResultSchema } from "../openai/schemas";
import { EVAL_IMAGE_SIDE_UNLIMITED } from "../orchestrator/evalImageLimits";
import { isEvalConsumerLogActive } from "../util/evalConsumerLog";
import { bytesToMb, mergeActiveEvalBufferEstimates, rgbaFrameBytes } from "../util/evalMemoryProbe";
import {
  appendRotationScores,
  bestRotationFromHistory,
  bestRotationFromRound,
  emptyRotationScoreHistory,
  type OrientLightExtractOptions,
  type RotationCandidate,
  scoreAllRotationCandidates,
} from "./orientExtractVerify";

export const ORIENT_DEFAULT_MAX_OUTPUT_TOKENS = 1024;
export const ORIENT_CENTER_CROP_FRACTION = 0.65;

export interface OrientDeckImageOptions {
  apiKey: string;
  model: string;
  maxOutputTokens?: number;
  reasoningEffort?: "low" | "medium" | "high";
  promptCacheKey?: string;
  orientCenterCropFraction?: number;
  jpegQuality?: number;
  maxImageSide?: number;
  visionEnv: { CWW_ENV?: string };
  vision?: VisionImagePublisher;
  baseUrl?: string;
  gatewayToken?: string;
  aiGatewayId?: string;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  openAiLogLevel?: EvalOpenAiLogLevel;
  /** Required: used to score each 90° rotation before a yes/no confirm call. */
  orientLightExtract: OrientLightExtractOptions;
  /** Called once staging JPEG/PNG bytes are decoded; drop the source buffer reference here. */
  onStagingBytesDecoded?: () => void;
}

function maybeResize(frame: RgbaFrame, maxSide: number): RgbaFrame {
  if (maxSide <= 0) return frame;
  return resizeToMaxSide(frame, maxSide, maxSide);
}

async function confirmOrientation(
  frame: RgbaFrame,
  opts: OrientDeckImageOptions,
  _rotation: RotationCandidate,
  confirmStep: number,
): Promise<boolean> {
  const cropFraction = opts.orientCenterCropFraction ?? ORIENT_CENTER_CROP_FRACTION;
  const crop = cropCenter(frame, cropFraction);
  const jpegBytes = encodeJpeg(crop, opts.jpegQuality ?? 100);
  const imageInput = await visionInputFromJpegBytes({
    env: opts.visionEnv,
    publisher: opts.vision,
    jpegBytes,
    purpose: "orient",
    step: confirmStep,
  });

  const result = await callOpenAiVisionJsonSchema(
    {
      apiKey: opts.apiKey,
      model: opts.model,
      maxOutputTokens: opts.maxOutputTokens ?? ORIENT_DEFAULT_MAX_OUTPUT_TOKENS,
      reasoningEffort: opts.reasoningEffort ?? "low",
      developerText: ORIENTATION_CONFIRM_DEVELOPER_PROMPT,
      userText: ORIENTATION_CONFIRM_USER_PROMPT,
      promptCacheKey: opts.promptCacheKey,
      ...imageInput,
      schemaName: "orientation_confirm",
      jsonSchema: orientationConfirmJsonSchema as unknown as Record<string, unknown>,
      baseUrl: opts.baseUrl,
      gatewayToken: opts.gatewayToken,
      aiGatewayId: opts.aiGatewayId,
      requestTimeoutMs: opts.requestTimeoutMs,
      fetchImpl: opts.fetchImpl,
      openAiLogLevel: opts.openAiLogLevel,
    },
    OrientationConfirmResultSchema,
  );
  return result.correctly_oriented;
}

function logRoundScores(
  level: EvalOpenAiLogLevel,
  roundIndex: number,
  round: Record<RotationCandidate, { score: number; raw_name_count: number }>,
): void {
  if (level !== "medium") return;
  const parts = ([0, 90, 180, 270] as const).map((r) => `${r}°=${round[r].score} (${round[r].raw_name_count} names)`);
  console.log(`Orient score round ${roundIndex + 1}: ${parts.join(", ")}`);
}

/**
 * 1) Initial yes/no confirm on the upload (0 light extracts if already upright).
 * 2) Score each 90° rotation (light extract). 3) Confirm best with yes/no.
 * If no, score all four again; final rotation = peak score across both rounds.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: multi-round rotation scoring with confirm and extract probes
export async function orientDeckImageRgba(
  imageBytes: Uint8Array,
  hint: ImageFormatHint | undefined,
  opts: OrientDeckImageOptions,
): Promise<{ frame: RgbaFrame; sniffed: ImageFormatHint; cumulativeRotation: number }> {
  const fmt = hint && hint !== "unknown" ? hint : sniffImageFormat(imageBytes);
  if (fmt === "unknown") {
    throw new Error("orient_deck_image_unknown_format");
  }

  const level = opts.openAiLogLevel ?? "off";
  const light = opts.orientLightExtract;
  const maxSide = opts.maxImageSide ?? EVAL_IMAGE_SIDE_UNLIMITED;
  const baseFrame = maybeResize(await decodeToRgba(imageBytes, fmt), maxSide);
  opts.onStagingBytesDecoded?.();
  if (isEvalConsumerLogActive()) {
    mergeActiveEvalBufferEstimates({
      est_rgba_mb: bytesToMb(rgbaFrameBytes(baseFrame)),
      oriented_w: baseFrame.width,
      oriented_h: baseFrame.height,
    });
  }
  const history = emptyRotationScoreHistory();

  if (level === "medium") {
    console.log("Orientation: initial confirm on upload (0°)…");
  }
  const alreadyUpright = await confirmOrientation(baseFrame, opts, 0, 0);
  if (alreadyUpright) {
    if (level === "medium") console.log("Orient initial confirm: yes — skipping rotation scoring");
    return { frame: baseFrame, sniffed: fmt, cumulativeRotation: 0 };
  }
  if (level === "medium") {
    console.log("Orient initial confirm: no — scoring 0°/90°/180°/270° via light extract…");
  }

  const round1 = await scoreAllRotationCandidates(baseFrame, light, 0);
  appendRotationScores(history, round1);
  logRoundScores(level, 0, round1);

  const { rotation: candidateRot, bestScore } = bestRotationFromRound(round1);
  const candidateFrame = candidateRot === 0 ? baseFrame : rotateClockwise(baseFrame, candidateRot);

  if (level === "medium") {
    console.log(`Orient round 1 best: ${candidateRot}° (score ${bestScore}) — confirm upright?`);
  }

  const confirmed = await confirmOrientation(candidateFrame, opts, candidateRot, 50);
  if (confirmed) {
    if (level === "medium") console.log(`Orient confirm: yes @ ${candidateRot}°`);
    const frame = candidateRot === 0 ? baseFrame : rotateClockwise(baseFrame, candidateRot);
    return { frame, sniffed: fmt, cumulativeRotation: candidateRot };
  }

  if (level === "medium") {
    console.log(`Orient confirm: no @ ${candidateRot}° — second 90° scoring round…`);
  }

  const round2 = await scoreAllRotationCandidates(baseFrame, light, 1);
  appendRotationScores(history, round2);
  logRoundScores(level, 1, round2);

  const final = bestRotationFromHistory(history);
  if (level === "medium") {
    console.log(`Orient final: ${final.rotation}° (peak score ${final.bestScore} across 2 rounds per angle)`);
  }

  const frame = final.rotation === 0 ? baseFrame : rotateClockwise(baseFrame, final.rotation);
  return { frame, sniffed: fmt, cumulativeRotation: final.rotation };
}
