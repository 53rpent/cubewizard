import { describe, expect, it } from "vitest";
import {
  deckImageUuidFromEvalTaskBody,
  deckImageUuidFromHedronUploadId,
} from "./hedronSyncedDeckRepo";

describe("hedronSyncedDeckRepo", () => {
  it("parses deck uuid from hedron upload_id", () => {
    expect(deckImageUuidFromHedronUploadId("hedron:abc-123")).toBe("abc-123");
    expect(deckImageUuidFromHedronUploadId("uploads/foo")).toBeNull();
  });

  it("parses from eval task body", () => {
    expect(
      deckImageUuidFromEvalTaskBody({ upload_id: "hedron:draft-deck-1", cube_id: "c1" })
    ).toBe("draft-deck-1");
    expect(deckImageUuidFromEvalTaskBody({ upload_id: "manual-upload-1" })).toBeNull();
  });
});
