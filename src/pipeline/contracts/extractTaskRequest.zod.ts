import { z } from "zod";

/**
 * Phase-2 eval queue message (after orientation). Produced by `runOrientTask`, consumed by `runExtractTask`.
 */
export const ExtractTaskRequestSchema = z.object({
  upload_id: z.string().min(1),
  schema_version: z.literal(2),
  cube_id: z.string().min(1),
  image_id: z.string().min(1),
  oriented_image_r2_key: z.string().min(1),
  processing_timestamp: z.string().min(1),
  pilot_name: z.string().min(1),
  record_logged: z.string().min(1),
  image_source: z.string().optional(),
  staging_image_r2_key: z.string().optional(),
  match_wins: z.number().int().optional(),
  match_losses: z.number().int().optional(),
  match_draws: z.number().int().optional(),
  win_rate: z.number().optional(),
  expected_deck_size: z.number().int().positive().optional(),
});

export type ExtractTaskRequest = z.infer<typeof ExtractTaskRequestSchema>;

export function isExtractTaskBody(body: unknown): body is ExtractTaskRequest {
  return ExtractTaskRequestSchema.safeParse(body).success;
}
