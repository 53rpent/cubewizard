import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSession } from "./security/auth.js";
import worker from "./worker.js";

function createJsonR2Object(value) {
  return {
    async arrayBuffer() {
      return new TextEncoder().encode(JSON.stringify(value)).buffer;
    },
  };
}

function createImagesBinding(bytes) {
  return {
    info: vi.fn(async function () {
      return { width: 1, height: 1, format: "jpeg" };
    }),
    input: vi.fn(function () {
      return {
        transform() {
          return this;
        },
        async output() {
          return {
            async response() {
              return new Response(bytes, {
                status: 200,
                headers: { "Content-Type": "image/jpeg" },
              });
            },
          };
        },
      };
    }),
  };
}

function createDbMock({
  sessionUser = null,
  processingJob = null,
  processingDeckRows = [],
  deck = null,
  deckResults = null,
} = {}) {
  var calls = [];
  var db = {
    calls: calls,
    prepare(sql) {
      return {
        bind(...args) {
          calls.push({ type: "bind", sql: sql, args: args });
          return {
            sql: sql,
            args: args,
            async first() {
              if (sql.indexOf("FROM sessions s") >= 0) return sessionUser;
              if (sql.indexOf("FROM processing_jobs") >= 0) return processingJob;
              if (sql.indexOf("FROM decks WHERE deck_id = ?") >= 0) {
                if (deckResults?.length) return deckResults.shift();
                return deck;
              }
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

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it("rechecks ownership before deleting a failed upload deck", async () => {
    var sessionUser = { user_id: 5, username: "owner" };
    var db = createDbMock({
      sessionUser: sessionUser,
      processingJob: { upload_id: "upload-1", cube_id: "cube", status: "failed", r2_prefix: "upload-1/" },
      processingDeckRows: [
        {
          deck_id: 123,
          owner_user_id: null,
          oriented_image_r2_key: "oriented/cube/image.jpg",
          oriented_thumb_r2_key: "thumbs/cube/image.webp",
        },
      ],
      deck: { deck_id: 123, cube_id: "cube", owner_user_id: 9 },
    });
    var env = {
      CWW_ENV: "local",
      cubewizard_db: db,
      BUCKET: { get: vi.fn(async function () {}), delete: vi.fn() },
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
      false,
    );
  });

  it("enqueues reprocess with a fresh replacement upload id and preserves the active deck", async () => {
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
      EVAL_QUEUE: {
        send: vi.fn(async function () {}),
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
    var sentBody = env.EVAL_QUEUE.send.mock.calls[0]?.[0];

    expect(response.status).toBe(200);
    expect(body.upload_id).toMatch(/^reprocess:123:/);
    expect(sentBody.upload_id).toBe(body.upload_id);
    expect(sentBody.processing_timestamp).toBe(body.upload_id);
    expect(sentBody.replace_deck_id).toBe(123);
    expect(sentBody.owner_user_id).toBe(5);
    expect(sentBody.image_id).not.toBe("image-1");
    expect(hasDeckDeleteBatch(db)).toBe(false);
  });
});

describe("deck card edit route", () => {
  it("rechecks ownership after Scryfall lookup before replacing cards", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: [
            {
              name: "Mountain",
              mana_cost: "",
              cmc: 0,
              type_line: "Basic Land - Mountain",
              colors: [],
              color_identity: ["R"],
              rarity: "common",
              set: "lea",
              set_name: "Limited Edition Alpha",
              collector_number: "164",
              oracle_text: "R",
              scryfall_uri: "https://scryfall.com/card/lea/164/mountain",
              image_uris: {},
              prices: {},
            },
          ],
        }),
      ),
    );
    var sessionUser = { user_id: 5, username: "editor" };
    var db = createDbMock({
      sessionUser: sessionUser,
      deckResults: [
        { deck_id: 123, cube_id: "cube", owner_user_id: null },
        { deck_id: 123, cube_id: "cube", owner_user_id: 9 },
      ],
    });
    var env = { CWW_ENV: "local", cubewizard_db: db };
    var cookie = await createSignedSessionCookie(db, env, sessionUser.user_id);

    var response = await worker.fetch(
      new Request("https://example.test/api/deck/123/cards", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ names: ["Mountain"] }),
      }),
      env,
      {},
    );

    expect(response.status).toBe(403);
    expect(db.calls.some((call) => call.type === "run" && call.sql.indexOf("DELETE FROM deck_cards") >= 0)).toBe(false);
  });
});

describe("upload route", () => {
  it("marks the processing job failed and returns 500 when eval queue send fails", async () => {
    var imageBytes = readFileSync(join(process.cwd(), "fixtures/eval-golden/cases/ArcaneLessons/image.jpg"));
    var db = createDbMock();
    var env = {
      CWW_ENV: "local",
      cubewizard_db: db,
      BUCKET: { put: vi.fn() },
      IMAGES: createImagesBinding(imageBytes),
      EVAL_QUEUE: {
        send: vi.fn(async function () {
          throw new Error("queue down");
        }),
      },
    };
    var form = new FormData();
    form.set("cube_id", "cube");
    form.set("pilot_name", "pilot");
    form.set("wins", "2");
    form.set("losses", "1");
    form.set("draws", "0");
    form.set("image", new File([imageBytes], "deck.jpg", { type: "image/jpeg" }));

    var response = await worker.fetch(
      new Request("https://example.test/api/upload", {
        method: "POST",
        body: form,
      }),
      env,
      {},
    );
    var body = await response.json();

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(env.EVAL_QUEUE.send).toHaveBeenCalledTimes(1);
    expect(
      db.calls.some(
        (call) => call.type === "run" && call.sql.indexOf("UPDATE processing_jobs SET status = 'failed'") >= 0,
      ),
    ).toBe(true);
  });
});
