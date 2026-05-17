import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Bundled Standard-tier rates (no live fetch — avoids 403 on pricing docs). */
export const GOLDEN_OPENAI_PRICING_CSV = "fixtures/eval-golden/data/openai-standard-pricing.csv";

export interface OpenAiPricingRates {
  model: string;
  verified_model_id: string | null;
  /** USD per 1M input tokens (Standard tier). */
  usd_per_1m_input: number;
  usd_per_1m_cached_input: number;
  usd_per_1m_output: number;
  source: "pricing_csv" | "env_override";
  /** `pricing_as_of` from CSV row, or ISO timestamp for env override. */
  fetched_at: string;
  pricing_csv_path?: string;
}

export interface OpenAiUsageCostUsd {
  input_usd: number;
  output_usd: number;
  total_usd: number;
}

export class OpenAiPricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenAiPricingError";
  }
}

function normalizeModelKey(model: string): string {
  return model.trim().toLowerCase();
}

/** Parse one CSV line (supports quoted fields). */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** Load Standard-tier pricing table from the bundled CSV. */
export function loadOpenAiPricingCsv(csvText: string, csvPath?: string): Map<string, OpenAiPricingRates> {
  const map = new Map<string, OpenAiPricingRates>();
  const lines = csvText.split(/\r?\n/);
  let header: string[] | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const cols = parseCsvLine(line);
    if (!header) {
      header = cols.map((c) => c.toLowerCase());
      continue;
    }
    const row: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) {
      row[header[i]!] = cols[i] ?? "";
    }
    const model_id = row.model_id?.trim();
    if (!model_id) continue;

    const input = parseFloat(row.usd_per_1m_input ?? "");
    const output = parseFloat(row.usd_per_1m_output ?? "");
    if (!Number.isFinite(input) || !Number.isFinite(output)) continue;

    const cachedRaw = row.usd_per_1m_cached_input?.trim() ?? "";
    const cached =
      cachedRaw === "" ? input : (
        Number.isFinite(parseFloat(cachedRaw)) ? parseFloat(cachedRaw) : input
      );

    const key = normalizeModelKey(model_id);
    map.set(key, {
      model: model_id,
      verified_model_id: model_id,
      usd_per_1m_input: input,
      usd_per_1m_cached_input: cached,
      usd_per_1m_output: output,
      source: "pricing_csv",
      fetched_at: row.pricing_as_of?.trim() || "unknown",
      pricing_csv_path: csvPath,
    });
  }

  return map;
}

export function loadOpenAiPricingCsvFromRepo(repoRoot: string): Map<string, OpenAiPricingRates> {
  const csvPath = join(repoRoot, GOLDEN_OPENAI_PRICING_CSV);
  if (!existsSync(csvPath)) {
    throw new OpenAiPricingError(`Pricing CSV not found: ${csvPath}`);
  }
  return loadOpenAiPricingCsv(readFileSync(csvPath, "utf8"), csvPath);
}

/** Longest-prefix match (handles dated snapshots like gpt-5-mini-2025-08-07). */
export function matchPricingRates(
  model: string,
  table: Map<string, OpenAiPricingRates>
): OpenAiPricingRates | null {
  const key = normalizeModelKey(model);
  if (table.has(key)) return table.get(key)!;

  const withoutDate = key.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  if (table.has(withoutDate)) return table.get(withoutDate)!;

  let best: OpenAiPricingRates | null = null;
  let bestLen = 0;
  for (const [k, rates] of table) {
    if (key.startsWith(k) && k.length > bestLen) {
      best = rates;
      bestLen = k.length;
    }
  }
  return best;
}

function ratesFromEnv(model: string): OpenAiPricingRates | null {
  const inRaw = process.env.GOLDEN_EVAL_USD_PER_1M_INPUT;
  const outRaw = process.env.GOLDEN_EVAL_USD_PER_1M_OUTPUT;
  if (inRaw == null || inRaw === "" || outRaw == null || outRaw === "") return null;
  const usd_per_1m_input = parseFloat(inRaw);
  const usd_per_1m_output = parseFloat(outRaw);
  if (!Number.isFinite(usd_per_1m_input) || !Number.isFinite(usd_per_1m_output)) return null;
  const cachedRaw = process.env.GOLDEN_EVAL_USD_PER_1M_CACHED_INPUT;
  const usd_per_1m_cached_input =
    cachedRaw != null && cachedRaw !== "" && Number.isFinite(parseFloat(cachedRaw)) ?
      parseFloat(cachedRaw)
    : usd_per_1m_input;
  return {
    model,
    verified_model_id: model,
    usd_per_1m_input,
    usd_per_1m_cached_input,
    usd_per_1m_output,
    source: "env_override",
    fetched_at: new Date().toISOString(),
  };
}

/** Resolve USD/1M token rates for `model` from bundled CSV (or env override). */
export function resolveOpenAiModelPricing(model: string, repoRoot: string): OpenAiPricingRates {
  const envRates = ratesFromEnv(model);
  if (envRates) return envRates;

  const table = loadOpenAiPricingCsvFromRepo(repoRoot);
  const matched = matchPricingRates(model, table);
  if (!matched) {
    throw new OpenAiPricingError(
      `No pricing row for model "${model}" in ${GOLDEN_OPENAI_PRICING_CSV}. ` +
        "Add a row to the CSV or set GOLDEN_EVAL_USD_PER_1M_INPUT / GOLDEN_EVAL_USD_PER_1M_OUTPUT."
    );
  }

  return {
    ...matched,
    model,
    verified_model_id: matched.model,
  };
}

/** @deprecated Use {@link resolveOpenAiModelPricing}. Kept for call-site compatibility. */
export async function fetchOpenAiModelPricing(
  model: string,
  _apiKey: string
): Promise<OpenAiPricingRates> {
  const repoRoot = process.cwd();
  return resolveOpenAiModelPricing(model, repoRoot);
}

export function computeUsageCostUsd(
  usage: { input_tokens: number; output_tokens: number },
  rates: OpenAiPricingRates
): OpenAiUsageCostUsd {
  const input_usd = (usage.input_tokens / 1_000_000) * rates.usd_per_1m_input;
  const output_usd = (usage.output_tokens / 1_000_000) * rates.usd_per_1m_output;
  return {
    input_usd,
    output_usd,
    total_usd: input_usd + output_usd,
  };
}
