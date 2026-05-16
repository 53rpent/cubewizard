import { simd } from "wasm-feature-detect";
import webpDecWasm from "../../../vendor/jsquash-webp/webp_dec.wasm";
import webpEncWasm from "../../../vendor/jsquash-webp/webp_enc.wasm";
import webpEncSimdWasm from "../../../vendor/jsquash-webp/webp_enc_simd.wasm";

let encoderInit: Promise<void> | null = null;
let decoderInit: Promise<void> | null = null;

/**
 * Ensures `@jsquash/webp` encoder WASM is initialized.
 * Wasm is imported as `WebAssembly.Module` (Wrangler/esbuild at bundle time) so Workers never call `WebAssembly.compile` on bytes.
 */
export async function ensureJsquashWebpEncoderInit(): Promise<void> {
  if (encoderInit) return encoderInit;
  encoderInit = (async () => {
    const [{ init: initWebpEncode }] = await Promise.all([import("@jsquash/webp/encode")]);
    let useSimd = false;
    try {
      useSimd = await simd();
    } catch {
      useSimd = false;
    }
    const mod = useSimd ? webpEncSimdWasm : webpEncWasm;
    await initWebpEncode(mod);
  })();
  return encoderInit;
}

/**
 * Ensures `@jsquash/webp` decoder WASM is initialized (same precompiled-module pattern as the encoder).
 */
export async function ensureJsquashWebpDecoderInit(): Promise<void> {
  if (decoderInit) return decoderInit;
  decoderInit = (async () => {
    const [{ init: initWebpDecode }] = await Promise.all([import("@jsquash/webp/decode")]);
    await initWebpDecode(webpDecWasm);
  })();
  return decoderInit;
}
