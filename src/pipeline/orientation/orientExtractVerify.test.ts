import { describe, expect, it } from "vitest";
import {
  appendRotationScores,
  bestRotationFromHistory,
  bestRotationFromRound,
  emptyRotationScoreHistory,
  type OrientLightExtractScore,
  scoreLightExtractionResult,
} from "./orientExtractVerify";

function score(n: number): OrientLightExtractScore {
  return {
    score: n,
    raw_name_count: n,
    cube_matched_count: n,
    confidence_level: "medium",
  };
}

describe("scoreLightExtractionResult", () => {
  it("weights cube matches and confidence", () => {
    const withCube = scoreLightExtractionResult(
      { card_names: ["Lightning Bolt", "Island"], confidence_level: "high" },
      ["Lightning Bolt", "Island", "Forest"],
    );
    expect(withCube.cube_matched_count).toBe(2);
    expect(withCube.score).toBeGreaterThan(40);

    const noCube = scoreLightExtractionResult({ card_names: ["Lightning Bolt"], confidence_level: "low" }, ["Island"]);
    expect(noCube.cube_matched_count).toBe(0);
    expect(noCube.score).toBeLessThan(withCube.score);
  });
});

describe("bestRotationFromRound", () => {
  it("picks the highest score in one round", () => {
    const round = {
      0: score(10),
      90: score(50),
      180: score(30),
      270: score(20),
    } as const;
    expect(bestRotationFromRound(round)).toEqual({ rotation: 90, bestScore: 50 });
  });
});

describe("bestRotationFromHistory", () => {
  it("uses peak score across two rounds per angle", () => {
    const history = emptyRotationScoreHistory();
    appendRotationScores(history, {
      0: score(100),
      90: score(10),
      180: score(5),
      270: score(5),
    });
    appendRotationScores(history, {
      0: score(20),
      90: score(80),
      180: score(5),
      270: score(5),
    });
    expect(bestRotationFromHistory(history)).toEqual({ rotation: 0, bestScore: 100 });
  });
});
