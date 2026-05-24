import { GOLDEN_FUZZY_MATCH_THRESHOLD } from "../golden/metrics";
import { nameSimilarity, normalizeCardName } from "../golden/normalizeCardName";

function preprocessExtractedName(name: string): string {
  return name.replace(/\s*\(basic land\)\s*/gi, "").trim();
}

function bestCubeMatchAttempt(
  name: string,
  cubeList: string[]
): { cubeName: string; similarity: number } | null {
  let best: string | null = null;
  let bestSim = 0;
  for (const cubeName of cubeList) {
    const sim = nameSimilarity(name, cubeName);
    if (sim > bestSim) {
      bestSim = sim;
      best = cubeName;
    }
  }
  if (!best) return null;
  return { cubeName: best, similarity: bestSim };
}

function bestCubeMatch(
  name: string,
  cubeList: string[],
  threshold: number
): { cubeName: string; similarity: number } | null {
  const attempt = bestCubeMatchAttempt(name, cubeList);
  if (!attempt || attempt.similarity < threshold) return null;
  return attempt;
}

/** TEMP: remove when debugging cube fuzzy-match drops is done. */
function logDroppedCubeMatch(
  extracted: string,
  threshold: number,
  attempt: { cubeName: string; similarity: number } | null
): void {
  if (!attempt) {
    console.log("cube_fuzzy_match_dropped", {
      extracted,
      reason: "no_cube_candidate",
      threshold,
    });
    return;
  }
  console.log("cube_fuzzy_match_dropped", {
    extracted,
    reason: "below_threshold",
    threshold,
    best_cube_name: attempt.cubeName,
    best_similarity: Number(attempt.similarity.toFixed(4)),
  });
}

/**
 * Fuzzy-map extracted names to cube list spellings (golden metrics threshold).
 * When cube list is non-empty, drops names with no match at or above threshold.
 */
export function normalizeNamesToCubeList(
  names: string[],
  cubeList: string[],
  threshold = GOLDEN_FUZZY_MATCH_THRESHOLD
): string[] {
  if (!cubeList.length) return names;

  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of names) {
    const trimmed = preprocessExtractedName(raw.trim());
    if (!trimmed) continue;

    const attempt = bestCubeMatchAttempt(trimmed, cubeList);
    const matched =
      attempt && attempt.similarity >= threshold
        ? attempt
        : null;
    if (!matched) {
      logDroppedCubeMatch(trimmed, threshold, attempt);
      continue;
    }

    const key = normalizeCardName(matched.cubeName);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(matched.cubeName);
  }

  return out;
}
