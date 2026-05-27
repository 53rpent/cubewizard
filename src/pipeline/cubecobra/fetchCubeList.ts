import { augmentCubeListWithAnalyticsExcluded } from "../cards/augmentCubeList";

const CUBECOBRA_JSON = "https://cubecobra.com/cube/api/cubeJSON/";

function cardNameFromCubeCobraEntry(card: Record<string, unknown>): string | null {
  const details = card.details as { name?: string } | undefined;
  if (details && typeof details.name === "string") return details.name;
  if (typeof card.name === "string") return card.name;
  return null;
}

function namesFromMainboard(mainboard: Array<Record<string, unknown>>): string[] {
  const names: string[] = [];
  for (const card of mainboard) {
    if (!card || typeof card !== "object") continue;
    const name = cardNameFromCubeCobraEntry(card);
    if (name) names.push(name);
  }
  return names;
}

export async function fetchCubeCobraMainboardNames(
  cubeId: string,
  opts?: {
    fetchImpl?: typeof fetch;
    userAgent?: string;
    timeoutMs?: number;
    maxCards?: number;
  },
): Promise<string[]> {
  const fetchImpl = opts?.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const ua = opts?.userAgent ?? "CubeWizard/1.0";
  const timeoutMs = opts?.timeoutMs ?? 10_000;
  const maxCards = opts?.maxCards ?? 1000;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = CUBECOBRA_JSON + encodeURIComponent(cubeId);
    const res = await fetchImpl(url, {
      headers: { "User-Agent": ua },
      signal: controller.signal,
    });
    if (!res.ok) return augmentCubeListWithAnalyticsExcluded(null);
    const data = (await res.json()) as {
      cards?: { mainboard?: Array<Record<string, unknown>> };
    };
    const mainboard = data.cards?.mainboard;
    if (!Array.isArray(mainboard)) return augmentCubeListWithAnalyticsExcluded(null);

    const unique = [...new Set(namesFromMainboard(mainboard))];
    unique.sort();
    return augmentCubeListWithAnalyticsExcluded(unique.slice(0, maxCards));
  } catch {
    return augmentCubeListWithAnalyticsExcluded(null);
  } finally {
    clearTimeout(t);
  }
}
