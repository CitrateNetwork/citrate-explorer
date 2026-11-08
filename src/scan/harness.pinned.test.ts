/**
 * EXP-AGENT step 1: pin the front-end mirror harness (`SH`) the scan screens use.
 * It stays read-only by construction: the forbidden list is checked before the
 * allowlist, and its tool set does not grow a write.
 */
import { describe, it, expect } from "vitest";
import { SH } from "./harness";

describe("SH (front-end harness mirror)", () => {
  it("keeps its tool set", () => {
    // readContract left the front-end mirror with EXP-S3 (#47): it answered from
    // sample data (SD.CONTRACT), a mock in a production path. Contract reads are
    // real now, through the contract kit (Read tab) and the agent's contract_read.
    expect(Object.keys(SH.tools).sort()).toEqual(
      ["exploreDag", "getAddress", "getBlock", "getChainStatus", "getLogs", "getToken", "getTransaction", "isContract", "topHolders"].sort(),
    );
  });

  it("contract reads are served by the real kit path, not by the mirror", async () => {
    const { CONTRACT_TOOL_NAMES } = await import("@/lib/ai/contractTools");
    expect(CONTRACT_TOOL_NAMES).toContain("contract_read");
    expect((SH.tools as Record<string, unknown>).readContract).toBeUndefined();
  });

  it("refuses forbidden methods before consulting the allowlist", () => {
    for (const m of SH.FORBIDDEN) expect(() => SH.guard(m)).toThrow(/forbidden/);
    expect(() => SH.guard("eth_frobnicate")).toThrow(/not allowlisted/);
    for (const m of SH.ALLOWED) expect(SH.guard(m)).toBe(true);
  });

  it("classifies omni-search input by shape", () => {
    expect(SH.classify("123").kind).toBe("block");
    expect(SH.classify("0x" + "a".repeat(64)).kind).toBe("tx");
    expect(SH.classify("").kind).toBe("empty");
    expect(SH.classify("who holds the most SALT").kind).toBe("search");
  });
});
