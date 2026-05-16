/**
 * Opt-in visual QA: decodes real photos and writes JPEG/PNG next to originals for inspection.
 *
 * PowerShell:
 *   $env:PIPELINE_QA_INPUT = "C:\path\to\your\deck-photos"
 *   $env:PIPELINE_QA_OUTPUT = "output\pipeline-qa"   # optional; default below cwd
 *   npm run test:pipeline:qa
 *
 * Outputs (per input file stem):
 *   - *.a-compatible.* — `prepareBytesForOpenAiVision` (JPEG/PNG pass-through)
 *   - *.b-resize-2048.* — decode → `resizeForVisionIfNeeded` → `rasterToOpenAiCompatible`
 *
 * `output/` is gitignored. Do not point INPUT at folders you cannot afford to re-read.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  decodeToRgba,
  prepareBytesForOpenAiVision,
  rasterToOpenAiCompatible,
  resizeForVisionIfNeeded,
  sniffImageFormat,
} from "./index";

const qaInput = process.env.PIPELINE_QA_INPUT?.trim();
const outputDir =
  process.env.PIPELINE_QA_OUTPUT?.trim() || join(process.cwd(), "output", "pipeline-qa");

describe.skipIf(!qaInput)("manual visual QA (PIPELINE_QA_INPUT)", () => {
  it("writes compatible + resized encodings for each file in the input directory", async () => {
    const inDir = qaInput as string;
    expect(statSync(inDir).isDirectory()).toBe(true);
    mkdirSync(outputDir, { recursive: true });

    const names = readdirSync(inDir).filter((n) => {
      const p = join(inDir, n);
      try {
        return statSync(p).isFile();
      } catch {
        return false;
      }
    });
    if (names.length === 0) {
      throw new Error(`no files in PIPELINE_QA_INPUT: ${inDir}`);
    }

    for (const name of names) {
      const bytes = new Uint8Array(readFileSync(join(inDir, name)));
      const fmt = sniffImageFormat(bytes);
      if (fmt === "unknown") {
        console.warn(`[pipeline-qa] skip unknown format: ${name}`);
        continue;
      }

      const stem = basename(name, extname(name)).replace(/[^\w.-]+/g, "_");

      const compat = await prepareBytesForOpenAiVision(bytes);
      const cExt = compat.mime === "image/png" ? "png" : "jpg";
      writeFileSync(join(outputDir, `${stem}.a-compatible.${cExt}`), compat.bytes);

      const frame = await decodeToRgba(bytes, fmt);
      const resized = resizeForVisionIfNeeded(frame);
      const vision = rasterToOpenAiCompatible(resized);
      const vExt = vision.mime === "image/png" ? "png" : "jpg";
      writeFileSync(join(outputDir, `${stem}.b-resize-2048.${vExt}`), vision.bytes);
    }
  });
});
