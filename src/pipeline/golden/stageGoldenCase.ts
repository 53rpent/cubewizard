import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import type { TaskRequest } from "../contracts/taskRequest.zod";
import { normalizeStagingImage, parseStagingImageConfig } from "../images/normalizeStagingImage";
import type { R2BucketGetPut } from "../orchestrator/runEvalTask";
import { contentTypeForExt } from "../r2/orientedKeys";
import type { GoldenCaseDefinition } from "./types";

const GOLDEN_R2_BUCKET = "decklist-uploads";

export interface StagedGoldenCase {
  task: TaskRequest;
  upload_id: string;
  r2_prefix: string;
  image_key: string;
}

/** Stage a golden photo + metadata into mock R2 (same layout as site upload). */
export async function stageGoldenCaseOnR2(
  bucket: R2BucketGetPut,
  goldenCase: GoldenCaseDefinition,
): Promise<StagedGoldenCase> {
  const upload_id = `golden:${goldenCase.case_id}`;
  const r2_prefix = `golden/${goldenCase.case_id}/`;
  const rawBytes = new Uint8Array(readFileSync(goldenCase.image_path));
  const stagingOpts = parseStagingImageConfig(process.env);
  const normalized = await normalizeStagingImage(null, rawBytes, stagingOpts);
  const image_key = `${r2_prefix}image.jpg`;
  const metaKey = `${r2_prefix}metadata.json`;

  await bucket.put(image_key, normalized.bytes, {
    httpMetadata: { contentType: "image/jpeg" },
  } as { httpMetadata?: { contentType?: string } });

  const cubeId = goldenCase.expected.cube_id?.trim() || "golden-cube";
  const expectedCount = goldenCase.expected.expected_count;
  const originalExt = extname(goldenCase.image_path).replace(/^\./, "") || "jpg";
  const metadata: Record<string, unknown> = {
    cube_id: cubeId,
    pilot_name: "GoldenHarness",
    match_wins: 0,
    match_losses: 0,
    match_draws: 0,
    win_rate: 0,
    record_logged: new Date().toISOString(),
    image_key,
    original_filename: basename(goldenCase.image_path),
    original_content_type: contentTypeForExt(extname(goldenCase.image_path)),
    original_ext: originalExt,
    uploaded_bytes: rawBytes.byteLength,
    staging_normalized: true,
    staging_max_side: stagingOpts.maxSide,
    staging_width: normalized.width,
    staging_height: normalized.height,
  };
  if (normalized.originalWidth != null) {
    metadata.original_width = normalized.originalWidth;
    metadata.original_height = normalized.originalHeight;
  }
  if (typeof expectedCount === "number" && Number.isFinite(expectedCount)) {
    metadata.expected_count = Math.floor(expectedCount);
    metadata.expected_deck_size = Math.floor(expectedCount);
  }

  await bucket.put(metaKey, new TextEncoder().encode(JSON.stringify(metadata)), {
    httpMetadata: { contentType: "application/json" },
  } as {
    httpMetadata?: { contentType?: string };
  });

  const task: TaskRequest = {
    upload_id,
    schema_version: 1,
    cube_id: cubeId,
    pilot_name: "GoldenHarness",
    submitted_at: metadata.record_logged as string,
    r2_bucket: GOLDEN_R2_BUCKET,
    r2_prefix,
    match_wins: 0,
    match_losses: 0,
    match_draws: 0,
  };

  return { task, upload_id, r2_prefix, image_key };
}
