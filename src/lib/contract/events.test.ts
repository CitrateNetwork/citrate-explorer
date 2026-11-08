import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, pad, type Abi, type Hex } from "viem";
import { decodeLog, recentLogs } from "./events";
import { memoryReader } from "./testReader.testutil";
import fixture from "./__fixtures__/registry.json";

const abi = fixture.abi as Abi;
const C = "0x1111111111111111111111111111111111111111";
const OWNER = "0x000000000000000000000000000000000000dEaD";

function registeredLog(block: bigint) {
  const node = pad("0x01", { size: 32 });
  return {
    address: C,
    topics: encodeEventTopics({ abi, eventName: "Registered", args: { node, owner: OWNER } }) as Hex[],
    data: encodeAbiParameters([{ type: "string" }], ["harbor"]),
    blockNumber: block,
    transactionHash: pad("0xaa", { size: 32 }),
    logIndex: 0,
  };
}

describe("events: decoding", () => {
  it("decodes with the verified ABI, keeping indexed flags", () => {
    const d = decodeLog(registeredLog(10n), abi);
    expect(d.source).toBe("abi");
    expect(d.name).toBe("Registered");
    expect(d.args.map((a) => [a.name, a.indexed, a.value])).toEqual([
      ["node", true, pad("0x01", { size: 32 })],
      ["name", false, "harbor"],
      ["owner", true, OWNER],
    ]);
  });

  it("falls back to the signature subset (ERC-20 Transfer) without an ABI", () => {
    const log = {
      address: C,
      topics: [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        pad(OWNER, { size: 32 }),
        pad(C, { size: 32 }),
      ] as Hex[],
      data: pad("0x05", { size: 32 }),
      blockNumber: 3n,
      transactionHash: null,
      logIndex: 1,
    };
    const d = decodeLog(log, null);
    expect(d.source).toBe("signature-subset");
    expect(d.name).toBe("Transfer");
    expect(d.args[2].value).toBe(5n);
  });

  it("leaves an unknown topic undecoded", () => {
    const d = decodeLog({ ...registeredLog(1n), topics: [pad("0x99", { size: 32 })] }, null);
    expect(d).toMatchObject({ source: null, name: null, args: [] });
  });
});

describe("events: recent logs in node-sized pages", () => {
  it("scans backwards from head and stops at the page budget", async () => {
    const r = memoryReader({ head: 3_500n, logs: [registeredLog(3_400n), registeredLog(100n)] });
    const res = await recentLogs(r, C, { pages: 2 });
    expect(res.logs.map((l) => l.blockNumber)).toEqual([3_400n]);
    expect(res.scanned).toEqual({ fromBlock: 1_501n, toBlock: 3_500n });
    expect(res.more).toBe(true);
    const older = await recentLogs(r, C, { pages: 2, before: res.scanned.fromBlock });
    expect(older.logs.map((l) => l.blockNumber)).toEqual([100n]);
    expect(older.more).toBe(false);
  });
});
