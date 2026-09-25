/**
 * PBA-L3c-034 (INFO bundle):
 *  (a) the per-user data key lower-cased the owner (SR-0 says `sub` is opaque
 *      and case-sensitive), so "Alice" and "alice" shared a key;
 *  (b) MCP tool calls were audited under `mcp:key:N`, a string in the same
 *      namespace as OIDC subjects (a user whose sub is "mcp:key:5" would see
 *      another caller's audit rows);
 *  (c) MCP accepted the API key in `?apikey=` (URLs end up in logs/referrers).
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { hkdfSync, createCipheriv, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

beforeAll(() => {
  process.env.APP_MASTER_KEY = Buffer.alloc(32, 9).toString("base64");
});

/** Independent re-implementation of the ORIGINAL (v1, lower-cased) sealing. */
function sealV1(plaintext: string, owner: string) {
  const key = Buffer.from(
    hkdfSync("sha256", Buffer.from(process.env.APP_MASTER_KEY!, "base64"), Buffer.from(`citrate-explorer:${owner.toLowerCase()}`), Buffer.from("citrate-explorer-secret-v1"), 32),
  );
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  const ct = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  return { ciphertext: ct.toString("base64"), iv: iv.toString("base64"), authTag: c.getAuthTag().toString("base64") };
}

describe("(a) per-user key is case-sensitive (SR-0)", () => {
  it("a payload sealed for 'Alice' does not open for 'alice'", async () => {
    const { sealForUser, openForUser } = await import("@/lib/crypto");
    const sealed = sealForUser("secret", "Alice");
    expect(openForUser(sealed, "Alice")).toBe("secret");
    expect(() => openForUser(sealed, "alice")).toThrow();
  });

  it("new seals use the v2 (domain-separated) key, never the v1 derivation", async () => {
    const { sealForUser } = await import("@/lib/crypto");
    const { createDecipheriv } = await import("node:crypto");
    // Even for an already-lower-case owner, a v2 seal must NOT open under the v1 key.
    const sealed = sealForUser("secret", "bob");
    const v1 = Buffer.from(
      hkdfSync("sha256", Buffer.from(process.env.APP_MASTER_KEY!, "base64"), Buffer.from("citrate-explorer:bob"), Buffer.from("citrate-explorer-secret-v1"), 32),
    );
    const d = createDecipheriv("aes-256-gcm", v1, Buffer.from(sealed.iv, "base64"), { authTagLength: 16 });
    d.setAuthTag(Buffer.from(sealed.authTag, "base64"));
    expect(() => Buffer.concat([d.update(Buffer.from(sealed.ciphertext, "base64")), d.final()])).toThrow();
  });

  it("legacy (v1, lower-cased) payloads still open for their owner", async () => {
    const { openForUser } = await import("@/lib/crypto");
    expect(openForUser(sealV1("legacy", "Bob"), "Bob")).toBe("legacy");
  });
});

describe("(b)+(c) MCP key identity", () => {
  it("extractApiKey: allowQuery:false ignores ?apikey=; the default keeps it (v1 Etherscan compat)", async () => {
    const { extractApiKey } = await import("@/lib/api/keys");
    const req = new Request("http://x/api/mcp?apikey=QKEY");
    expect(extractApiKey(req, { allowQuery: false })).toBeNull();
    expect(extractApiKey(req)).toBe("QKEY");
  });

  it("MCP ignores ?apikey= (source: header only)", () => {
    const src = readFileSync(join(__dirname, "..", "app", "api", "mcp", "route.ts"), "utf8");
    expect(src).toMatch(/extractApiKey\(req,\s*\{\s*allowQuery:\s*false\s*\}\)/);
  });

  it("MCP audits tool calls under the key OWNER's subject, never a synthetic mcp:key:N", () => {
    const src = readFileSync(join(__dirname, "..", "app", "api", "mcp", "route.ts"), "utf8");
    expect(src).not.toMatch(/`mcp:key:\$\{/);
    expect(src).toMatch(/buildTools\(keyInfo\?\.valid \? keyInfo\.subject : undefined\)/);
  });

  it("validateApiKey reports the owning subject", async () => {
    vi.resetModules();
    vi.doMock("@/lib/db/client", () => {
      const row = { id: 3, subject: "Owner-Case", userAddress: "Owner-Case", rateLimitPerSec: 5, quotaPerDay: 100, revoked: false };
      const chain: Record<string, unknown> = {};
      for (const m of ["from", "where", "limit", "set"]) chain[m] = () => chain;
      chain.then = (res: (v: unknown) => unknown) => Promise.resolve([row]).then(res);
      chain.catch = () => Promise.resolve();
      return { getDb: () => ({ select: () => chain, update: () => chain }) };
    });
    process.env.API_KEY_PEPPER ??= "unit-test-pepper-not-a-secret-0000000000";
    const { validateApiKey } = await import("@/lib/api/keys");
    const k = await validateApiKey(`cscan_${"r".repeat(32)}`, "1.1.1.1");
    expect(k.subject).toBe("Owner-Case");
    vi.doUnmock("@/lib/db/client");
  });
});
