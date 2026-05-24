import { describe, expect, it } from "vitest";
import { ExtractTaskRequestSchema, isExtractTaskBody } from "./extractTaskRequest.zod";

describe("ExtractTaskRequestSchema", () => {
  it("accepts phase-2 extract payloads", () => {
    const body = {
      upload_id: "u1",
      schema_version: 2 as const,
      cube_id: "cube",
      image_id: "img",
      oriented_image_r2_key: "cube/img.jpg",
      processing_timestamp: "hedron:u1",
      pilot_name: "Pilot",
      record_logged: "2026-01-01T00:00:00.000Z",
    };
    expect(ExtractTaskRequestSchema.safeParse(body).success).toBe(true);
    expect(isExtractTaskBody(body)).toBe(true);
  });

  it("rejects orient-stage bodies", () => {
    const body = {
      upload_id: "u1",
      schema_version: 1,
      r2_bucket: "b",
      r2_prefix: "p/",
    };
    expect(isExtractTaskBody(body)).toBe(false);
  });
});
