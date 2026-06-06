/** Strip gateway provider prefix (`openai/gpt-5-mini` → `gpt-5-mini`). */
export function normalizeOpenAiModelId(model: string): string {
  const id = String(model ?? "")
    .trim()
    .toLowerCase();
  const slash = id.indexOf("/");
  if (slash <= 0) return id;
  const provider = id.slice(0, slash);
  const rest = id.slice(slash + 1);
  if (provider === "openai" || provider === "azure-openai") return rest;
  return id;
}

/**
 * OpenAI Chat Completions `reasoning_effort` (gpt-5*, o-series). Omit for gpt-4o*, Gemini, Workers AI, etc.
 * @see https://developers.openai.com/api/docs/guides/reasoning
 */
export function modelSupportsReasoningEffort(model: string): boolean {
  const id = normalizeOpenAiModelId(model);
  if (id.startsWith("@cf/") || id.includes("/")) return false;
  if (/^gpt-5/.test(id)) return true;
  if (/^o\d/.test(id)) {
    return !id.startsWith("o1-mini");
  }
  return false;
}
