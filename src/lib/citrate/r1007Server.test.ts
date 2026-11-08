/**
 * The ledger requester is deny-by-default: it can issue only the fixed read
 * methods the snapshot needs. This backs its entry in the dynamic-method
 * tripwire (src/lib/harness/getlogs-entrypoints.test.ts).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const rpc = vi.hoisted(() => ({ citrateRequest: vi.fn(async (_c: unknown, m: string) => `live:${m}`) }));
vi.mock("./rpc", () => ({ citrateRequest: rpc.citrateRequest }));
vi.mock("@/lib/harness/client", () => ({ buildHarnessClient: () => ({}) }));

import { LEDGER_RPC_METHODS, fixedMethodRequester, r1007Requester } from "./r1007Server";

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

// The tests above prove the wrapper. These prove the EXPORTED requester the
// routes use is that wrapper, and that the module has no other way to reach the
// node with a dynamic method (so a refactor that unwraps it fails here, not in
// production).
describe("r1007Requester (the one the /api/ledger, /api/blocks and /api/tx routes use)", () => {
  beforeEach(() => rpc.citrateRequest.mockClear());

  it("refuses a non-ledger method before the RPC is touched", async () => {
    for (const m of ["eth_getLogs", "eth_sendRawTransaction", "eth_call", "citrate_verifyContract"]) {
      await expect(r1007Requester(m, [])).rejects.toThrow("is not a ledger read");
    }
    expect(rpc.citrateRequest).not.toHaveBeenCalled();
  });

  it("forwards a ledger read unchanged", async () => {
    await expect(r1007Requester("citrate_getDagStats", [])).resolves.toBe("live:citrate_getDagStats");
    expect(rpc.citrateRequest).toHaveBeenCalledTimes(1);
    expect(rpc.citrateRequest.mock.calls[0][1]).toBe("citrate_getDagStats");
  });

  it("calls citrateRequest exactly once in the source, inside fixedMethodRequester", () => {
    const src = readFileSync(join(__dirname, "r1007Server.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(src.match(/citrateRequest\(/g)).toHaveLength(1);
    expect(src).toMatch(/export const r1007Requester: Requester = fixedMethodRequester\(\(method, params\) => citrateRequest\(/);
  });
});
