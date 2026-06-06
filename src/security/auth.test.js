import { describe, expect, it } from "vitest";
import {
  deckCanClaim,
  deckCanEdit,
  deckCanManage,
  hashPassword,
  validateEmail,
  validatePassword,
  validateUsername,
  verifyPassword,
} from "./auth.js";

describe("validateUsername", () => {
  it("accepts valid usernames and lowercases", () => {
    expect(validateUsername("Alex_1")).toEqual({ ok: true, username: "alex_1" });
  });

  it("rejects short or invalid characters", () => {
    expect(validateUsername("ab").ok).toBe(false);
    expect(validateUsername("bad name").ok).toBe(false);
  });
});

describe("validateEmail", () => {
  it("accepts basic emails", () => {
    expect(validateEmail("User@Example.com")).toEqual({ ok: true, email: "user@example.com" });
  });

  it("rejects invalid emails", () => {
    expect(validateEmail("not-an-email").ok).toBe(false);
  });
});

describe("validatePassword", () => {
  it("requires at least 8 characters", () => {
    expect(validatePassword("short").ok).toBe(false);
    expect(validatePassword("longenough").ok).toBe(true);
  });
});

describe("hashPassword / verifyPassword", () => {
  it("round-trips password verification", async () => {
    var stored = await hashPassword("test-password-1");
    expect(stored.startsWith("pbkdf2-sha256$")).toBe(true);
    expect(await verifyPassword("test-password-1", stored)).toBe(true);
    expect(await verifyPassword("wrong", stored)).toBe(false);
  });
});

describe("deck permissions", () => {
  var session = { user_id: 5, username: "pilot" };

  it("allows edit on unclaimed decks", () => {
    expect(deckCanEdit(null, null)).toBe(true);
    expect(deckCanEdit(null, session)).toBe(true);
  });

  it("restricts edit on claimed decks to owner", () => {
    expect(deckCanEdit(5, session)).toBe(true);
    expect(deckCanEdit(5, { user_id: 9, username: "other" })).toBe(false);
    expect(deckCanEdit(5, null)).toBe(false);
  });

  it("allows claim only when unclaimed and logged in", () => {
    expect(deckCanClaim(null, session)).toBe(true);
    expect(deckCanClaim(null, null)).toBe(false);
    expect(deckCanClaim(3, session)).toBe(false);
  });

  it("allows manage only for deck owner when claimed", () => {
    expect(deckCanManage(5, session)).toBe(true);
    expect(deckCanManage(5, { user_id: 9, username: "other" })).toBe(false);
    expect(deckCanManage(null, session)).toBe(false);
    expect(deckCanManage(5, null)).toBe(false);
  });
});
