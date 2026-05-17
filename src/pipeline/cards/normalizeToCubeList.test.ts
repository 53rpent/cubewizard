import { describe, expect, it } from "vitest";
import { normalizeNamesToCubeList } from "./normalizeToCubeList";

describe("normalizeNamesToCubeList", () => {
  const cube = ["Jace, The Mind Sculptor", "Plains", "Lightning Bolt", "Damn"];

  it("maps fuzzy near-misses to cube spellings", () => {
    const out = normalizeNamesToCubeList(
      ["Jace, the Mind Sculptor", "Plains (basic land)"],
      cube
    );
    expect(out).toContain("Jace, The Mind Sculptor");
    expect(out).toContain("Plains");
  });

  it("drops names with no cube match at threshold", () => {
    const out = normalizeNamesToCubeList(["Harmonize", "Terramorph"], cube);
    expect(out).toEqual([]);
  });

  it("dedupes by normalized cube spelling", () => {
    const out = normalizeNamesToCubeList(["Plains", "plains", "PLAINS"], cube);
    expect(out).toEqual(["Plains"]);
  });

  it("returns input unchanged when cube list empty", () => {
    expect(normalizeNamesToCubeList(["A", "B"], [])).toEqual(["A", "B"]);
  });
});
