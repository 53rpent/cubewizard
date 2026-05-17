import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { GoldenCaseDefinition, GoldenExpectedFile } from "./types";

const IMAGE_NAMES = ["image.jpg", "image.jpeg", "image.png", "image.webp", "image.heic"];

export const GOLDEN_CASES_DIR = "fixtures/eval-golden/cases";

function findImageInCaseDir(caseDir: string): string | null {
  for (const name of IMAGE_NAMES) {
    const p = join(caseDir, name);
    if (existsSync(p)) return p;
  }
  const entries = readdirSync(caseDir);
  const extRe = /\.(jpe?g|png|webp|heic)$/i;
  for (const name of entries) {
    if (!extRe.test(name)) continue;
    const p = join(caseDir, name);
    if (statSync(p).isFile()) return p;
  }
  return null;
}

function parseExpected(jsonPath: string): GoldenExpectedFile {
  const raw = JSON.parse(readFileSync(jsonPath, "utf8")) as unknown;
  if (!raw || typeof raw !== "object") {
    throw new Error(`${jsonPath}: expected.json must be an object`);
  }
  const o = raw as Record<string, unknown>;
  const names = o.expected_card_names;
  if (!Array.isArray(names) || names.length === 0) {
    throw new Error(`${jsonPath}: expected_card_names must be a non-empty array`);
  }
  for (const n of names) {
    if (typeof n !== "string" || !n.trim()) {
      throw new Error(`${jsonPath}: each expected_card_names entry must be a non-empty string`);
    }
  }
  return {
    description: typeof o.description === "string" ? o.description : undefined,
    cube_id: typeof o.cube_id === "string" ? o.cube_id : undefined,
    expected_card_names: names.map((s) => String(s).trim()),
    expected_count:
      typeof o.expected_count === "number" && Number.isFinite(o.expected_count)
        ? Math.floor(o.expected_count)
        : undefined,
    tags: Array.isArray(o.tags) ? o.tags.map(String) : undefined,
    notes: typeof o.notes === "string" ? o.notes : undefined,
  };
}

/** Discover runnable cases (folders with expected.json + an image). Skips `_` prefixes. */
export function loadGoldenCases(repoRoot: string): GoldenCaseDefinition[] {
  const root = join(repoRoot, GOLDEN_CASES_DIR);
  if (!existsSync(root)) return [];

  const cases: GoldenCaseDefinition[] = [];
  for (const name of readdirSync(root)) {
    if (name.startsWith("_")) continue;
    const dir = join(root, name);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    const expectedPath = join(dir, "expected.json");
    if (!existsSync(expectedPath)) continue;
    const image_path = findImageInCaseDir(dir);
    if (!image_path) continue;

    cases.push({
      case_id: name,
      dir,
      image_path,
      expected: parseExpected(expectedPath),
    });
  }

  cases.sort((a, b) => a.case_id.localeCompare(b.case_id));
  return cases;
}
