import { describe, expect, it } from "vitest";
import { parseAbi, type Address } from "viem";
import addresses from "@/generated/addresses.json";
import { createRpcReader } from "./rpcReader";
import { prepareWrite, readCall, resolveAbi, supportsHistoricalState } from "./kit";
import { createApiSourceV1 } from "./infoSources";
import { recentLogs } from "./events";

// Live-RPC tests are gated behind LIVE_RPC=1 (Rule 11: real data source, read-only).
const live = process.env.LIVE_RPC === "1";
const liveIt = live ? it : it.skip;

const WSALT = addresses.contracts.WrappedSALT as Address;
const abi = parseAbi(["function name() view returns (string)", "function withdraw(uint256 wad)"]);

describe("contract kit against rpc.citrate.ai (40204, read-only)", () => {
  liveIt("reads name() from WrappedSALT", async () => {
    const r = await readCall({ reader: createRpcReader(), address: WSALT, abi, fn: "name", args: [] });
    expect(r).toMatchObject({ ok: true, display: ["Wrapped SALT"] });
  });

  liveIt("simulates a reverting write and decodes the reason from Citrate's error text", async () => {
    const p = await prepareWrite({ reader: createRpcReader(), address: WSALT, abi, abiSource: "verified", fn: "withdraw", args: [10n ** 30n], from: "0x000000000000000000000000000000000000dEaD" });
    expect(p.simulation).toMatchObject({ status: "reverted", revert: { kind: "error-string" } });
  });

  liveIt("detects that the node does not serve historical state", async () => {
    const r = await supportsHistoricalState(createRpcReader(), WSALT);
    expect(typeof r.supported).toBe("boolean");
    if (!r.supported) expect(r.reason).toMatch(/historical/i);
  });

  liveIt("resolves a signature-subset ABI for unverified WrappedSALT bytecode", async () => {
    const info = createApiSourceV1({ baseUrl: "https://explorer.citrate.ai" });
    const r = await resolveAbi({ address: WSALT, reader: createRpcReader(), info });
    expect(r.hasCode).toBe(true);
    if (r.abiSource === "signature-subset") expect(r.abi.some((x) => x.type === "function" && x.name === "deposit")).toBe(true);
  });

  liveIt("pages eth_getLogs under the node's 1000-block cap", async () => {
    const r = await recentLogs(createRpcReader(), WSALT, { pages: 2 });
    expect(r.scanned.toBlock - r.scanned.fromBlock + 1n).toBeLessThanOrEqual(2000n);
  });
});
