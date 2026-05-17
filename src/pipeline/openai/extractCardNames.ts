import { encodeJpeg } from "../images/encode";
import { resizeToMaxSide } from "../images/transform";
import { visionInputFromJpegBytes } from "../images/visionImageInput";
import type { VisionImagePublisher } from "../images/visionPublish";
import type { VisionImageInput } from "./responsesApi";
import type { RgbaFrame } from "../images/types";
import { EVAL_IMAGE_SIDE_UNLIMITED } from "../orchestrator/evalImageLimits";
import {
  EXTRACTION_DEVELOPER_PROMPT,
  buildCubeListDeveloperSuffix,
  buildExtractionUserPrompt,
} from "../openai/prompts";
import { cardExtractionJsonSchema } from "../openai/jsonSchemas";
import { CardExtractionResultSchema, type CardExtractionResult } from "../openai/schemas";
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
  cubeId?: string;
  fetchImpl?: typeof fetch;
  openAiLogLevel?: EvalOpenAiLogLevel;
  visionEnv: { CWW_ENV?: string };
  vision?: VisionImagePublisher;
}

function buildExtractionDeveloperPrefix(
  cubeCardList: string[] | null,
  maxCardsInPrompt: number,
  includeCubeList: boolean
): string {
  if (!includeCubeList || !cubeCardList?.length) {
    return EXTRACTION_DEVELOPER_PROMPT;
  }
  return `${EXTRACTION_DEVELOPER_PROMPT}${buildCubeListDeveloperSuffix(cubeCardList, maxCardsInPrompt)}`;
}

function buildPromptCacheKey(cubeId?: string): string | undefined {
  const id = cubeId?.trim();
  return id ? `cube:${id}` : undefined;
}

function countBelowThreshold(count: number, expected: number, ratio: number): boolean {
  return count < expected * ratio;
}

function needsSecondPass(
  pass1: CardExtractionResult,
  expected: number,
  hasCubeList: boolean
): boolean {
  const count = pass1.card_names.length;
  if (countBelowThreshold(count, expected, 0.85)) return true;
  if (pass1.confidence_level === "low" || pass1.confidence_level === "medium") return true;
  if (!hasCubeList && countBelowThreshold(count, expected, 0.85)) return true;
  return false;
}

async function extractionPass(
  imageInput: VisionImageInput,
  developerText: string,
  userText: string,
  opts: Pick<
    ExtractCardNamesOptions,
    | "apiKey"
    | "model"
    | "maxOutputTokens"
    | "reasoningEffort"
    | "fetchImpl"
    | "openAiLogLevel"
    | "cubeId"
  >,
  reasoningEffort?: "low" | "medium" | "high"
): Promise<CardExtractionResult> {
  return callOpenAiVisionJsonSchema(
    {
      apiKey: opts.apiKey,
      model: opts.model,
      maxOutputTokens: opts.maxOutputTokens,
      reasoningEffort: reasoningEffort ?? opts.reasoningEffort ?? "medium",
      developerText,
      userText,
      promptCacheKey: buildPromptCacheKey(opts.cubeId),
      ...imageInput,
      schemaName: "card_extraction",
      jsonSchema: cardExtractionJsonSchema as unknown as Record<string, unknown>,
      fetchImpl: opts.fetchImpl,
      openAiLogLevel: opts.openAiLogLevel,
    },
    CardExtractionResultSchema
  );
}

function mergeNames(into: Set<string>, names: string[]): void {
  for (const c of names) {
    const t = c.trim();
    if (t) into.add(t);
  }
}

/**
 * Card name extraction (single- or multi-pass OpenAI calls).
 */
export async function extractCardNamesFromRgba(
  frame: RgbaFrame,
  opts: ExtractCardNamesOptions
): Promise<string[]> {
  const side = opts.maxImageSide ?? EVAL_IMAGE_SIDE_UNLIMITED;
  const sized = resizeToMaxSide(frame, side, side);
  const jpegBytes = encodeJpeg(sized, opts.jpegQuality);
  const imageInput = await visionInputFromJpegBytes({
    env: opts.visionEnv,
    publisher: opts.vision,
    jpegBytes,
    purpose: "extract",
  });

  const level = opts.openAiLogLevel ?? "off";
  const mediumLog = level === "medium";
  const expected = opts.expectedDeckSize ?? 40;
  const hasCubeList = Boolean(opts.cubeCardList?.length);
  const developerWithCube = buildExtractionDeveloperPrefix(
    opts.cubeCardList,
    opts.maxCardsInPrompt,
    true
  );
  const developerRulesOnly = buildExtractionDeveloperPrefix(opts.cubeCardList, opts.maxCardsInPrompt, false);

  if (mediumLog) console.log("Pass 1: systematic extraction...");
  let pass1 = await extractionPass(
    imageInput,
    developerWithCube,
    buildExtractionUserPrompt({ pass: "initial" }),
    opts
  );

  if (pass1.confidence_level === "low") {
    if (mediumLog) console.log("Pass 1 low confidence — retrying once at high reasoning...");
    pass1 = await extractionPass(
      imageInput,
      developerWithCube,
      buildExtractionUserPrompt({ pass: "initial" }),
      opts,
      "high"
    );
  }

  const all = new Set<string>();
  mergeNames(all, pass1.card_names);

  if (!opts.useMultiPass) {
    return [...all];
  }

  const runPass2 = needsSecondPass(pass1, expected, hasCubeList);
  if (!runPass2) {
    if (mediumLog) console.log("Skipping pass 2 (count and confidence sufficient).");
    return [...all];
  }

  if (mediumLog) console.log("Pass 2: focused detection on potentially missed cards...");
  const pass2 = await extractionPass(
    imageInput,
    developerRulesOnly,
    buildExtractionUserPrompt({ pass: "second", previouslyFound: [...all] }),
    opts
  );
  mergeNames(all, pass2.card_names);

  if (
    hasCubeList &&
    opts.cubeCardList &&
    countBelowThreshold(all.size, expected, 0.9)
  ) {
    const unfound = opts.cubeCardList.filter((c) => !all.has(c));
    if (unfound.length > 0) {
      const slice = unfound.slice(0, 120);
      if (mediumLog) console.log("Pass 3: validation pass for specific missing cards...");
      const pass3 = await extractionPass(
        imageInput,
        developerRulesOnly,
        buildExtractionUserPrompt({
          pass: "validation",
          previouslyFound: [...all],
          validationCandidates: slice,
        }),
        opts
      );
      mergeNames(all, pass3.card_names);
    }
  }

  if (mediumLog) {
    console.log(`Multi-pass extraction complete: ${all.size} total cards identified`);
  }
  return [...all];
}
