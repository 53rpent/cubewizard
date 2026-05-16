/**
 * Process-wide spacing for Scryfall HTTP so parallel eval tasks share one budget
 * (~10 requests/sec average per Scryfall guidance).
 */

let minIntervalMs = 100;
let chain: Promise<void> = Promise.resolve();
let lastRequestAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Configure minimum gap between Scryfall HTTP calls in this isolate.
 * `parallelConsumerInstances` should match queue `max_concurrency` so N isolates × (10/N) req/s ≈ 10 req/s total.
 */
export function configureScryfallGlobalThrottle(parallelConsumerInstances: number): void {
  const n = Math.max(1, Math.min(10, Math.floor(parallelConsumerInstances) || 1));
  minIntervalMs = Math.max(100, Math.ceil((1000 / 10) * n));
}

export function getScryfallMinIntervalMs(): number {
  return minIntervalMs;
}

/** Await before each Scryfall HTTP request (serialized spacing across parallel eval work). */
export async function scryfallGlobalThrottle(): Promise<void> {
  const prev = chain;
  let release!: () => void;
  chain = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prev;
  try {
    const now = Date.now();
    const wait = Math.max(0, lastRequestAt + minIntervalMs - now);
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
  } finally {
    release();
  }
}

/** Reset for unit tests. */
export function resetScryfallGlobalThrottleForTests(): void {
  minIntervalMs = 100;
  chain = Promise.resolve();
  lastRequestAt = 0;
}
