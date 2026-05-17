import { describe, expect, it } from "vitest";
import { augmentCubeListWithAnalyticsExcluded } from "./augmentCubeList";

describe("augmentCubeListWithAnalyticsExcluded", () => {
  it("appends basic lands missing from CubeCobra export", () => {
    const out = augmentCubeListWithAnalyticsExcluded(["Lightning Bolt"]);
    expect(out).toContain("Lightning Bolt");
    expect(out).toContain("Plains");
    expect(out).toContain("Snow-Covered Forest");
  });

  it("does not duplicate names already on the list", () => {
    const out = augmentCubeListWithAnalyticsExcluded(["Plains", "Island", "Damn"]);
    expect(out.filter((n) => n === "Plains")).toHaveLength(1);
    expect(out.filter((n) => n === "Island")).toHaveLength(1);
  });

  it("returns basics when cube fetch yielded null", () => {
    const out = augmentCubeListWithAnalyticsExcluded(null);
    expect(out).toContain("Mountain");
    expect(out.length).toBeGreaterThanOrEqual(10);
  });
});
