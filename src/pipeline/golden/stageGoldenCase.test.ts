import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { R2BucketGetPut } from "../orchestrator/runEvalTask";
import type { GoldenCaseDefinition } from "./types";
import { stageGoldenCaseOnR2 } from "./stageGoldenCase";

const REPO_ROOT = join(__dirname, "../../..");
const PNG_FIXTURE = join(REPO_ROOT, "fixtures/eval-golden/cases/ProxyBacon1/image.png");
const JPG_FIXTURE = join(REPO_ROOT, "fixtures/eval-golden/cases/ArcaneLessons/image.jpg");

function mockBucket(): R2BucketGetPut & {
  puts: { key: string; contentType?: string }[];
} {
  const puts: { key: string; contentType?: string }[] = [];
  return {
    puts,
    async get() {
      return null;
    },
    async put(key, _value, options) {
      puts.push({ key, contentType: options?.httpMetadata?.contentType });
    },
  };
}

function goldenCase(imageBasename: string): GoldenCaseDefinition {
  return {
    case_id: "test-case",
    dir: "/cases/test-case",
    image_path: `/cases/test-case/${imageBasename}`,
    expected: { expected_card_names: ["Lightning Bolt"] },
  };
}

describe("stageGoldenCaseOnR2", () => {
  it("sets image/png for PNG golden fixtures", async () => {
    const bucket = mockBucket();
    await stageGoldenCaseOnR2(bucket, {
      ...goldenCase("image.png"),
      image_path: PNG_FIXTURE,
    });
    const imagePut = bucket.puts.find((p) => p.key.endsWith("image.png"));
    expect(imagePut?.contentType).toBe("image/png");
  });

  it("sets image/jpeg for JPG golden fixtures", async () => {
    const bucket = mockBucket();
    await stageGoldenCaseOnR2(bucket, {
      ...goldenCase("image.jpg"),
      image_path: JPG_FIXTURE,
    });
    const imagePut = bucket.puts.find((p) => p.key.endsWith("image.jpg"));
    expect(imagePut?.contentType).toBe("image/jpeg");
  });
});
