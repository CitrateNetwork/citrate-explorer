import { describe, it, expect, beforeAll } from "vitest";
import {
  sealForUser,
  openForUser,
  generateApiKey,
  hashApiKey,
  API_KEY_SCRYPT,
  API_KEY_RE,
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
  it("minted keys match API_KEY_RE; hashes are hex and never contain the key", async () => {
    for (let i = 0; i < 50; i++) expect(generateApiKey()).toMatch(API_KEY_RE);
    const key = generateApiKey();
    const hash = await hashApiKey(key);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(key);
  });

  it("API_KEY_RE is exact: prefix, 32 base64url chars, anchored", () => {
    const body = "A".repeat(32);
    expect(API_KEY_RE.test(`cscan_${body}`)).toBe(true);
    for (const bad of [`cscan_${body}A`, `cscan_${"A".repeat(31)}`, `xcscan_${body}`, `cscan_${body}\n`, `CSCAN_${body}`, `cscan_${"A".repeat(31)}=`, "cscan_" + "A".repeat(1_000_000)]) {
      expect(API_KEY_RE.test(bad)).toBe(false);
    }
  });

  it("is scrypt salted with the pepper: deterministic per pepper, changes with it", async () => {
    const key = generateApiKey();
    const h = await hashApiKey(key);
    expect(await hashApiKey(key)).toBe(h);
    expect(await hashApiKey(`${key}x`)).not.toBe(h);
    const saved = process.env.API_KEY_PEPPER;
    try {
      process.env.API_KEY_PEPPER = `${saved}x`;
      expect(await hashApiKey(key)).not.toBe(h);
    } finally {
      process.env.API_KEY_PEPPER = saved;
    }
  });

  it("uses the documented scrypt cost", () => {
    expect(API_KEY_SCRYPT).toEqual({ N: 4096, r: 8, p: 1, keylen: 32 });
  });

  it("migration 0004 adds key_scheme (default legacy) and retires only legacy rows", async () => {
    const { readFileSync, existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = join(__dirname, "db", "migrations");
    expect(existsSync(join(dir, "0004_pba_r2_hmac_api_keys.sql"))).toBe(false);
    const sql = readFileSync(join(dir, "0004_api_key_scheme.sql"), "utf8");
    expect(sql).toMatch(/ALTER TABLE "api_keys" ADD COLUMN "key_scheme" text DEFAULT 'legacy' NOT NULL;/);
    expect(sql).toMatch(/UPDATE "api_keys" SET "revoked" = true WHERE "key_scheme" = 'legacy' AND "revoked" = false;/);
  });

  // EX-B-010: the pepper must be REQUIRED — an unset/empty pepper must throw
  // (fail closed), never silently degrade to a bare unsalted hash.
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
