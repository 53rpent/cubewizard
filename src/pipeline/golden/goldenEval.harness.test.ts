/**
 * Optional Vitest wrapper around {@link runGoldenEvalCli}.
 * `npm run golden:eval` runs this via Vitest (live OpenAI). Comparison vs baseline is printed by the CLI.
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
