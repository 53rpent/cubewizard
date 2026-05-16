import { z } from "zod";

/**
 * Matches `fixtures/pipeline/task-request.schema.json`:
 * require `(r2_bucket AND r2_prefix)` OR `image_url`.
 */
export const TaskRequestSchema = z
  .object({
    upload_id: z.string().min(1),
    schema_version: z.number().int().min(1).default(1),
    cube_id: z.string().optional(),
    pilot_name: z.string().optional(),
    submitted_at: z.string().optional(),
    r2_bucket: z.string().min(1).optional(),
    r2_prefix: z.string().min(1).optional(),
    image_url: z.string().min(1).optional(),
    image_source: z.string().optional(),
    match_wins: z.number().int().optional(),
    match_losses: z.number().int().optional(),
    match_draws: z.number().int().optional(),
  })
  .superRefine((val, ctx) => {
    const hasR2 = Boolean(val.r2_bucket && val.r2_prefix);
    const hasUrl = Boolean(val.image_url);
    if (hasR2 === hasUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Exactly one of: (r2_bucket + r2_prefix) or image_url must be set",
      });
    }
  });

export type TaskRequest = z.infer<typeof TaskRequestSchema>;
