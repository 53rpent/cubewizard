import { describe, expect, it } from "vitest";
import {
  deckImageUuidFromEvalTaskBody,
  deckImageUuidFromHedronUploadId,
  ensureHedronSyncedDeck,
  hedronSyncedDeckR2Prefix,
  releaseHedronSyncedDeck,
} from "./hedronSyncedDeckRepo";

function stubStmt(runResult: unknown = {}) {
  return {
    run: async () => runResult,
    first: async () => null,
  };
}

describe("hedronSyncedDeckRepo", () => {
  it("parses deck uuid from hedron upload_id", () => {
    expect(deckImageUuidFromHedronUploadId("hedron:abc-123")).toBe("abc-123");
    expect(deckImageUuidFromHedronUploadId("reprocess:hedron:abc-123:00000000-0000-4000-8000-000000000000")).toBe(
      "abc-123",
    );
    expect(deckImageUuidFromHedronUploadId("uploads/foo")).toBeNull();
  });

  it("parses from eval task body", () => {
    expect(deckImageUuidFromEvalTaskBody({ upload_id: "hedron:draft-deck-1", cube_id: "c1" })).toBe("draft-deck-1");
    expect(deckImageUuidFromEvalTaskBody({ upload_id: "manual-upload-1" })).toBeNull();
  });

  it("builds hedron r2 prefix", () => {
    expect(hedronSyncedDeckR2Prefix("abc-123")).toBe("hedron/abc-123");
  });

  it("ensureHedronSyncedDeck inserts dedupe row", async () => {
    const runs: unknown[][] = [];
    const db = {
      prepare(_sql: string) {
        return {
          bind(...args: unknown[]) {
            runs.push(args);
            return stubStmt();
          },
        };
      },
      batch: async () => [],
    };
    await ensureHedronSyncedDeck(db, "cube1", "hedron:uuid-1", { draftId: "d1", playerId: "p1" });
    expect(runs).toHaveLength(1);
    expect(runs[0]?.[0]).toBe("uuid-1");
    expect(runs[0]?.[1]).toBe("cube1");
    expect(runs[0]?.[2]).toBe("d1");
    expect(runs[0]?.[3]).toBe("p1");
    expect(runs[0]?.[4]).toBe("hedron/uuid-1");
  });

  it("releaseHedronSyncedDeck deletes hedron_synced_decks row", async () => {
    const db = {
      prepare(sql: string) {
        expect(sql).toContain("DELETE FROM hedron_synced_decks");
        return {
          bind(uuid: string) {
            expect(uuid).toBe("uuid-1");
            return stubStmt({ meta: { changes: 1 } });
          },
        };
      },
      batch: async () => [],
    };
    await expect(releaseHedronSyncedDeck(db, "uuid-1")).resolves.toBe(1);
  });

  it("ensureHedronSyncedDeck no-ops for manual uploads", async () => {
    let called = false;
    const db = {
      prepare() {
        called = true;
        return { bind: () => stubStmt() };
      },
      batch: async () => [],
    };
    await ensureHedronSyncedDeck(db, "cube1", "manual-upload");
    expect(called).toBe(false);
  });
});
