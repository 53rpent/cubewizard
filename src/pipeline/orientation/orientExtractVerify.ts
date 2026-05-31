import { normalizeNamesToCubeList } from "../cards/normalizeToCubeList";
import { encodeJpeg } from "../images/encode";
import { resizeToMaxSide, rotateClockwise } from "../images/transform";
import type { RgbaFrame } from "../images/types";
import { visionInputFromJpegBytes } from "../images/visionImageInput";
import type { VisionImagePublisher } from "../images/visionPublish";
import { cardExtractionJsonSchema } from "../openai/jsonSchemas";
import { buildExtractionUserPrompt, EXTRACTION_DEVELOPER_PROMPT } from "../openai/prompts";
import { callOpenAiVisionJsonSchema, type EvalOpenAiLogLevel } from "../openai/chatCompletionsApi";
import { type CardExtractionResult, CardExtractionResultSchema } from "../openai/schemas";
import { EVAL_IMAGE_SIDE_UNLIMITED } from "../orchestrator/evalImageLimits";

const LIGHT_EXTRACT_MAX_OUTPUT = 4096;

export const ROTATION_CANDIDATES = [0, 90, 180, 270] as const;
export type RotationCandidate = (typeof ROTATION_CANDIDATES)[number];

export interface OrientLightExtractScore {
  score: number;
  raw_name_count: number;
  cube_matched_count: number;
  confidence_level: CardExtractionResult["confidence_level"];
}

export type RotationScoreHistory = Record<RotationCandidate, OrientLightExtractScore[]>;

export interface OrientLightExtractOptions {
  apiKey: string;
  model: string;
  cubeCardList: string[] | null;
  expectedDeckSize: number;
  maxImageSide?: number;
  jpegQuality: number;
  cubeId?: string;
  visionEnv: { CWW_ENV?: string };
  vision?: VisionImagePublisher;
  baseUrl?: string;
  gatewayToken?: string;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  openAiLogLevel?: EvalOpenAiLogLevel;
}

export function emptyRotationScoreHistory(): RotationScoreHistory {
  return { 0: [], 90: [], 180: [], 270: [] };
}

export function scoreLightExtractionResult(
  result: CardExtractionResult,
  cubeCardList: string[] | null,
): OrientLightExtractScore {
  const raw = result.card_names.map((s) => s.trim()).filter(Boolean);
  const cubeMatched = cubeCardList?.length ? normalizeNamesToCubeList(raw, cubeCardList) : raw;
  let score = cubeMatched.length * 12 + raw.length * 4;
  if (result.confidence_level === "high") score += 24;
  else if (result.confidence_level === "medium") score += 12;
  return {
    score,
    raw_name_count: raw.length,
    cube_matched_count: cubeMatched.length,
    confidence_level: result.confidence_level,
  };
}

/** Single-pass extraction used to score a candidate orientation. */
export async function lightExtractScoreFromRgba(
  frame: RgbaFrame,
  opts: OrientLightExtractOptions,
  visionStep?: number,
): Promise<OrientLightExtractScore> {
  const side = opts.maxImageSide ?? EVAL_IMAGE_SIDE_UNLIMITED;
  const sized = resizeToMaxSide(frame, side, side);
  const jpegBytes = encodeJpeg(sized, opts.jpegQuality);
  const imageInput = await visionInputFromJpegBytes({
    env: opts.visionEnv,
    publisher: opts.vision,
    jpegBytes,
    purpose: visionStep !== undefined ? "orient" : "extract",
    step: visionStep,
  });

  const result = await callOpenAiVisionJsonSchema(
    {
      apiKey: opts.apiKey,
      model: opts.model,
      maxOutputTokens: LIGHT_EXTRACT_MAX_OUTPUT,
      reasoningEffort: "low",
      developerText: EXTRACTION_DEVELOPER_PROMPT,
      userText: buildExtractionUserPrompt({ pass: "initial" }),
      promptCacheKey: opts.cubeId ? `cube:${opts.cubeId}:orient-verify` : undefined,
      ...imageInput,
      schemaName: "card_extraction",
      jsonSchema: cardExtractionJsonSchema as unknown as Record<string, unknown>,
      baseUrl: opts.baseUrl,
      gatewayToken: opts.gatewayToken,
      requestTimeoutMs: opts.requestTimeoutMs,
      fetchImpl: opts.fetchImpl,
      openAiLogLevel: opts.openAiLogLevel,
    },
    CardExtractionResultSchema,
  );

  return scoreLightExtractionResult(result, opts.cubeCardList);
}

function frameAtRotation(baseFrame: RgbaFrame, rotation: RotationCandidate): RgbaFrame {
  return rotation === 0 ? baseFrame : rotateClockwise(baseFrame, rotation);
}

/** Score 0°, 90°, 180°, and 270° clockwise from the original frame. */
export async function scoreAllRotationCandidates(
  baseFrame: RgbaFrame,
  opts: OrientLightExtractOptions,
  roundIndex: number,
): Promise<Record<RotationCandidate, OrientLightExtractScore>> {
  const out = {} as Record<RotationCandidate, OrientLightExtractScore>;
  for (const rot of ROTATION_CANDIDATES) {
    const step = roundIndex * 10 + rot;
    out[rot] = await lightExtractScoreFromRgba(frameAtRotation(baseFrame, rot), opts, step);
  }
  return out;
}

export function appendRotationScores(
  history: RotationScoreHistory,
  round: Record<RotationCandidate, OrientLightExtractScore>,
): void {
  for (const rot of ROTATION_CANDIDATES) {
    history[rot].push(round[rot]);
  }
}

/** Pick rotation with the highest score across all recorded rounds. */
export function bestRotationFromHistory(history: RotationScoreHistory): {
  rotation: RotationCandidate;
  bestScore: number;
} {
  let bestRotation: RotationCandidate = 0;
  let bestScore = -1;
  for (const rot of ROTATION_CANDIDATES) {
    const peak = history[rot].reduce((m, s) => Math.max(m, s.score), -1);
    if (peak > bestScore) {
      bestScore = peak;
      bestRotation = rot;
    }
  }
  return { rotation: bestRotation, bestScore };
}

/** Best rotation from a single scoring round only. */
export function bestRotationFromRound(round: Record<RotationCandidate, OrientLightExtractScore>): {
  rotation: RotationCandidate;
  bestScore: number;
} {
  let bestRotation: RotationCandidate = 0;
  let bestScore = -1;
  for (const rot of ROTATION_CANDIDATES) {
    if (round[rot].score > bestScore) {
      bestScore = round[rot].score;
      bestRotation = rot;
    }
  }
  return { rotation: bestRotation, bestScore };
}
