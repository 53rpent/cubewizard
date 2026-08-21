import { afterEach, describe, expect, it, vi } from "vitest";
import consumer from "./hedron-consumer.js";

function createDbMock() {
  var calls = [];
  return {
    calls: calls,
    prepare(sql) {
      return {
        bind(...args) {
          calls.push({ type: "bind", sql: sql, args: args });
          return {
            sql: sql,
            args: args,
            async first() {
              return null;
            },
            async run() {
              calls.push({ type: "run", sql: sql, args: args });
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
    vi.restoreAllMocks();
  });

  it("releases Hedron dedupe and records failed processing job before acking poison messages", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("missing", { status: 404 }));
    var db = createDbMock();
    var env = {
      R2_STAGING_BUCKET_NAME: "decklist-uploads",
      cubewizard_db: db,
      BUCKET: { put: vi.fn(), head: vi.fn() },
      EVAL_QUEUE: { send: vi.fn() },
      IMAGES: {},
    };
    var message = {
      id: "msg-1",
      attempts: 1,
      body: {
        deck_image_uuid: "uuid-1",
        cube_id: "cube",
        upload_id: "hedron:uuid-1",
        image_url: "https://example.test/missing.jpg",
        r2_prefix: "hedron/uuid-1",
        pilot_name: "Seat 1",
      },
      ack: vi.fn(),
      retry: vi.fn(),
    };

    await consumer.queue({ messages: [message], queue: "hedron" }, env);

    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
    expect(env.EVAL_QUEUE.send).not.toHaveBeenCalled();
    expect(
      db.calls.some(
        (call) =>
          call.type === "run" && call.sql.indexOf("DELETE FROM hedron_synced_decks") >= 0 && call.args[0] === "uuid-1",
      ),
    ).toBe(true);
    expect(db.calls.some((call) => call.type === "run" && call.sql.indexOf("INSERT INTO processing_jobs") >= 0)).toBe(
      true,
    );
    expect(
      db.calls.some(
        (call) =>
          call.type === "run" &&
          call.sql.indexOf("UPDATE processing_jobs SET status = 'failed'") >= 0 &&
          call.args[1] === "hedron:uuid-1",
      ),
    ).toBe(true);
  });
});
