import { resizeToMaxSide } from "./transform";
import type { RgbaFrame } from "./types";

export type { ImageFormatHint, RgbaFrame } from "./types";
export { sniffImageFormat } from "./sniff";
export { decodeToRgba } from "./decode";
export { encodeJpeg, encodePng, frameHasTransparency } from "./encode";
export {
  combineClockwiseRotations,
  resizeToMaxSide,
  rotateClockwise,
} from "./transform";
export {
  prepareBytesForOpenAiVision,
  rasterToOpenAiCompatible,
  type VisionRasterBytes,
  type VisionRasterMime,
} from "./compatible";

/** Default max decode dimensions for vision (overridable via `CW_EVAL_MAX_IMAGE_SIDE`). */
export const DEFAULT_MAX_IMAGE_WIDTH = 2048;
export const DEFAULT_MAX_IMAGE_HEIGHT = 2048;

export function resizeForVisionIfNeeded(
  frame: RgbaFrame,
  maxW: number = DEFAULT_MAX_IMAGE_WIDTH,
  maxH: number = DEFAULT_MAX_IMAGE_HEIGHT
): RgbaFrame {
  return resizeToMaxSide(frame, maxW, maxH);
}
