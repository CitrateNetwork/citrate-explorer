import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * FWA-C12-05 (integration tripwire): the contract API must NOT report
 * `verification.verified === true` for a PARTIAL-match row. A partial match is a
 * distinct, clearly-labeled status — never the verified badge.
 *
 * We mock the on-chain harness (so the address reads as a contract) and the
 * verify engine's getVerifiedContract (the persisted match row) so the route's
 * badge derivation is exercised end-to-end without RPC/DB.
 */
const getVerifiedContract = vi.fn();

vi.mock("@/lib/harness/ops", () => ({
  getAddress: async (addr: string) => ({ address: addr, isContract: true, balanceSalt: "0" }),
  getContractCode: async () => ({
    isContract: true,
    label: null,
    sizeBytes: 4,
    codeHash: "0xhash",
    bytecode: "0xabcd",
  }),
  getToken: async () => ({ standard: "unknown" }),
}));

vi.mock("@/lib/verify/engine", () => ({
  getVerifiedContract: (a: string) => getVerifiedContract(a),
}));

import { GET } from "./route";

const ADDR = "0x" + "b".repeat(40);
const ctx = { params: Promise.resolve({ addr: ADDR }) };

function row(matchType: string | null) {
  return {
    matchType,
    contractName: "X:Foo",
    compilerVersion: "v0.8.26+commit.8a97fa7a",
    source: "contract Foo {}",
    abi: "[]",
    verifiedAt: new Date("2026-06-21T00:00:00Z"),
  };
}

describe("/api/contract/[addr] verified badge (FWA-C12-05)", () => {
  beforeEach(() => getVerifiedContract.mockReset());

  it("a PARTIAL match is NOT reported as verified", async () => {
    getVerifiedContract.mockResolvedValue(row("partial"));
    const res = await GET(new Request(`http://x/api/contract/${ADDR}`), ctx);
    const body = await res.json();
    expect(body.verification.verified).toBe(false);
    expect(body.verification.status).toBe("partial-match");
    expect(body.verification.matchType).toBe("partial");
  });

  it("a FULL match IS reported as verified", async () => {
    getVerifiedContract.mockResolvedValue(row("full"));
    const res = await GET(new Request(`http://x/api/contract/${ADDR}`), ctx);
    const body = await res.json();
    expect(body.verification.verified).toBe(true);
    expect(body.verification.status).toBe("verified");
  });

  it("a legacy pass row with null matchType is NOT verified (fail closed)", async () => {
    getVerifiedContract.mockResolvedValue(row(null));
    const res = await GET(new Request(`http://x/api/contract/${ADDR}`), ctx);
    const body = await res.json();
    expect(body.verification.verified).toBe(false);
  });
});
