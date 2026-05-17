import { describe, expect, it } from "vitest";
import { createEvalUsageReporter, runWithEvalUsageReporter } from "./evalUsageReport";

describe("evalUsageReport", () => {
  it("accumulates OpenAI usage and extracted names", async () => {
    const reporter = createEvalUsageReporter("u-test");
    await runWithEvalUsageReporter(reporter, async () => {
      reporter.setExtractedCardNames(["Lightning Bolt"]);
      reporter.recordOpenAiResponse("orientation_result", 200, {
        usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 },
      });
      reporter.recordOpenAiResponse("card_extraction", 200, {
        usage: { input_tokens: 500, output_tokens: 200, total_tokens: 700 },
      });
    });

    const report = reporter.finish(1234);
    expect(report.upload_id).toBe("u-test");
    expect(report.extracted_card_names).toEqual(["Lightning Bolt"]);
    expect(report.openai.calls).toHaveLength(2);
    expect(report.openai.totals.total_tokens).toBe(810);
    expect(report.openai.orientation_calls).toBe(1);
    expect(report.openai.extraction_calls).toBe(1);
    expect(report.duration_ms).toBe(1234);
  });
});
