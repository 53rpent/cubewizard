import { describe, expect, it } from "vitest";
import { ExtractTaskRequestSchema } from "./extractTaskRequest.zod";

describe("ExtractTaskRequestSchema", () => {
  const base = {
    upload_id: "u1",
    schema_version: 2 as const,
    cube_id: "cube",
    image_id: "img1",
    oriented_image_r2_key: "key",
    processing_timestamp: "ts",
    pilot_name: "pilot",
    record_logged: "2026-01-01T00:00:00Z",
  };

  it("accepts optional owner_user_id", () => {
    const r = ExtractTaskRequestSchema.safeParse({ ...base, owner_user_id: 7 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.owner_user_id).toBe(7);
  });

  it("accepts optional replacement deck marker", () => {
    const r = ExtractTaskRequestSchema.safeParse({ ...base, replace_deck_id: 123 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.replace_deck_id).toBe(123);
  });

  it("accepts body without owner_user_id", () => {
    expect(ExtractTaskRequestSchema.safeParse(base).success).toBe(true);
  });
});
