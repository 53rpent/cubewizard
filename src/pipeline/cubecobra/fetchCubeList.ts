const CUBECOBRA_JSON = "https://cubecobra.com/cube/api/cubeJSON/";

export async function fetchCubeCobraMainboardNames(
  cubeId: string,
  opts?: {
    fetchImpl?: typeof fetch;
    userAgent?: string;
    timeoutMs?: number;
    maxCards?: number;
  }
): Promise<string[] | null> {
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
    if (!res.ok) return null;
    const data = (await res.json()) as {
      cards?: { mainboard?: Array<Record<string, unknown>> };
    };
    const mainboard = data.cards?.mainboard;
    if (!Array.isArray(mainboard)) return null;

    const names: string[] = [];
    for (const card of mainboard) {
      if (!card || typeof card !== "object") continue;
      const details = card.details as { name?: string } | undefined;
      if (details && typeof details.name === "string") {
        names.push(details.name);
      } else if (typeof card.name === "string") {
        names.push(card.name);
      }
    }

    const unique = [...new Set(names)];
    unique.sort();
    return unique.slice(0, maxCards);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
