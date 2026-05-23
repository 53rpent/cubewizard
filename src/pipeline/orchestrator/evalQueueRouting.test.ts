import { describe, expect, it } from "vitest";
import { isEvalExtractQueue, shouldRunExtractPhase } from "./evalQueueRouting";

describe("evalQueueRouting", () => {
  it("detects extract queue names", () => {
    expect(isEvalExtractQueue("cubewizard-eval-extract-local")).toBe(true);
    expect(isEvalExtractQueue("cubewizard-eval-local")).toBe(false);
  });

  it("routes extract bodies and extract queues", () => {
    const body = {
      upload_id: "u",
      schema_version: 2,
      cube_id: "c",
      image_id: "i",
      oriented_image_r2_key: "c/i.jpg",
      processing_timestamp: "t",
      pilot_name: "p",
      record_logged: "r",
    };
    expect(shouldRunExtractPhase("cubewizard-eval-local", body)).toBe(true);
    expect(shouldRunExtractPhase("cubewizard-eval-extract-stg", { oriented_image_r2_key: "x" })).toBe(
      true
    );
    expect(shouldRunExtractPhase("cubewizard-eval-stg", { upload_id: "u" })).toBe(false);
  });
});
