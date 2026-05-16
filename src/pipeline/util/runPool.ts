/**
 * Run async work over `items` with at most `concurrency` tasks in flight.
 */
export async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  if (!items.length) return;
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      await fn(items[i]!, i);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
}
