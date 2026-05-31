import { resizeToMaxSide } from "./transform";
import type { RgbaFrame } from "./types";

export {
  prepareBytesForOpenAiVision,
  rasterToOpenAiCompatible,
  type VisionRasterBytes,
  type VisionRasterMime,
} from "./compatible";
export { decodeToRgba } from "./decode";
export { encodeJpeg, encodePng, frameHasTransparency } from "./encode";
export { sniffImageFormat } from "./sniff";
export {
  combineClockwiseRotations,
  cropCenter,
  resizeToMaxSide,
  rotate90ClockwiseOnce,
  rotateClockwise,
} from "./transform";
export type { ImageFormatHint, RgbaFrame } from "./types";

/** Default max decode dimensions for vision (overridable via `CW_EVAL_MAX_IMAGE_SIDE`). */
export const DEFAULT_MAX_IMAGE_WIDTH = 3072;
export const DEFAULT_MAX_IMAGE_HEIGHT = 3072;

export function resizeForVisionIfNeeded(
  frame: RgbaFrame,
  maxW: number = DEFAULT_MAX_IMAGE_WIDTH,
  maxH: number = DEFAULT_MAX_IMAGE_HEIGHT,
): RgbaFrame {
  return resizeToMaxSide(frame, maxW, maxH);
}
