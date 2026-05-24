/**
 * Randomly rotate each golden eval case image 0–3 times (90° CW per step).
 * Uses pipeline rotateClockwise (true rotation, not transpose).
 *
 * Usage: npm run golden:rotate-cases
 * Optional: GOLDEN_ROTATE_SEED=42 for reproducible randomness
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import UPNG from "upng-js";
import { decodeToRgba } from "../src/pipeline/images/decode";
import { encodeJpeg, encodePng } from "../src/pipeline/images/encode";
import { sniffImageFormat } from "../src/pipeline/images/sniff";
import type { ImageFormatHint, RgbaFrame } from "../src/pipeline/images/types";
import { rotateClockwise } from "../src/pipeline/images/transform";

const repoRoot = join(fileURLToPath(import.meta.url), "..", "..");
const casesRoot = join(repoRoot, "fixtures/eval-golden/cases");

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const seedRaw = process.env.GOLDEN_ROTATE_SEED;
const rand =
  seedRaw !== undefined && seedRaw !== ""
    ? mulberry32(parseInt(seedRaw, 10) || 0)
    : Math.random;

function decodePng(bytes: Uint8Array): RgbaFrame {
  const copy = Uint8Array.from(bytes);
  const png = UPNG.decode(copy.buffer);
  if (png.error) throw new Error(String(png.error));
  if (png.width == null || png.height == null) throw new Error("png_decode_missing_dimensions");
  const bufs = UPNG.toRGBA8(png);
  if (!bufs?.length) throw new Error("png_to_rgba_empty");
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(bufs[0]) };
}

async function decodeImage(bytes: Uint8Array, hint: ImageFormatHint): Promise<RgbaFrame> {
  const fmt = hint !== "unknown" ? hint : sniffImageFormat(bytes);
  if (fmt === "jpeg") return decodeToRgba(bytes, "jpeg");
  if (fmt === "png") return decodePng(bytes);
  throw new Error(`unsupported_format:${fmt}`);
}

function imageFileInCase(dir: string): { path: string; format: ImageFormatHint } | null {
  for (const name of ["image.jpg", "image.jpeg", "image.png"]) {
    const p = join(dir, name);
    if (!existsSync(p)) continue;
    return { path: p, format: name.endsWith(".png") ? "png" : "jpeg" };
  }
  return null;
}

async function rotateCaseImage(
  caseId: string,
  imagePath: string,
  hint: ImageFormatHint
): Promise<number> {
  const steps = Math.floor(rand() * 4) as 0 | 1 | 2 | 3;
  const bytes = new Uint8Array(readFileSync(imagePath));
  const fmt = hint !== "unknown" ? hint : sniffImageFormat(bytes);

  let frame = await decodeImage(bytes, fmt);
  if (steps > 0) {
    frame = rotateClockwise(frame, steps * 90);
  }

  const out = fmt === "png" ? encodePng(frame) : encodeJpeg(frame, 95);
  writeFileSync(imagePath, out);
  return steps;
}

async function main(): Promise<void> {
  const caseDirs = readdirSync(casesRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
    .map((d) => d.name)
    .sort();

  if (!caseDirs.length) {
    console.error(`No cases under ${casesRoot}`);
    process.exit(1);
  }

  console.log(`Rotating golden case images (${caseDirs.length} cases, 0–3 × 90° CW each)…`);
  if (seedRaw) {
    console.log(`GOLDEN_ROTATE_SEED=${seedRaw}`);
  }

  for (const caseId of caseDirs) {
    const dir = join(casesRoot, caseId);
    const img = imageFileInCase(dir);
    if (!img) {
      console.warn(`  skip ${caseId}: no image.jpg/png`);
      continue;
    }
    const steps = await rotateCaseImage(caseId, img.path, img.format);
    console.log(`  ${caseId}: ${steps} step(s) → ${steps * 90}° CW  (${img.path})`);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
