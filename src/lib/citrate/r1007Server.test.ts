/**
 * The ledger requester is deny-by-default: it can issue only the fixed read
 * methods the snapshot needs. This backs its entry in the dynamic-method
 * tripwire (src/lib/harness/getlogs-entrypoints.test.ts).
 */
import { describe, expect, it } from "vitest";
import { LEDGER_RPC_METHODS, fixedMethodRequester } from "./r1007Server";

describe("fixedMethodRequester", () => {
  const raw = async (m: string) => `ok:${m}`;
  it("passes the ledger read methods through", async () => {
    const req = fixedMethodRequester(raw);
    for (const m of ["eth_blockNumber", "eth_getBlockByNumber", "eth_getBlockByHash", "citrate_getDagStats", "citrate_getGhostdagData", "citrate_getFinalityStatus"]) {
      await expect(req(m, [])).resolves.toBe(`ok:${m}`);
    }
  });
  it("refuses anything else, including writes and log scans", async () => {
    const req = fixedMethodRequester(raw);
    for (const m of ["eth_sendRawTransaction", "eth_getLogs", "eth_call", "debug_traceTransaction", "citrate_verifyContract"]) {
      await expect(req(m, [])).rejects.toThrow("is not a ledger read");
    }
  });
  it("is exactly the header reads, getDagStats and the five r1007 reads", () => {
    expect([...LEDGER_RPC_METHODS].sort()).toEqual(
      [
        "citrate_getAcceptingBlock",
        "citrate_getBlocksAtHeight",
        "citrate_getDagStats",
        "citrate_getFinalityStatus",
        "citrate_getGhostdagData",
        "citrate_getSelectedChainChanges",
        "eth_blockNumber",
        "eth_getBlockByHash",
        "eth_getBlockByNumber",
      ].sort(),
    );
  });
});
