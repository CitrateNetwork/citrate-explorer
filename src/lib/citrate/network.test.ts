// Which 40204 network this build is for (r1005 or r1006). Both share chain id 40204, so the
// build names its network and genesis, generated from citrate-chain, and the UI shows them.
// NEXT_PUBLIC_CITRATE_NETWORK picks the book; unset keeps today's live default (r1005).
import { describe, it, expect, afterEach, vi } from "vitest";
import { selectNetwork, networkTag, shortGenesis, NETWORK_IDS } from "./network";

const R1005 = "0x1dcfc4909dd9fdcb0f03c823d627e4b2032cc86bef5fc4561030d6c64b9775f1";
const R1006 = "0xa3651a272fe411948cbb4cf7cca4cee44be4248d32ab4376cea7636821c6cdd4";

describe("selectNetwork", () => {
  it("defaults to r1005 (the live network until the cutover)", () => {
    for (const v of [undefined, ""]) {
      const n = selectNetwork(v);
      expect(n.id).toBe("r1005");
      expect(n.constants.genesisHash).toBe(R1005);
    }
  });

  it("selects the generated r1006 book and constants", () => {
    const n = selectNetwork("r1006");
    expect(n.id).toBe("r1006");
    expect(n.constants.network).toBe("r1006");
    expect(n.constants.genesisHash).toBe(R1006);
    expect(n.constants.chainId).toBe(40204);
    expect(n.book.chainId).toBe(40204);
    // A contract only the r1006 book has: proves the r1006 book is the one selected.
    expect(n.book.contracts.GuardianCanceller).toMatch(/^0x[0-9a-f]{40}$/);
    expect(selectNetwork("r1005").book.contracts.GuardianCanceller).toBeUndefined();
  });

  it("fails closed on an unknown network name instead of falling back", () => {
    expect(() => selectNetwork("r1007")).toThrow(/NEXT_PUBLIC_CITRATE_NETWORK/);
    expect(() => selectNetwork("R1006 ")).toThrow(/NEXT_PUBLIC_CITRATE_NETWORK/);
  });

  it("every network's generated constants name themselves and a distinct genesis", () => {
    expect(NETWORK_IDS).toEqual(["r1005", "r1006"]);
    const hashes = NETWORK_IDS.map((id) => selectNetwork(id).constants.genesisHash);
    expect(new Set(hashes).size).toBe(NETWORK_IDS.length);
    for (const id of NETWORK_IDS) expect(selectNetwork(id).constants.network).toBe(id);
  });
});

describe("network label for the UI", () => {
  it("shortens the genesis hash", () => {
    expect(shortGenesis(R1006)).toBe("0xa365…cdd4");
  });
  it("names the network and its genesis", () => {
    expect(networkTag(selectNetwork("r1006").constants)).toBe("r1006 · genesis 0xa365…cdd4");
    expect(networkTag(selectNetwork("r1005").constants)).toBe("r1005 · genesis 0x1dcf…75f1");
  });
});

describe("the build's network follows NEXT_PUBLIC_CITRATE_NETWORK", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });
  it("the address book the app reads switches with the flag", async () => {
    vi.stubEnv("NEXT_PUBLIC_CITRATE_NETWORK", "r1006");
    vi.resetModules();
    const { NETWORK } = await import("./network");
    const { CONTRACT_ADDRESSES } = await import("./addresses");
    expect(NETWORK.id).toBe("r1006");
    expect(CONTRACT_ADDRESSES.GuardianCanceller).toBe(NETWORK.book.contracts.GuardianCanceller);
  });
});
