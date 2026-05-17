import { ANALYTICS_EXCLUDED_CARD_NAMES } from "../../shared/analyticsExcludedCardNames.js";

export { ANALYTICS_EXCLUDED_CARD_NAMES };

/**
 * Ensures basic lands (analytics-excluded) are on the cube list used for OpenAI prompts
 * and Levenshtein post-processing — CubeCobra often omits them from the JSON export.
 */
export function augmentCubeListWithAnalyticsExcluded(cubeList: string[] | null): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const name of cubeList ?? []) {
    const trimmed = String(name ?? "").trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }

  for (const name of ANALYTICS_EXCLUDED_CARD_NAMES) {
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }

  return out;
}
