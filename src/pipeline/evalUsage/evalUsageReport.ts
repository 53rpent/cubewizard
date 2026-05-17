/** Per-eval OpenAI usage + extraction summary (golden harness + `result_json`). */

export interface EvalOpenAiCallRecord {
  schema_name: string | null;
  status: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

export interface EvalOpenAiUsageTotals {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

export interface EvalRunReport {
  upload_id: string;
  extracted_card_names: string[];
  duration_ms: number;
  openai: {
    calls: EvalOpenAiCallRecord[];
    totals: EvalOpenAiUsageTotals;
    orientation_calls: number;
    extraction_calls: number;
  };
}

export interface EvalUsageReporter {
  readonly uploadId: string;
  setExtractedCardNames(names: string[]): void;
  recordOpenAiResponse(schemaName: string | null, status: number, responseJson: unknown): void;
  finish(durationMs: number): EvalRunReport;
}

function extractUsage(json: unknown): EvalOpenAiUsageTotals {
  if (!json || typeof json !== "object") {
    return { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  }
  const u = (json as Record<string, unknown>).usage;
  if (!u || typeof u !== "object") {
    return { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  }
  const usage = u as Record<string, unknown>;
  const input = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0) || 0;
  const output = Number(usage.output_tokens ?? usage.completion_tokens ?? 0) || 0;
  const total = Number(usage.total_tokens ?? input + output) || input + output;
  return { input_tokens: input, output_tokens: output, total_tokens: total };
}

function sumTotals(calls: EvalOpenAiCallRecord[]): EvalOpenAiUsageTotals {
  let input_tokens = 0;
  let output_tokens = 0;
  let total_tokens = 0;
  for (const c of calls) {
    input_tokens += c.input_tokens;
    output_tokens += c.output_tokens;
    total_tokens += c.total_tokens;
  }
  return { input_tokens, output_tokens, total_tokens };
}

export function createEvalUsageReporter(uploadId: string): EvalUsageReporter {
  const calls: EvalOpenAiCallRecord[] = [];
  let extracted: string[] = [];

  return {
    uploadId,
    setExtractedCardNames(names: string[]) {
      extracted = [...names];
    },
    recordOpenAiResponse(schemaName, status, responseJson) {
      const usage = extractUsage(responseJson);
      calls.push({
        schema_name: schemaName,
        status,
        ...usage,
      });
    },
    finish(durationMs: number): EvalRunReport {
      let orientation_calls = 0;
      let extraction_calls = 0;
      for (const c of calls) {
        if (c.schema_name === "orientation_result") orientation_calls += 1;
        else if (c.schema_name === "card_extraction") extraction_calls += 1;
      }
      return {
        upload_id: uploadId,
        extracted_card_names: extracted,
        duration_ms: durationMs,
        openai: {
          calls: [...calls],
          totals: sumTotals(calls),
          orientation_calls,
          extraction_calls,
        },
      };
    },
  };
}

let activeReporter: EvalUsageReporter | null = null;

export function runWithEvalUsageReporter<T>(
  reporter: EvalUsageReporter,
  fn: () => Promise<T>
): Promise<T> {
  const prev = activeReporter;
  activeReporter = reporter;
  return fn().finally(() => {
    activeReporter = prev;
  });
}

export function getActiveEvalUsageReporter(): EvalUsageReporter | null {
  return activeReporter;
}

export function logEvalUsageReport(report: EvalRunReport): void {
  console.log("eval_usage_report", JSON.stringify(report));
}
