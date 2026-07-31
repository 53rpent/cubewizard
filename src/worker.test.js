import { describe, expect, it, vi } from "vitest";
import { createSession } from "./security/auth.js";
import worker from "./worker.js";

function createJsonR2Object(value) {
  return {
    async arrayBuffer() {
      return new TextEncoder().encode(JSON.stringify(value)).buffer;
    },
  };
}

function createDbMock({
  sessionUser = null,
  processingJob = null,
  processingDeckRows = [],
  deck = null,
  failProcessingJobUpsert = false,
} = {}) {
  var calls = [];
  var db = {
    calls: calls,
    prepare(sql) {
      return {
        bind(...args) {
          calls.push({ type: "bind", sql: sql, args: args });
          return {
            async first() {
              if (sql.indexOf("FROM sessions s") >= 0) return sessionUser;
              if (sql.indexOf("FROM processing_jobs") >= 0) return processingJob;
              if (sql.indexOf("FROM decks WHERE deck_id = ?") >= 0) return deck;
              return null;
            },
            async all() {
              if (sql.indexOf("FROM decks") >= 0 && sql.indexOf("processing_timestamp = ?") >= 0) {
                return { results: processingDeckRows };
              }
              return { results: [] };
            },
            async run() {
              calls.push({ type: "run", sql: sql, args: args });
              if (failProcessingJobUpsert && sql.indexOf("INSERT INTO processing_jobs") >= 0) {
                throw new Error("processing job write failed");
              }
              return { success: true, meta: { changes: 1 } };
            },
          };
        },
      };
    },
    async batch(stmts) {
      calls.push({ type: "batch", stmts: stmts });
      return stmts.map(function () {
        return { meta: { changes: 1 } };
      });
    },
  };
  return db;
}

async function createSignedSessionCookie(db, env, userId) {
  var session = await createSession(db, userId, env);
  return session.cookieHeader.split(";")[0];
}

function hasDeckDeleteBatch(db) {
  return db.calls.some(function (call) {
    if (call.type !== "batch") return false;
    return call.stmts.some(function (stmt) {
      return (
        typeof stmt?.sql === "string" &&
        (stmt.sql.indexOf("DELETE FROM deck_cards") >= 0 || stmt.sql.indexOf("DELETE FROM decks") >= 0)
      );
    });
  });
}

describe("processing job dismissal route", () => {
  it("requires a logged-in user before deleting failed upload data", async () => {
    var db = createDbMock();
    var env = {
      CWW_ENV: "local",
      cubewizard_db: db,
      BUCKET: { get: vi.fn(), delete: vi.fn() },
      DECK_IMAGES_BLOB: { delete: vi.fn() },
    };

    var response = await worker.fetch(
      new Request("https://example.test/api/processing-job/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upload_id: "upload-1", cube_id: "cube" }),
      }),
      env,
      {},
    );

    expect(response.status).toBe(401);
    expect(db.calls).toHaveLength(0);
    expect(env.BUCKET.delete).not.toHaveBeenCalled();
    expect(env.DECK_IMAGES_BLOB.delete).not.toHaveBeenCalled();
  });

  it("rejects logged-in non-owners without deleting deck or R2 data", async () => {
    var sessionUser = { user_id: 5, username: "owner" };
    var db = createDbMock({
      sessionUser: sessionUser,
      processingJob: { upload_id: "upload-1", cube_id: "cube", status: "failed", r2_prefix: "upload-1/" },
      processingDeckRows: [
        {
          deck_id: 123,
          owner_user_id: 9,
          oriented_image_r2_key: "oriented/cube/image.jpg",
          oriented_thumb_r2_key: "thumbs/cube/image.webp",
        },
      ],
    });
    var env = {
      CWW_ENV: "local",
      cubewizard_db: db,
      BUCKET: { get: vi.fn(), delete: vi.fn() },
      DECK_IMAGES_BLOB: { delete: vi.fn() },
    };
    var cookie = await createSignedSessionCookie(db, env, sessionUser.user_id);

    var response = await worker.fetch(
      new Request("https://example.test/api/processing-job/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ upload_id: "upload-1", cube_id: "cube" }),
      }),
      env,
      {},
    );

    expect(response.status).toBe(403);
    expect(hasDeckDeleteBatch(db)).toBe(false);
    expect(env.BUCKET.delete).not.toHaveBeenCalled();
    expect(env.DECK_IMAGES_BLOB.delete).not.toHaveBeenCalled();
  });
});

describe("deck reprocess route", () => {
  it("does not delete deck rows when eval queue enqueue cannot be made durable", async () => {
    var sessionUser = { user_id: 5, username: "owner" };
    var db = createDbMock({
      sessionUser: sessionUser,
      deck: {
        deck_id: 123,
        cube_id: "cube",
        pilot_name: "owner",
        match_wins: 2,
        match_losses: 1,
        match_draws: 0,
        win_rate: 0.667,
        record_logged: "2026-06-06T00:00:00.000Z",
        image_source: "",
        processing_timestamp: "upload-1",
        owner_user_id: 5,
        image_id: "image-1",
        oriented_image_r2_key: "oriented/cube/image.jpg",
        staging_image_r2_key: "upload-1/image.jpg",
      },
    });
    var env = {
      CWW_ENV: "local",
      cubewizard_db: db,
      BUCKET: {
        get: vi.fn(function () {
          return createJsonR2Object({ owner_user_id: 5 });
        }),
      },
      DECK_IMAGES_BLOB: {
        get: vi.fn(function () {
          return { async arrayBuffer() {} };
        }),
      },
    };
    var cookie = await createSignedSessionCookie(db, env, sessionUser.user_id);

    var response = await worker.fetch(
      new Request("https://example.test/api/deck/123/reprocess", {
        method: "POST",
        headers: { Cookie: cookie },
      }),
      env,
      {},
    );

    expect(response.status).toBe(500);
    expect(hasDeckDeleteBatch(db)).toBe(false);
    expect(db.calls.some((call) => call.type === "run" && call.sql.indexOf("INSERT INTO processing_jobs") >= 0)).toBe(
      true,
    );
    expect(db.calls.some((call) => call.type === "run" && call.sql.indexOf("DELETE FROM processing_jobs") >= 0)).toBe(
      true,
    );
  });

  it("uses a fresh upload identity before deleting the old deck rows", async () => {
    var sessionUser = { user_id: 5, username: "owner" };
    var db = createDbMock({
      sessionUser: sessionUser,
      deck: {
        deck_id: 123,
        cube_id: "cube",
        pilot_name: "owner",
        match_wins: 2,
        match_losses: 1,
        match_draws: 0,
        win_rate: 0.667,
        record_logged: "2026-06-06T00:00:00.000Z",
        image_source: "",
        processing_timestamp: "upload-1",
        owner_user_id: 5,
        image_id: "image-1",
        oriented_image_r2_key: "oriented/cube/image.jpg",
        staging_image_r2_key: "upload-1/image.jpg",
      },
    });
    var sentBodies = [];
    var env = {
      CWW_ENV: "local",
      cubewizard_db: db,
      EVAL_QUEUE: {
        send: vi.fn(async function (body) {
          sentBodies.push(body);
          expect(hasDeckDeleteBatch(db)).toBe(false);
        }),
      },
      BUCKET: {
        get: vi.fn(function () {
          return createJsonR2Object({ owner_user_id: 5 });
        }),
      },
      DECK_IMAGES_BLOB: {
        get: vi.fn(function () {
          return { async arrayBuffer() {} };
        }),
      },
    };
    var cookie = await createSignedSessionCookie(db, env, sessionUser.user_id);

    var response = await worker.fetch(
      new Request("https://example.test/api/deck/123/reprocess", {
        method: "POST",
        headers: { Cookie: cookie },
      }),
      env,
      {},
    );
    var body = await response.json();

    expect(response.status).toBe(200);
    expect(sentBodies).toHaveLength(1);
    expect(sentBodies[0].upload_id).toMatch(/^reprocess:upload-1:/);
    expect(sentBodies[0].upload_id).not.toBe("upload-1");
    expect(sentBodies[0].processing_timestamp).toBe(sentBodies[0].upload_id);
    expect(sentBodies[0].image_id).not.toBe("image-1");
    expect(body.upload_id).toBe(sentBodies[0].upload_id);
    expect(hasDeckDeleteBatch(db)).toBe(true);
  });

  it("does not queue or delete deck rows when reprocess job tracking fails", async () => {
    var sessionUser = { user_id: 5, username: "owner" };
    var db = createDbMock({
      sessionUser: sessionUser,
      failProcessingJobUpsert: true,
      deck: {
        deck_id: 123,
        cube_id: "cube",
        pilot_name: "owner",
        match_wins: 2,
        match_losses: 1,
        match_draws: 0,
        win_rate: 0.667,
        record_logged: "2026-06-06T00:00:00.000Z",
        image_source: "",
        processing_timestamp: "upload-1",
        owner_user_id: 5,
        image_id: "image-1",
        oriented_image_r2_key: "oriented/cube/image.jpg",
        staging_image_r2_key: "upload-1/image.jpg",
      },
    });
    var env = {
      CWW_ENV: "local",
      cubewizard_db: db,
      EVAL_QUEUE: { send: vi.fn() },
      BUCKET: {
        get: vi.fn(function () {
          return createJsonR2Object({ owner_user_id: 5 });
        }),
      },
      DECK_IMAGES_BLOB: {
        get: vi.fn(function () {
          return { async arrayBuffer() {} };
        }),
      },
    };
    var cookie = await createSignedSessionCookie(db, env, sessionUser.user_id);

    var response = await worker.fetch(
      new Request("https://example.test/api/deck/123/reprocess", {
        method: "POST",
        headers: { Cookie: cookie },
      }),
      env,
      {},
    );

    expect(response.status).toBe(500);
    expect(env.EVAL_QUEUE.send).not.toHaveBeenCalled();
    expect(hasDeckDeleteBatch(db)).toBe(false);
  });
});
