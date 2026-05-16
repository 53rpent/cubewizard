import type { EnrichCardListResult, EnrichedDeckCardRow, ScryfallCardJson } from "./types";
import { mapScryfallCardToRow, stubDeckCardRowForName } from "./types";
import { scryfallGlobalThrottle } from "./globalThrottle";

const DEFAULT_BASE = "https://api.scryfall.com";
const NAMED_TIMEOUT_MS = 12_000;
const FUZZY_CONCURRENCY = 6;
const SCRYFALL_429_MAX_ATTEMPTS = 4;

export interface ScryfallClientOptions {
  /** Scryfall asks for a descriptive User-Agent. */
  userAgent?: string;
  /** Collection POST batch size (max 75). */
  collectionBatchSize?: number;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

/** Eval consumer client; spacing is enforced by {@link scryfallGlobalThrottle}. */
export function createEvalScryfallClient(opts: ScryfallClientOptions = {}): ScryfallClient {
  return new ScryfallClient(opts);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeCardNames(cardNames: string[]): string[] {
  return cardNames.map((n) => String(n ?? "").trim()).filter(Boolean);
}

function buildNamePool(data: ScryfallCardJson[]): Map<string, ScryfallCardJson[]> {
  const pool = new Map<string, ScryfallCardJson[]>();
  for (const card of data) {
    const key = String(card.name ?? "").toLowerCase();
    if (!key) continue;
    const list = pool.get(key) ?? [];
    list.push(card);
    pool.set(key, list);
  }
  return pool;
}

function takeFromNamePool(pool: Map<string, ScryfallCardJson[]>, reqName: string): ScryfallCardJson | null {
  const key = reqName.toLowerCase();
  const list = pool.get(key);
  if (!list?.length) return null;
  return list.shift() ?? null;
}

/** HTTP Scryfall client; collection + fuzzy resolution matches `src/worker.js`. */
export class ScryfallClient {
  private readonly userAgent: string;
  private readonly rateLimitMs: number;
  private readonly batchSize: number;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(opts: ScryfallClientOptions = {}) {
    this.userAgent = opts.userAgent ?? "CubeWizard-Eval/1.0";
    this.rateLimitMs = 0;
    this.batchSize = Math.min(75, Math.max(1, opts.collectionBatchSize ?? 75));
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
  }

  private scryfallHeaders(): Record<string, string> {
    return {
      Accept: "application/json",
      "User-Agent": this.userAgent,
    };
  }

  private async throttle(): Promise<void> {
    await scryfallGlobalThrottle();
    if (this.rateLimitMs > 0) await sleep(this.rateLimitMs);
  }

  private async fetchScryfall(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    let last: Response | null = null;
    for (let attempt = 0; attempt < SCRYFALL_429_MAX_ATTEMPTS; attempt++) {
      await this.throttle();
      last = await this.fetchImpl(input, init);
      if (last.status !== 429) return last;
      const retrySec = parseInt(last.headers.get("retry-after") || "1", 10);
      await sleep(Math.min(5000, Math.max(500, (Number.isFinite(retrySec) ? retrySec : 1) * 1000)));
    }
    return last!;
  }

  async searchCardByName(cardName: string): Promise<ScryfallCardJson | null> {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), NAMED_TIMEOUT_MS);
    try {
      const u = new URL(`${this.baseUrl}/cards/named`);
      u.searchParams.set("fuzzy", cardName);
      const res = await this.fetchScryfall(u, {
        headers: this.scryfallHeaders(),
        signal: ctrl.signal,
      });
      if (res.status === 404) return null;
      if (!res.ok) {
        console.error("scryfall_named_error", cardName, res.status);
        return null;
      }
      return (await res.json()) as ScryfallCardJson;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("scryfall_named_fetch_failed", cardName, msg);
      return null;
    } finally {
      clearTimeout(tid);
    }
  }

  private async postCollection(
    identifiers: { name: string }[]
  ): Promise<{ data: ScryfallCardJson[] }> {
    const res = await this.fetchScryfall(`${this.baseUrl}/cards/collection`, {
      method: "POST",
      headers: {
        ...this.scryfallHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ identifiers }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`collection ${res.status}: ${errText.slice(0, 160)}`);
    }
    const json = (await res.json()) as { data?: ScryfallCardJson[] };
    return { data: json.data ?? [] };
  }

  /**
   * Resolve one Scryfall row per requested name (order preserved), using batched
   * `/cards/collection` plus parallel fuzzy `/cards/named` for misses.
   */
  async resolveCardNamesInOrder(cardNames: string[]): Promise<{
    rows: EnrichedDeckCardRow[];
    notFoundNames: string[];
  }> {
    const trimmed = normalizeCardNames(cardNames);
    if (!trimmed.length) {
      return { rows: [], notFoundNames: [] };
    }

    const foundRows: (EnrichedDeckCardRow | undefined)[] = new Array(trimmed.length);
    const fuzzyQueue: { index: number; name: string }[] = [];

    for (let start = 0; start < trimmed.length; start += this.batchSize) {
      const chunk = trimmed.slice(start, start + this.batchSize);
      const identifiers = chunk.map((name) => ({ name }));

      try {
        const { data } = await this.postCollection(identifiers);
        const pool = buildNamePool(data);
        for (let i = 0; i < chunk.length; i++) {
          const globalIdx = start + i;
          const reqName = chunk[i]!;
          const card = takeFromNamePool(pool, reqName);
          if (card) {
            foundRows[globalIdx] = mapScryfallCardToRow(card);
          } else {
            fuzzyQueue.push({ index: globalIdx, name: reqName });
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("scryfall_collection_batch_failed", msg);
        for (let i = 0; i < chunk.length; i++) {
          fuzzyQueue.push({ index: start + i, name: chunk[i]! });
        }
      }
    }

    for (let b = 0; b < fuzzyQueue.length; b += FUZZY_CONCURRENCY) {
      const slice = fuzzyQueue.slice(b, b + FUZZY_CONCURRENCY);
      await Promise.all(
        slice.map(async (q) => {
          const card = await this.searchCardByName(q.name);
          if (card) {
            foundRows[q.index] = mapScryfallCardToRow(card);
          }
        })
      );
    }

    const rows: EnrichedDeckCardRow[] = [];
    const notFoundNames: string[] = [];
    for (let i = 0; i < trimmed.length; i++) {
      const row = foundRows[i];
      if (row?.scryfall_uri) {
        rows.push(row);
      } else {
        rows.push(stubDeckCardRowForName(trimmed[i]!));
        notFoundNames.push(trimmed[i]!);
      }
    }

    return { rows, notFoundNames };
  }

  async enrichCardList(cardNames: string[]): Promise<EnrichCardListResult> {
    const trimmed = normalizeCardNames(cardNames);
    const { rows, notFoundNames } = await this.resolveCardNamesInOrder(trimmed);
    const totalFound = rows.filter((r) => Boolean(r.scryfall_uri)).length;

    return {
      cards: rows,
      total_requested: trimmed.length,
      total_found: totalFound,
      not_found: notFoundNames,
      success_rate: trimmed.length ? totalFound / trimmed.length : 0,
    };
  }
}
