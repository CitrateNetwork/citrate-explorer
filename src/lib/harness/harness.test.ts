import { describe, it, expect } from "vitest";
import { getChainStatus, dagOverview } from "./ops";
import { isReadMethodAllowed } from "./allowlist";
import { CITRATE_CHAIN_ID } from "@/lib/citrate/chain";

// Live-RPC tests are gated behind LIVE_RPC=1 (Rule 11: real data source, no mocks).
const live = process.env.LIVE_RPC === "1";
const liveIt = live ? it : it.skip;

describe("harness allowlist (unit)", () => {
  it("permits read methods and forbids writes/signing", () => {
    expect(isReadMethodAllowed("eth_getBalance")).toBe(true);
    expect(isReadMethodAllowed("citrate_getDagStats")).toBe(true);
    expect(isReadMethodAllowed("eth_sendRawTransaction")).toBe(false);
    expect(isReadMethodAllowed("eth_signTypedData_v4")).toBe(false);
    expect(isReadMethodAllowed("personal_sign")).toBe(false);
  });
});

describe("harness live reads", () => {
  liveIt("reads chain status (chainId 40204)", async () => {
    const status = await getChainStatus();
    expect(status.chainId).toBe(CITRATE_CHAIN_ID);
    expect(Number(status.blockNumber)).toBeGreaterThan(0);
  });

  liveIt("reads GHOSTDAG topology (tips present)", async () => {
    const dag = await dagOverview();
    expect(dag.tipsCount).toBeGreaterThanOrEqual(1);
    expect(dag.ghostdagParams.finalityDepth).toBeGreaterThan(0);
  });
});
