declare module "*.wasm" {
  /** Bundler (Wrangler / Vite) supplies a precompiled module for Workers; Vitest resolves the same shape. */
  const module: WebAssembly.Module;
  export default module;
}
