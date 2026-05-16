import { z } from "zod";

export const OrientationResultSchema = z.object({
  rotation_needed: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  confidence: z.enum(["high", "medium", "low"]),
  reasoning: z.string().optional(),
});

export type OrientationResult = z.infer<typeof OrientationResultSchema>;

export const CardExtractionResultSchema = z.object({
  card_names: z.array(z.string()),
  confidence_level: z.enum(["high", "medium", "low"]),
  notes: z.string().optional(),
});

export type CardExtractionResult = z.infer<typeof CardExtractionResultSchema>;
