import { afterEach, describe, expect, it, vi } from "vitest";
import consumer from "./hedron-consumer.js";

function createDbMock() {
  var runs = [];
  return {
    runs: runs,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              runs.push({ sql: sql, args: args });
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
    async batch() {
      return [];
    },
  };
}

describe("hedron consumer permanent failures", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("releases Hedron dedupe rows before acking permanent image failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not found", { status: 404 })),
    );
    var db = createDbMock();
    var message = {
      id: "msg-1",
      attempts: 1,
      body: {
        deck_image_uuid: "uuid-1",
        cube_id: "cube",
        upload_id: "hedron:uuid-1",
        image_url: "https://example.test/missing.jpg",
      },
      ack: vi.fn(),
      retry: vi.fn(),
    };

    await consumer.queue(
      { queue: "hedron", messages: [message] },
      {
        cubewizard_db: db,
        BUCKET: { put: vi.fn() },
        EVAL_QUEUE: { send: vi.fn() },
      },
    );

    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
    expect(db.runs).toEqual([
      {
        sql: "DELETE FROM hedron_synced_decks WHERE deck_image_uuid = ?",
        args: ["uuid-1"],
      },
    ]);
  });
});
