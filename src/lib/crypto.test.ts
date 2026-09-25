import { describe, it, expect, beforeAll } from "vitest";
import {
  sealForUser,
  openForUser,
  generateApiKey,
  hashApiKey,
  verifyApiKey,
  API_KEY_SCRYPT,
} from "./crypto";

const ALICE = "0x1111111111111111111111111111111111111111";
const BOB = "0x2222222222222222222222222222222222222222";

beforeAll(() => {
  // Deterministic 32-byte master key + pepper for the test run.
  process.env.APP_MASTER_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.API_KEY_PEPPER = "test-pepper";
});

describe("at-rest envelope encryption (third-party keys)", () => {
  it("round-trips a secret for the same user", () => {
    const sealed = sealForUser("sk-secret-provider-key", ALICE);
    expect(sealed.ciphertext).not.toContain("sk-secret");
    expect(openForUser(sealed, ALICE)).toBe("sk-secret-provider-key");
  });

  it("cannot be opened by a different user (cross-user isolation)", () => {
    const sealed = sealForUser("sk-secret-provider-key", ALICE);
    expect(() => openForUser(sealed, BOB)).toThrow();
  });

  it("uses a fresh IV per encryption", () => {
    const a = sealForUser("same", ALICE);
    const b = sealForUser("same", ALICE);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });
});

describe("issued API keys (hash-only)", () => {
  it("hashes are not the raw key and verify in constant time", () => {
    const key = generateApiKey();
    expect(key.startsWith("cscan_")).toBe(true);
    const hash = hashApiKey(key);
    expect(hash).not.toContain(key);
    expect(verifyApiKey(key, hash)).toBe(true);
    expect(verifyApiKey("cscan_wrong", hash)).toBe(false);
  });

  it("is scrypt salted with the pepper (PBA R2): deterministic per pepper, changes with it", () => {
    const key = generateApiKey();
    const h = hashApiKey(key);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey(key)).toBe(h);
    expect(hashApiKey(`${key}x`)).not.toBe(h);
    const saved = process.env.API_KEY_PEPPER;
    try {
      process.env.API_KEY_PEPPER = `${saved}x`;
      expect(hashApiKey(key)).not.toBe(h);
    } finally {
      process.env.API_KEY_PEPPER = saved;
    }
  });

  it("uses the documented scrypt cost", () => {
    expect(API_KEY_SCRYPT).toEqual({ N: 16384, r: 8, p: 1, keylen: 32 });
  });

  it("migration 0004 revokes every pre-R2 key", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const sql = readFileSync(join(__dirname, "db", "migrations", "0004_pba_r2_hmac_api_keys.sql"), "utf8");
    expect(sql).toMatch(/UPDATE "api_keys" SET "revoked" = true WHERE "revoked" = false;/);
  });

  // EX-B-010: the pepper must be REQUIRED — an unset/empty pepper must throw
  // (fail closed), never silently degrade to a bare unsalted SHA-256. Mirrors
  // the fail-secure posture of APP_MASTER_KEY.
  it("throws when API_KEY_PEPPER is unset (fail closed, no empty-pepper fallback)", () => {
    const saved = process.env.API_KEY_PEPPER;
    try {
      delete process.env.API_KEY_PEPPER;
      expect(() => hashApiKey("cscan_whatever")).toThrow(/API_KEY_PEPPER is not set/);
      process.env.API_KEY_PEPPER = "";
      expect(() => hashApiKey("cscan_whatever")).toThrow(/API_KEY_PEPPER is not set/);
    } finally {
      process.env.API_KEY_PEPPER = saved;
    }
  });
});
