import type { R2BucketGetPut } from "../orchestrator/runEvalTask";

/** In-memory R2 for golden staging + deck image uploads. */
export function createMockR2Bucket(): R2BucketGetPut {
  const objects = new Map<string, Uint8Array>();

  return {
    async get(key: string) {
      const data = objects.get(key);
      if (!data) return null;
      return {
        async arrayBuffer() {
          const copy = new Uint8Array(data.byteLength);
          copy.set(data);
          return copy.buffer;
        },
      };
    },
    async put(key: string, value: Uint8Array | ReadableStream) {
      if (value instanceof ReadableStream) {
        const reader = value.getReader();
        const chunks: Uint8Array[] = [];
        for (;;) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          if (chunk) chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
        }
        const total = chunks.reduce((n, c) => n + c.byteLength, 0);
        const merged = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) {
          merged.set(c, off);
          off += c.byteLength;
        }
        objects.set(key, merged);
        return;
      }
      objects.set(key, value);
    },
  };
}
