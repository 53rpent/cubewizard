/** Normalize card names for golden-set comparison (not Scryfall canonicalization). */

export function normalizeCardName(name: string): string {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[’‘`]/g, "'")
    .replace(/\s*,\s*/g, ", ");
}

export function normalizeCardNameSet(names: string[]): Set<string> {
  const out = new Set<string>();
  for (const n of names) {
    const k = normalizeCardName(n);
    if (k) out.add(k);
  }
  return out;
}

/** Levenshtein ratio in [0, 1] (1 = identical). */
export function nameSimilarity(a: string, b: string): number {
  const s = normalizeCardName(a);
  const t = normalizeCardName(b);
  if (s === t) return 1;
  if (!s.length || !t.length) return 0;
  const d = levenshtein(s, t);
  return 1 - d / Math.max(s.length, t.length);
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + cost);
      prev = tmp;
    }
  }
  return dp[n]!;
}
