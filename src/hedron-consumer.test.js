import { describe, expect, it, vi } from "vitest";
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
            async run() {
              calls.push({ type: "run", sql: sql, args: args });
              return { success: true, meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
}

describe("hedron consumer permanent failures", () => {
  it("releases sync dedupe and records a failed processing job before acking poison messages", async () => {
    var db = createDbMock();
    var ack = vi.fn();
    var retry = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("missing", { status: 404 })),
    );

    try {
      await consumer.queue(
        {
          queue: "hedron",
          messages: [
            {
              id: "msg-1",
              body: {
                upload_id: "hedron:uuid-1",
                cube_id: "cube",
                deck_image_uuid: "uuid-1",
                image_url: "https://hedron.example/missing.jpg",
                pilot_name: "Pilot",
                submitted_at: "2026-01-01T00:00:00.000Z",
              },
              ack: ack,
              retry: retry,
            },
          ],
        },
        {
          cubewizard_db: db,
          BUCKET: { put: vi.fn() },
          EVAL_QUEUE: { send: vi.fn() },
        },
      );

      expect(ack).toHaveBeenCalledOnce();
      expect(retry).not.toHaveBeenCalled();
      expect(db.calls.some((call) => call.type === "run" && call.sql.includes("DELETE FROM hedron_synced_decks"))).toBe(
        true,
      );
      expect(db.calls.some((call) => call.type === "run" && call.sql.includes("INSERT INTO processing_jobs"))).toBe(
        true,
      );
      expect(
        db.calls.some(
          (call) =>
            call.type === "run" &&
            call.sql.includes("UPDATE processing_jobs SET status = 'failed'") &&
            call.args[1] === "hedron:uuid-1",
        ),
      ).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
