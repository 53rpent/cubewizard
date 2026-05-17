/**
 * Optional Vitest wrapper around {@link runGoldenEvalCli}.
 * Prefer `npm run golden:eval` (Node CLI). Use `npm run golden:eval:vitest` only if you want Vitest output.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { runGoldenEvalCli } from "./runGoldenEvalCli";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("golden eval harness", () => {
  it("runs eval consumer suite and writes scores", { timeout: 0 }, async () => {
    await runGoldenEvalCli({ repoRoot });
  });
});
