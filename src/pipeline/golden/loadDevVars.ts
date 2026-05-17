import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Parse Wrangler-style `.dev.vars` (KEY=value, # comments, optional quotes). */
export function parseDevVarsFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/** Merge `.dev.vars` from repo root into `process.env` (does not override existing vars). */
export function loadDevVarsIntoEnv(repoRoot: string): void {
  const path = join(repoRoot, ".dev.vars");
  if (!existsSync(path)) return;
  const parsed = parseDevVarsFile(readFileSync(path, "utf8"));
  for (const [k, v] of Object.entries(parsed)) {
    if (process.env[k] === undefined || process.env[k] === "") {
      process.env[k] = v;
    }
  }
}

export function resolveOpenAiKeyFromEnv(): string | null {
  const k = String(process.env.OPENAI_API_KEY ?? "").trim();
  return k || null;
}
