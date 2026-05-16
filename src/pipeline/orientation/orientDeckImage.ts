import { encodeJpeg } from "../images/encode";
import { decodeToRgba } from "../images/decode";
import { resizeToMaxSide, rotateClockwise } from "../images/transform";
import type { ImageFormatHint, RgbaFrame } from "../images/types";
import { sniffImageFormat } from "../images/sniff";
import { ORIENTATION_PROMPT } from "../openai/prompts";
import { orientationJsonSchema } from "../openai/jsonSchemas";
import { OrientationResultSchema } from "../openai/schemas";
import { callOpenAiVisionJsonSchema, type EvalOpenAiLogLevel } from "../openai/responsesApi";

function rgbaToJpegBase64(frame: Parameters<typeof encodeJpeg>[0], quality: number): string {
  const jpegBytes = encodeJpeg(frame, quality);
  let bin = "";
  for (let i = 0; i < jpegBytes.length; i++) {
    bin += String.fromCharCode(jpegBytes[i]!);
  }
  return btoa(bin);
}

export interface OrientDeckImageOptions {
  apiKey: string;
  model: string;
  maxOutputTokens?: number;
  reasoningEffort?: "low" | "medium" | "high";
  jpegQuality?: number;
  maxImageWidth?: number;
  maxImageHeight?: number;
  fetchImpl?: typeof fetch;
  openAiLogLevel?: EvalOpenAiLogLevel;
}

/**
 * Iteratively detect orientation and rotate in-memory until model returns 0°,
 * OpenAI vision orientation pass before card-name extraction.
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
  const mw = opts.maxImageWidth ?? 4000;
  const mh = opts.maxImageHeight ?? 4000;
  frame = resizeToMaxSide(frame, mw, mh);

  const maxTok = opts.maxOutputTokens ?? 2000;
  const q = opts.jpegQuality ?? 95;

  // Mirror Python loop: repeatedly detect rotation on current sample and rotate until 0.
  for (let guard = 0; guard < 8; guard++) {
    const b64 = rgbaToJpegBase64(frame, q);
    const result = await callOpenAiVisionJsonSchema(
      {
        apiKey: opts.apiKey,
        model: opts.model,
        maxOutputTokens: maxTok,
        reasoningEffort: opts.reasoningEffort ?? "medium",
        userText: ORIENTATION_PROMPT,
        imageBase64: b64,
        imageMime: "image/jpeg",
        schemaName: "orientation_result",
        jsonSchema: orientationJsonSchema as unknown as Record<string, unknown>,
        fetchImpl: opts.fetchImpl,
        openAiLogLevel: opts.openAiLogLevel,
      },
      OrientationResultSchema
    );

    const rot = result.rotation_needed;
    if (rot === 0) break;
    frame = rotateClockwise(frame, rot);
  }

  return { frame, sniffed: fmt };
}
