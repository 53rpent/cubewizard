import { decodeToRgba } from "../images/decode";
import { encodeJpeg } from "../images/encode";
import { visionInputFromJpegBytes } from "../images/visionImageInput";
import type { VisionImagePublisher } from "../images/visionPublish";
import {
  EVAL_MAX_IMAGE_SIDE_DEFAULT,
  EVAL_ORIENT_MAX_SIDE_DEFAULT,
} from "../orchestrator/evalImageLimits";
import {
  combineClockwiseRotations,
  resizeToMaxSide,
  rotateClockwise,
} from "../images/transform";
import type { ImageFormatHint, RgbaFrame } from "../images/types";
import { sniffImageFormat } from "../images/sniff";
import { ORIENTATION_PROMPT } from "../openai/prompts";
import { orientationJsonSchema } from "../openai/jsonSchemas";
import { OrientationResultSchema } from "../openai/schemas";
import { callOpenAiVisionJsonSchema, type EvalOpenAiLogLevel } from "../openai/responsesApi";

export interface OrientDeckImageOptions {
  apiKey: string;
  model: string;
  maxOutputTokens?: number;
  reasoningEffort?: "low" | "medium" | "high";
  jpegQuality?: number;
  maxImageWidth?: number;
  maxImageHeight?: number;
  orientMaxSide?: number;
  visionEnv: { CWW_ENV?: string };
  vision?: VisionImagePublisher;
  fetchImpl?: typeof fetch;
  openAiLogLevel?: EvalOpenAiLogLevel;
}

/**
 * Iteratively detect orientation and rotate until the model returns 0°.
 * Hosted: each OpenAI call uses a fresh R2 JPEG + HTTPS URL. Local: inline base64 per step.
 */
export async function orientDeckImageRgba(
  imageBytes: Uint8Array,
  hint: ImageFormatHint | undefined,
  opts: OrientDeckImageOptions
): Promise<{ frame: RgbaFrame; sniffed: ImageFormatHint }> {
  const fmt = hint && hint !== "unknown" ? hint : sniffImageFormat(imageBytes);
  if (fmt === "unknown") {
    throw new Error("orient_deck_image_unknown_format");
  }

  const level = opts.openAiLogLevel ?? "off";
  if (level === "medium") {
    console.log("Step 1: Checking image orientation...");
  }

  let frame = await decodeToRgba(imageBytes, fmt);
  const mw = opts.maxImageWidth ?? EVAL_MAX_IMAGE_SIDE_DEFAULT;
  const mh = opts.maxImageHeight ?? EVAL_MAX_IMAGE_SIDE_DEFAULT;
  frame = resizeToMaxSide(frame, mw, mh);

  const orientSide = opts.orientMaxSide ?? EVAL_ORIENT_MAX_SIDE_DEFAULT;
  const previewIsFull =
    frame.width <= orientSide && frame.height <= orientSide;
  let preview = previewIsFull
    ? frame
    : resizeToMaxSide(frame, orientSide, orientSide);

  const maxTok = opts.maxOutputTokens ?? 2000;
  const q = opts.jpegQuality ?? 95;
  let cumulativeRotation = 0;

  for (let guard = 0; guard < 8; guard++) {
    const jpegBytes = encodeJpeg(preview, q);
    const imageInput = await visionInputFromJpegBytes({
      env: opts.visionEnv,
      publisher: opts.vision,
      jpegBytes,
      purpose: "orient",
      step: guard,
    });
    const result = await callOpenAiVisionJsonSchema(
      {
        apiKey: opts.apiKey,
        model: opts.model,
        maxOutputTokens: maxTok,
        reasoningEffort: opts.reasoningEffort ?? "medium",
        userText: ORIENTATION_PROMPT,
        ...imageInput,
        schemaName: "orientation_result",
        jsonSchema: orientationJsonSchema as unknown as Record<string, unknown>,
        fetchImpl: opts.fetchImpl,
        openAiLogLevel: opts.openAiLogLevel,
      },
      OrientationResultSchema
    );

    const rot = result.rotation_needed;
    if (rot === 0) break;
    cumulativeRotation = combineClockwiseRotations(cumulativeRotation, rot);
    preview = rotateClockwise(preview, rot);
  }

  if (cumulativeRotation !== 0 && !previewIsFull) {
    frame = rotateClockwise(frame, cumulativeRotation);
  } else if (previewIsFull) {
    frame = preview;
  }

  return { frame, sniffed: fmt };
}
