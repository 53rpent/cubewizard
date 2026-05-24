/** JSON Schemas for OpenAI Responses API `text.format` (subset of draft-2020-12). */

export const orientationJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["rotation_needed", "confidence"],
  properties: {
    rotation_needed: { type: "integer", enum: [0, 90, 180, 270] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    reasoning: {
      type: "string",
      description: "Omit unless confidence is low; at most one short sentence.",
    },
  },
} as const;

export const orientationConfirmJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["correctly_oriented"],
  properties: {
    correctly_oriented: {
      type: "boolean",
      description: "true when the main deck pile reads upright (title bars on top).",
    },
  },
} as const;

export const cardExtractionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["card_names", "confidence_level"],
  properties: {
    card_names: { type: "array", items: { type: "string" } },
    confidence_level: { type: "string", enum: ["high", "medium", "low"] },
    notes: { type: "string" },
  },
} as const;
