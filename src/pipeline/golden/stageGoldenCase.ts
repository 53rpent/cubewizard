import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { R2BucketGetPut } from "../orchestrator/runEvalTask";
import type { TaskRequest } from "../contracts/taskRequest.zod";
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
  goldenCase: GoldenCaseDefinition
): Promise<StagedGoldenCase> {
  const upload_id = `golden:${goldenCase.case_id}`;
  const r2_prefix = `golden/${goldenCase.case_id}/`;
  const imageBytes = new Uint8Array(readFileSync(goldenCase.image_path));
  const image_key = `${r2_prefix}${basename(goldenCase.image_path)}`;
  const metaKey = `${r2_prefix}metadata.json`;

  await bucket.put(image_key, imageBytes, {
    httpMetadata: { contentType: "image/jpeg" },
  } as { httpMetadata?: { contentType?: string } });

  const cubeId = goldenCase.expected.cube_id?.trim() || "golden-cube";
  const metadata = {
    cube_id: cubeId,
    pilot_name: "GoldenHarness",
    match_wins: 0,
    match_losses: 0,
    match_draws: 0,
    win_rate: 0,
    record_logged: new Date().toISOString(),
    image_key,
    original_filename: basename(goldenCase.image_path),
  };

  await bucket.put(
    metaKey,
    new TextEncoder().encode(JSON.stringify(metadata)),
    { httpMetadata: { contentType: "application/json" } } as {
      httpMetadata?: { contentType?: string };
    }
  );

  const task: TaskRequest = {
    upload_id,
    schema_version: 1,
    cube_id: cubeId,
    pilot_name: "GoldenHarness",
    submitted_at: metadata.record_logged,
    r2_bucket: GOLDEN_R2_BUCKET,
    r2_prefix,
    match_wins: 0,
    match_losses: 0,
    match_draws: 0,
  };

  return { task, upload_id, r2_prefix, image_key };
}
