import { describe, it, expect, beforeAll } from "vitest";
import {
  sealForUser,
  openForUser,
  generateApiKey,
  hashApiKey,
  verifyApiKey,
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
