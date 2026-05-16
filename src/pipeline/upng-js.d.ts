declare module "upng-js" {
  interface PngDecoded {
    width: number;
    height: number;
    data: ArrayBuffer;
    error?: unknown;
  }

  const UPNG: {
    decode(buf: ArrayBuffer): PngDecoded;
    toRGBA8(decoded: PngDecoded): ArrayBuffer[];
    encode(
      bufs: ArrayBufferView[],
      w: number,
      h: number,
      ps?: number,
      dels?: unknown,
      forbidPlte?: unknown
    ): ArrayBuffer;
  };
  export default UPNG;
}
