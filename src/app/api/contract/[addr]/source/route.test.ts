import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * HUP-S4.3 / F-6: GET /api/contract/[addr]/source is the lean, read-only
 * verified-source lookup (no RPC, no bytecode) that citrate-core's
 * get_verified_source agent tool calls. The verify engine's persisted-row read is
 * mocked so the route is exercised without a DB.
 */
const getVerifiedContract = vi.fn();
let dbEnabled = true;

vi.mock("@/lib/verify/engine", () => ({
  getVerifiedContract: (a: string) => getVerifiedContract(a),
}));
vi.mock("@/lib/db/client", () => ({
  isDbEnabled: () => dbEnabled,
}));

import { GET } from "./route";

const ADDR = "0x" + "c".repeat(40);
let ipSeq = 0;
function req(): Request {
  ipSeq += 1;
  return new Request(`http://x/api/contract/${ADDR}/source`, {
    headers: { "x-forwarded-for": `10.8.0.${ipSeq}` },
  });
}
const ctx = (addr: string) => ({ params: Promise.resolve({ addr }) });

beforeEach(() => {
  getVerifiedContract.mockReset();
  dbEnabled = true;
});

describe("GET /api/contract/[addr]/source", () => {
  it("returns the verified source + compiler metadata for a full match", async () => {
    getVerifiedContract.mockResolvedValueOnce({
      matchType: "full",
      contractName: "A.sol:A",
      compilerVersion: "v0.8.26+commit.8a97fa7a",
      sourceHash: null,
      source: "contract A {}",
      abi: "[]",
      verifiedAt: new Date("2026-09-02T00:00:00Z"),
    });
    const res = await GET(req(), ctx(ADDR));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.status).toBe("verified");
    expect(j.verified).toBe(true);
    expect(j.compilerVersion).toBe("v0.8.26+commit.8a97fa7a");
    expect(j.source).toBe("contract A {}");
    expect(j.abi).toEqual([]);
  });

  it("an address with no match is an honest 'unverified' (200, no source)", async () => {
    getVerifiedContract.mockResolvedValueOnce(null);
    const res = await GET(req(), ctx(ADDR));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.status).toBe("unverified");
    expect(j.source).toBeNull();
  });

  it("an unprovisioned store is 'unavailable', not 'unverified'", async () => {
    dbEnabled = false;
    const res = await GET(req(), ctx(ADDR));
    const j = await res.json();
    expect(j.status).toBe("unavailable");
    expect(getVerifiedContract).not.toHaveBeenCalled();
  });

  it("rejects a malformed address with 400", async () => {
    const res = await GET(req(), ctx("0x12"));
    expect(res.status).toBe(400);
  });

  it("honours ?maxSourceChars", async () => {
    getVerifiedContract.mockResolvedValueOnce({
      matchType: "full",
      contractName: "A.sol:A",
      compilerVersion: "v0.8.26",
      sourceHash: null,
      source: "x".repeat(500),
      abi: null,
      verifiedAt: null,
    });
    ipSeq += 1;
    const r = new Request(`http://x/api/contract/${ADDR}/source?maxSourceChars=40`, {
      headers: { "x-forwarded-for": `10.8.1.${ipSeq}` },
    });
    const j = await (await GET(r, ctx(ADDR))).json();
    expect(j.source.length).toBe(40);
    expect(j.sourceTruncated).toBe(true);
  });
});
