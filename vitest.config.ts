import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

/**
 * Wrangler turns `.wasm` imports into precompiled `WebAssembly.Module` for Workers.
 * Vitest (Vite) does not load bare `.wasm` as modules in Node without a plugin; we compile from disk here (allowed in Node).
 */
function wasmPrecompiledForVitest(): Plugin {
  return {
    name: "wasm-precompiled-for-node-tests",
    enforce: "pre",
    load(id) {
      const clean = id.split("?")[0]!;
      const norm = clean.replace(/\\/g, "/");
      if (
        !norm.endsWith("/vendor/jsquash-webp/webp_dec.wasm") &&
        !norm.endsWith("/vendor/jsquash-webp/webp_enc.wasm") &&
        !norm.endsWith("/vendor/jsquash-webp/webp_enc_simd.wasm")
      ) {
        return null;
      }
      return `import { readFileSync } from "node:fs";
const _b = readFileSync(${JSON.stringify(clean)});
export default new WebAssembly.Module(new Uint8Array(_b));
`;
    },
  };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  plugins: [wasmPrecompiledForVitest()],
  test: {
    environment: "node",
    include: ["src/pipeline/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/goldenEval.harness.test.ts"],
    testTimeout: 60_000,
  },
});
