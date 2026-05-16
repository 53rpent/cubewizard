import type { RgbaFrame } from "./types";

type HeifModule = {
  HeifDecoder: new () => {
    decode: (buf: Uint8Array) => Array<{
      get_width: () => number;
      get_height: () => number;
      display: (
        opts: { data: Uint8ClampedArray; width: number; height: number },
        cb: (out: { data: Uint8ClampedArray; width: number; height: number } | null) => void
      ) => void;
    }>;
  };
};

/**
 * Decode primary HEIC/HEIF image to RGBA8 using libheif-js (WASM bundle).
 * Dynamic import works in Vitest, esbuild Worker bundles, and Node ESM.
 */
export async function decodeHeicToRgba(bytes: Uint8Array): Promise<RgbaFrame> {
  const libheif = (await import(
    "libheif-js/wasm-bundle.js"
  )) as unknown as HeifModule;

  const decoder = new libheif.HeifDecoder();
  const data = decoder.decode(bytes);
  if (!data || data.length === 0) {
    throw new Error("heic_decode_empty");
  }
  const image = data[0]!;
  const width = image.get_width();
  const height = image.get_height();
  const rgba = new Uint8ClampedArray(width * height * 4);
  await new Promise<void>((resolve, reject) => {
    image.display({ data: rgba, width, height }, (displayData) => {
      if (!displayData) reject(new Error("heic_display_failed"));
      else resolve();
    });
  });
  return { width, height, data: rgba };
}
