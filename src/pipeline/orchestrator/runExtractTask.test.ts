import { beforeEach, describe, expect, it, vi } from "vitest";
import { runExtractTask } from "./runExtractTask";

const mocks = vi.hoisted(() => ({
  executeDeckWritePlan: vi.fn(),
  fetchCubeCobraMainboardNames: vi.fn(),
  decodeToRgba: vi.fn(),
  extractCardNamesFromRgba: vi.fn(),
  createEvalScryfallClient: vi.fn(),
  uploadOrientedThumb: vi.fn(),
}));

vi.mock("../d1/executeDeckWritePlan", () => ({
  executeDeckWritePlan: mocks.executeDeckWritePlan,
}));

vi.mock("../cubecobra/fetchCubeList", () => ({
  fetchCubeCobraMainboardNames: mocks.fetchCubeCobraMainboardNames,
}));

vi.mock("../evalEnv/isLocalEvalEnv", () => ({
  isLocalEvalEnv: () => true,
}));

vi.mock("../images/decode", () => ({
  decodeToRgba: mocks.decodeToRgba,
}));

vi.mock("../openai/extractCardNames", () => ({
  extractCardNamesFromRgba: mocks.extractCardNamesFromRgba,
}));

vi.mock("../scryfall/client", () => ({
  createEvalScryfallClient: mocks.createEvalScryfallClient,
}));

vi.mock("./uploadOriented", () => ({
  uploadOrientedThumb: mocks.uploadOrientedThumb,
}));

type DbCall = {
  type: "bind" | "run" | "batch";
  sql?: string;
  args?: unknown[];
  stmts?: unknown[];
};

function createDbMock() {
  const calls: DbCall[] = [];
  return {
    calls,
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          calls.push({ type: "bind", sql, args });
          return {
            sql,
            args,
            async run() {
              calls.push({ type: "run", sql, args });
              return { success: true, meta: { changes: 1 } };
            },
            async first<T = unknown>() {
              return null as T | null;
            },
          };
        },
      };
    },
    async batch(stmts: unknown[]) {
      calls.push({ type: "batch", stmts });
      return stmts.map(() => ({ meta: { changes: 1 } }));
    },
  };
}

describe("runExtractTask replacement cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchCubeCobraMainboardNames.mockResolvedValue([]);
    mocks.decodeToRgba.mockResolvedValue({ width: 1, height: 1, data: new Uint8ClampedArray(4) });
    mocks.extractCardNamesFromRgba.mockResolvedValue(["Lightning Bolt"]);
    mocks.createEvalScryfallClient.mockReturnValue({
      enrichCardList: vi.fn(async () => ({
        cards: [],
        total_requested: 1,
        total_found: 1,
        not_found: [],
        success_rate: 1,
      })),
    });
    mocks.uploadOrientedThumb.mockResolvedValue({ thumbKey: "thumbs/cube/new-img.webp" });
    mocks.executeDeckWritePlan.mockResolvedValue({
      success: true,
      duplicate: false,
      deckId: 456,
      imageId: "new-img",
    });
  });

  it("deletes the replaced deck only after writing replacement auxiliary keys", async () => {
    const db = createDbMock();
    const env = {
      CWW_ENV: "local",
      OPENAI_API_KEY: "test-key",
      cubewizard_db: db,
      DECK_IMAGES_BLOB: {
        get: vi.fn(async () => ({
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        })),
      },
    };

    await runExtractTask(
      {
        upload_id: "reprocess:123:uuid-1",
        schema_version: 2,
        cube_id: "cube",
        image_id: "new-img",
        oriented_image_r2_key: "oriented/cube/new-img.jpg",
        processing_timestamp: "reprocess:123:uuid-1",
        pilot_name: "owner",
        record_logged: "2026-06-06T00:00:00.000Z",
        replace_deck_id: 123,
      },
      env as never,
    );

    const auxBatchIndex = db.calls.findIndex(
      (call) =>
        call.type === "batch" &&
        call.stmts?.some((stmt) => (stmt as { sql?: string }).sql?.indexOf("oriented_image_r2_key") !== -1),
    );
    const deleteBatchIndex = db.calls.findIndex(
      (call) =>
        call.type === "batch" &&
        call.stmts?.some((stmt) => (stmt as { sql?: string }).sql?.indexOf("DELETE FROM decks") !== -1),
    );
    const markDoneIndex = db.calls.findIndex(
      (call) => call.type === "run" && call.sql?.indexOf("UPDATE processing_jobs SET status = 'done'") !== -1,
    );

    expect(auxBatchIndex).toBeGreaterThanOrEqual(0);
    expect(deleteBatchIndex).toBeGreaterThan(auxBatchIndex);
    expect(markDoneIndex).toBeGreaterThan(deleteBatchIndex);
    expect(
      db.calls.some(
        (call) =>
          call.type === "batch" &&
          call.stmts?.some(
            (stmt) =>
              (stmt as { sql?: string; args?: unknown[] }).sql?.indexOf("DELETE FROM decks") !== -1 &&
              (stmt as { args?: unknown[] }).args?.[0] === 123 &&
              (stmt as { args?: unknown[] }).args?.[1] === "cube",
          ),
      ),
    ).toBe(true);
  });
});
