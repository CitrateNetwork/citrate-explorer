import { describe, it, expect } from "vitest";
import {
  shapeVerifiedSource,
  getVerifiedSource,
  DEFAULT_MAX_SOURCE_CHARS,
  MAX_SOURCE_CHARS_LIMIT,
  type VerifiedRow,
} from "./verifiedSource";

/**
 * HUP-S4.3 / F-6: the read-only verified-source lookup behind `getVerifiedSource`
 * (MCP + in-app agent) and GET /api/contract/[addr]/source. Pure shaping is tested
 * directly; the lookup is tested with injected store deps (no DB, no RPC).
 */
const ADDR = "0x" + "AB".repeat(20);

function row(over: Partial<VerifiedRow> = {}): VerifiedRow {
  return {
    matchType: "full",
    contractName: "src/Foo.sol:Foo",
    compilerVersion: "v0.8.26+commit.8a97fa7a",
    sourceHash: "0x" + "11".repeat(32),
    source: "contract Foo { function x() external pure returns (uint) { return 1; } }",
    abi: JSON.stringify([{ type: "function", name: "x", inputs: [], outputs: [{ type: "uint256" }] }]),
    verifiedAt: new Date("2026-09-01T12:00:00Z"),
    ...over,
  };
}

describe("shapeVerifiedSource", () => {
  it("a full match is verified and carries source, parsed ABI, and compiler metadata", () => {
    const v = shapeVerifiedSource(ADDR, row(), true);
    expect(v.address).toBe(ADDR.toLowerCase());
    expect(v.status).toBe("verified");
    expect(v.verified).toBe(true);
    expect(v.matchType).toBe("full");
    expect(v.contractName).toBe("src/Foo.sol:Foo");
    expect(v.compilerVersion).toBe("v0.8.26+commit.8a97fa7a");
    expect(v.sourceHash).toBe("0x" + "11".repeat(32));
    expect(v.source).toContain("contract Foo");
    expect(v.sourceTruncated).toBe(false);
    expect(Array.isArray(v.abi)).toBe(true);
    expect(v.verifiedAt).toBe("2026-09-01T12:00:00.000Z");
  });

  it("a partial match is NOT verified, but still shows the recompiled source, clearly labeled", () => {
    const v = shapeVerifiedSource(ADDR, row({ matchType: "partial" }), true);
    expect(v.status).toBe("partial-match");
    expect(v.verified).toBe(false);
    expect(v.source).toContain("contract Foo");
    expect(v.note).toMatch(/not a verified match/i);
  });

  it("a legacy pass row with a null match type fails closed to unverified", () => {
    const v = shapeVerifiedSource(ADDR, row({ matchType: null }), true);
    expect(v.verified).toBe(false);
    expect(v.status).toBe("unverified");
  });

  it("no recorded match is an honest 'unverified' with no source and no ABI", () => {
    const v = shapeVerifiedSource(ADDR, null, true);
    expect(v.status).toBe("unverified");
    expect(v.verified).toBe(false);
    expect(v.source).toBeNull();
    expect(v.abi).toBeNull();
    expect(v.contractName).toBeNull();
    expect(v.note).toMatch(/not verified/i);
  });

  it("an unprovisioned verification store is 'unavailable', never 'unverified'", () => {
    const v = shapeVerifiedSource(ADDR, null, false);
    expect(v.status).toBe("unavailable");
    expect(v.verified).toBe(false);
    expect(v.source).toBeNull();
    expect(v.note).toMatch(/unavailable/i);
  });

  it("an ABI that is not valid JSON is reported as null, not thrown", () => {
    const v = shapeVerifiedSource(ADDR, row({ abi: "{not json" }), true);
    expect(v.abi).toBeNull();
    expect(v.status).toBe("verified");
  });

  it("long source is truncated to maxSourceChars and flagged", () => {
    const long = "a".repeat(DEFAULT_MAX_SOURCE_CHARS + 50);
    const v = shapeVerifiedSource(ADDR, row({ source: long }), true);
    expect(v.source?.length).toBe(DEFAULT_MAX_SOURCE_CHARS);
    expect(v.sourceTruncated).toBe(true);
    expect(v.sourceChars).toBe(DEFAULT_MAX_SOURCE_CHARS + 50);

    const small = shapeVerifiedSource(ADDR, row({ source: long }), true, 100);
    expect(small.source?.length).toBe(100);
  });

  it("maxSourceChars is clamped to [1, MAX_SOURCE_CHARS_LIMIT]", () => {
    const long = "b".repeat(MAX_SOURCE_CHARS_LIMIT + 10);
    expect(shapeVerifiedSource(ADDR, row({ source: long }), true, 10 ** 9).source?.length).toBe(MAX_SOURCE_CHARS_LIMIT);
    expect(shapeVerifiedSource(ADDR, row({ source: long }), true, 0).source?.length).toBe(1);
  });
});

describe("getVerifiedSource (injected store)", () => {
  it("looks the address up lowercased and shapes the row", async () => {
    const seen: string[] = [];
    const v = await getVerifiedSource(ADDR, {
      deps: {
        storeAvailable: () => true,
        lookup: async (a) => {
          seen.push(a);
          return row();
        },
      },
    });
    expect(seen).toEqual([ADDR.toLowerCase()]);
    expect(v.status).toBe("verified");
  });

  it("does not query when the store is not provisioned", async () => {
    let called = false;
    const v = await getVerifiedSource(ADDR, {
      deps: {
        storeAvailable: () => false,
        lookup: async () => {
          called = true;
          return row();
        },
      },
    });
    expect(called).toBe(false);
    expect(v.status).toBe("unavailable");
  });

  it("a failing lookup is 'unavailable' and does not leak the error text", async () => {
    const v = await getVerifiedSource(ADDR, {
      deps: {
        storeAvailable: () => true,
        lookup: async () => {
          throw new Error("password authentication failed for user neondb_owner");
        },
      },
    });
    expect(v.status).toBe("unavailable");
    expect(JSON.stringify(v)).not.toMatch(/neondb_owner|password/);
  });

  it("refuses a malformed address", async () => {
    await expect(
      getVerifiedSource("0x1234", { deps: { storeAvailable: () => true, lookup: async () => null } }),
    ).rejects.toThrow(/address/i);
  });
});
