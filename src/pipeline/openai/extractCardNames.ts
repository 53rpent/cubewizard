import { encodeJpeg } from "../images/encode";
import { resizeToMaxSide } from "../images/transform";
import { visionInputFromJpegBytes } from "../images/visionImageInput";
import type { VisionImagePublisher } from "../images/visionPublish";
import type { VisionImageInput } from "./responsesApi";
import type { RgbaFrame } from "../images/types";
import { EVAL_MAX_IMAGE_SIDE_DEFAULT } from "../orchestrator/evalImageLimits";
import { buildExtractionPrompt } from "../openai/prompts";
import { cardExtractionJsonSchema } from "../openai/jsonSchemas";
import { CardExtractionResultSchema } from "../openai/schemas";
import { callOpenAiVisionJsonSchema, type EvalOpenAiLogLevel } from "../openai/responsesApi";

export interface ExtractCardNamesOptions {
  maxImageSide?: number;
  apiKey: string;
  model: string;
  maxOutputTokens: number;
  reasoningEffort?: "low" | "medium" | "high";
  cubeCardList: string[] | null;
  maxCardsInPrompt: number;
  useMultiPass: boolean;
  jpegQuality: number;
  expectedDeckSize?: number;
  fetchImpl?: typeof fetch;
  openAiLogLevel?: EvalOpenAiLogLevel;
  visionEnv: { CWW_ENV?: string };
  vision?: VisionImagePublisher;
}

async function singlePass(
  imageInput: VisionImageInput,
  prompt: string,
  opts: Pick<
    ExtractCardNamesOptions,
    "apiKey" | "model" | "maxOutputTokens" | "reasoningEffort" | "fetchImpl" | "openAiLogLevel"
  >
): Promise<string[]> {
  const r = await callOpenAiVisionJsonSchema(
    {
      apiKey: opts.apiKey,
      model: opts.model,
      maxOutputTokens: opts.maxOutputTokens,
      reasoningEffort: opts.reasoningEffort ?? "medium",
      userText: prompt,
      ...imageInput,
      schemaName: "card_extraction",
      jsonSchema: cardExtractionJsonSchema as unknown as Record<string, unknown>,
      fetchImpl: opts.fetchImpl,
      openAiLogLevel: opts.openAiLogLevel,
    },
    CardExtractionResultSchema
  );
  return r.card_names.map((s) => s.trim()).filter(Boolean);
}

/**
 * Card name extraction (single- or multi-pass OpenAI calls).
 */
export async function extractCardNamesFromRgba(
  frame: RgbaFrame,
  opts: ExtractCardNamesOptions
): Promise<string[]> {
  const side = opts.maxImageSide ?? EVAL_MAX_IMAGE_SIDE_DEFAULT;
  const sized = resizeToMaxSide(frame, side, side);
  const jpegBytes = encodeJpeg(sized, opts.jpegQuality);
  const imageInput = await visionInputFromJpegBytes({
    env: opts.visionEnv,
    publisher: opts.vision,
    jpegBytes,
    purpose: "extract",
  });
  const basePrompt = buildExtractionPrompt(opts.cubeCardList, opts.maxCardsInPrompt);

  const level = opts.openAiLogLevel ?? "off";
  const gcpStyle = level === "medium";

  if (!opts.useMultiPass || !opts.cubeCardList) {
    return singlePass(imageInput, basePrompt, opts);
  }

  if (gcpStyle) console.log("Pass 1: General aggressive detection...");
  const first = await singlePass(imageInput, basePrompt, opts);
  if (first.length === 0) {
    return first;
  }

  const all = new Set(first);
  const missedPrompt = `
SECOND PASS ANALYSIS: You previously identified ${first.length} cards. Look specifically for cards you may have missed.

Previously found: ${first.join(", ")}

Now scan the image again with extreme care looking for:
1. Cards partially hidden behind others
2. Cards at the edges or corners of the image
3. Cards that are rotated or at unusual angles
4. Cards with poor lighting or shadows
5. Cards that might be face-down but have visible text on edges

Focus ONLY on cards you haven't already identified.
Return JSON via the schema with ONLY the additional card_names found in this pass (may be empty).
`.trim();

  if (gcpStyle) console.log("Pass 2: Focused detection on potentially missed cards...");
  const second = await singlePass(imageInput, missedPrompt, opts);
  for (const c of second) all.add(c);

  const expected = opts.expectedDeckSize ?? 40;
  if (all.size < expected * 0.9 && opts.cubeCardList.length > 0) {
    const unfound = opts.cubeCardList.filter((c) => !all.has(c));
    if (unfound.length > 0) {
      const slice = unfound.slice(0, 120);
      const validationPrompt = `
VALIDATION PASS: You've identified ${all.size} cards so far, but there may be more.

Already found: ${[...all].sort().join(", ")}

Look specifically for any of these remaining possibilities from the cube (only return names you can actually see):
${slice.join(", ")}

Return JSON via the schema with additional card_names only.
`.trim();
      if (gcpStyle) console.log("Pass 3: Validation pass for specific missing cards...");
      const third = await singlePass(imageInput, validationPrompt, opts);
      for (const c of third) all.add(c);
    }
  }

  if (gcpStyle) {
    console.log(`Multi-pass extraction complete: ${all.size} total cards identified`);
  }
  return [...all];
}
