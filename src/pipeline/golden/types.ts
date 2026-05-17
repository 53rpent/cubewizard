import type { GoldenAggregateMetrics, GoldenCaseMetrics } from "./metrics";
import type { OpenAiPricingRates } from "./openAiPricing";

export interface GoldenExpectedFile {
  description?: string;
  cube_id?: string;
  expected_card_names: string[];
  expected_count?: number;
  tags?: string[];
  notes?: string;
}

export interface GoldenCaseDefinition {
  case_id: string;
  dir: string;
  image_path: string;
  expected: GoldenExpectedFile;
}

export interface OpenAiUsageTotals {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

export interface GoldenCaseCostUsd {
  input_usd: number;
  output_usd: number;
  total_usd: number;
}

export interface GoldenCaseRunResult {
  case_id: string;
  description?: string;
  tags?: string[];
  cube_id?: string;
  predicted_card_names: string[];
  metrics: GoldenCaseMetrics;
  openai_calls: number;
  orientation_calls: number;
  extraction_calls: number;
  usage: OpenAiUsageTotals;
  cost_usd: GoldenCaseCostUsd;
  duration_ms: number;
  job_status: string;
  error?: string;
}

export interface GoldenSuiteConfig {
  model: string;
  max_output_tokens: number;
  reasoning_effort: "low" | "medium" | "high";
  use_multi_pass: boolean;
  max_cubecobra_cards: number;
  jpeg_quality: number;
  max_image_side: number;
  orient_max_side: number;
}

export interface GoldenSuiteRunResult {
  version: 1;
  run_id: string;
  recorded_at: string;
  label: string;
  model: string;
  config: GoldenSuiteConfig;
  /** Standard-tier USD/1M token rates used for cost estimates. */
  pricing: OpenAiPricingRates;
  /** How the suite was executed (`eval_consumer` = queue handler + `runEvalTask`). */
  runner: "eval_consumer";
  aggregate: GoldenAggregateMetrics;
  cases: GoldenCaseRunResult[];
}

export interface GoldenScoresFile {
  version: 1;
  runs: GoldenSuiteRunResult[];
}
