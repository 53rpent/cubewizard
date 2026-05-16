/** RGBA8 row-major, length = width * height * 4 */
export interface RgbaFrame {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export type ImageFormatHint =
  | "jpeg"
  | "png"
  | "webp"
  | "heic"
  | "unknown";
