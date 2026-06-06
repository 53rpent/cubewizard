/**
 * Regenerate fixtures/eval-golden/data/model-pricing.csv from
 * Cloudflare AI Gateway GET …/compat/v1/models (cost_in / cost_out per token).
 *
 * Usage (from repo root):
 *   node scripts/sync-ai-gateway-pricing-csv.mjs
 *
 * Reads CLOUDFLARE_ACCOUNT_ID + EVAL_VISION_API_KEY (or OPENAI_API_KEY) from .dev.vars
 * and OPENAI_GATEWAY_TOKEN when set. Gateway name defaults to cubewizard.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..");
const OUT_PATH = join(REPO_ROOT, "fixtures/eval-golden/data/model-pricing.csv");
const ACCOUNT_DEFAULT = "82dc60a1fbcc9e8767c55a198d0dd22c";
const GATEWAY_DEFAULT = "cubewizard";
const PRICING_AS_OF = new Date().toISOString().slice(0, 10);

/** Authoritative Workers AI rates when compat/v1/models catalog is stale. USD per 1M tokens. */
const WORKERS_AI_USD_PER_1M_OVERRIDES = {
  "workers-ai/@cf/google/gemma-4-26b-a4b-it": { input: 0.1, cached: "", output: 0.3 },
  "workers-ai/@cf/moonshotai/kimi-k2.6": { input: 0.95, cached: 0.16, output: 4 },
};

function loadDevVars() {
  const env = {};
  try {
    for (const line of readFileSync(join(REPO_ROOT, ".dev.vars"), "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
  } catch {
    /* optional locally */
  }
  return env;
}

function perMillion(perToken) {
  const n = Number(perToken);
  if (!Number.isFinite(n)) return "";
  const perM = n * 1_000_000;
  return String(Math.round(perM * 1_000_000) / 1_000_000);
}

function addRow(map, modelId, costIn, costOut) {
  const id = String(modelId ?? "").trim();
  if (!id || map.has(id)) return;
  map.set(id, {
    model_id: id,
    usd_per_1m_input: perMillion(costIn),
    usd_per_1m_cached_input: "",
    usd_per_1m_output: perMillion(costOut),
    tier: "ai-gateway",
    pricing_as_of: PRICING_AS_OF,
  });
}

function upsertRow(map, modelId, costIn, costOut) {
  const id = String(modelId ?? "").trim();
  if (!id) return;
  map.set(id, {
    model_id: id,
    usd_per_1m_input: perMillion(costIn),
    usd_per_1m_cached_input: "",
    usd_per_1m_output: perMillion(costOut),
    tier: "ai-gateway",
    pricing_as_of: PRICING_AS_OF,
  });
}

function setCachedInput(map, modelId, cachedUsdPer1M) {
  const row = map.get(modelId);
  if (row && cachedUsdPer1M !== "") {
    row.usd_per_1m_cached_input = String(cachedUsdPer1M);
  }
}

function applyWorkersAiOverrides(map) {
  for (const [workersAiId, rates] of Object.entries(WORKERS_AI_USD_PER_1M_OVERRIDES)) {
    const costIn = rates.input / 1_000_000;
    const costOut = rates.output / 1_000_000;
    upsertRow(map, workersAiId, costIn, costOut);
    const cfId = workersAiId.startsWith("workers-ai/@cf/") ? workersAiId.slice("workers-ai/".length) : null;
    if (cfId) upsertRow(map, cfId, costIn, costOut);
    if (rates.cached !== "") {
      setCachedInput(map, workersAiId, rates.cached);
      if (cfId) setCachedInput(map, cfId, rates.cached);
    }
  }
}

function aliasRows(map, id, costIn, costOut) {
  addRow(map, id, costIn, costOut);

  if (id.startsWith("workers-ai/@cf/")) {
    addRow(map, id.slice("workers-ai/".length), costIn, costOut);
  }

  const slash = id.indexOf("/");
  if (slash <= 0) return;
  const provider = id.slice(0, slash);
  const rest = id.slice(slash + 1);
  if (!rest || rest.includes("/")) return;
  if (["openai", "anthropic", "google-ai-studio", "google", "xai", "grok", "groq", "mistral", "deepseek"].includes(provider)) {
    addRow(map, rest, costIn, costOut);
  }
}

async function main() {
  const env = loadDevVars();
  const account = env.CLOUDFLARE_ACCOUNT_ID || ACCOUNT_DEFAULT;
  const gateway = env.AI_GATEWAY_NAME || GATEWAY_DEFAULT;
  const token = env.EVAL_VISION_API_KEY || env.OPENAI_API_KEY || env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    throw new Error("Set EVAL_VISION_API_KEY or OPENAI_API_KEY in .dev.vars (or CLOUDFLARE_API_TOKEN)");
  }

  const url = `https://gateway.ai.cloudflare.com/v1/${account}/${gateway}/compat/v1/models`;
  const headers = {
    Authorization: `Bearer ${token}`,
    "cf-aig-authorization": `Bearer ${token}`,
  };
  const gatewayToken = env.OPENAI_GATEWAY_TOKEN?.trim();
  if (gatewayToken) {
    headers["cf-aig-authorization"] = `Bearer ${gatewayToken}`;
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`GET ${url} failed: ${res.status} ${(await res.text()).slice(0, 400)}`);
  }

  const body = await res.json();
  const models = Array.isArray(body.data) ? body.data : [];
  if (!models.length) {
    throw new Error("No models returned from AI Gateway compat/v1/models");
  }

  const map = new Map();
  for (const m of models) {
    aliasRows(map, m.id, m.cost_in, m.cost_out);
  }
  applyWorkersAiOverrides(map);

  const rows = [...map.values()].sort((a, b) => a.model_id.localeCompare(b.model_id));

  const header = `# Cloudflare AI Gateway model pricing (USD per 1M tokens).
# Source: GET https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/compat/v1/models
# (cost_in / cost_out per token × 1,000,000). Unified Billing pass-through; Workers AI @cf/* included.
# Some @cf/* rows use Workers AI neuron pricing when compat/v1/models catalog is wrong (see sync script).
# Docs: https://developers.cloudflare.com/ai/models/ https://developers.cloudflare.com/ai-gateway/features/unified-billing/
# Regenerate: node scripts/sync-ai-gateway-pricing-csv.mjs
# Columns: model_id, usd_per_1m_input, usd_per_1m_cached_input, usd_per_1m_output, tier, pricing_as_of
# Empty usd_per_1m_cached_input means same as input. Lines starting with # are ignored.
model_id,usd_per_1m_input,usd_per_1m_cached_input,usd_per_1m_output,tier,pricing_as_of`;

  const bodyLines = rows.map((r) =>
    [r.model_id, r.usd_per_1m_input, r.usd_per_1m_cached_input, r.usd_per_1m_output, r.tier, r.pricing_as_of].join(","),
  );

  writeFileSync(OUT_PATH, `${header}\n${bodyLines.join("\n")}\n`, "utf8");
  console.log(`Wrote ${rows.length} model rows (${models.length} from API) to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
