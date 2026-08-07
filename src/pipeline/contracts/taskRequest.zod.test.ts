import { describe, expect, it } from "vitest";
import { TaskRequestSchema } from "./taskRequest.zod";

describe("TaskRequestSchema", () => {
  it("accepts R2 staging shape", () => {
    const r = TaskRequestSchema.safeParse({
      upload_id: "abc/2026_p",
      schema_version: 1,
      r2_bucket: "decklist-uploads",
      r2_prefix: "abc/2026_p/",
      cube_id: "my-cube",
    });
    expect(r.success).toBe(true);
  });

  it("accepts internal replacement deck marker", () => {
    const r = TaskRequestSchema.safeParse({
      upload_id: "reprocess:123:uuid",
      schema_version: 1,
      r2_bucket: "decklist-uploads",
      r2_prefix: "abc/2026_p/",
      replace_deck_id: 123,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.replace_deck_id).toBe(123);
  });

  it("accepts URL shape", () => {
    const r = TaskRequestSchema.safeParse({
      upload_id: "u1",
      schema_version: 1,
      image_url: "https://example.com/a.jpg",
    });
    expect(r.success).toBe(true);
  });

  it("rejects when neither R2 nor URL is set", () => {
    const r = TaskRequestSchema.safeParse({
      upload_id: "u1",
      schema_version: 1,
    });
    expect(r.success).toBe(false);
  });

  it("rejects when both R2 and URL are set", () => {
    const r = TaskRequestSchema.safeParse({
      upload_id: "u1",
      schema_version: 1,
      r2_bucket: "b",
      r2_prefix: "p/",
      image_url: "https://x",
    });
    expect(r.success).toBe(false);
  });
});
