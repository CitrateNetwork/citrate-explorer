// The RPC adapter the genesis guard reads block hashes through (mocked JSON-RPC client).
import { describe, it, expect } from "vitest";
import type { PublicClient } from "viem";
import { rpcGenesisSource } from "./genesisStore";
import { checkGenesis } from "./genesisGuard";

const R1006 = "0xa3651a272fe411948cbb4cf7cca4cee44be4248d32ab4376cea7636821c6cdd4";

function mockClient(blocks: Record<string, { hash: string } | null>) {
  const calls: { method: string; params: unknown[] }[] = [];
  const client = {
    async request({ method, params }: { method: string; params: unknown[] }) {
      calls.push({ method, params });
      return blocks[String(params[0])] ?? null;
    },
  } as unknown as PublicClient;
  return { client, calls };
}

describe("rpcGenesisSource", () => {
  it("reads eth_getBlockByNumber(<hex height>, false).hash", async () => {
    const { client, calls } = mockClient({ "0x0": { hash: R1006 }, "0x2a": { hash: "0x" + "2a".repeat(32) } });
    const rpc = rpcGenesisSource(client);
    expect(await rpc.blockHashAt(0)).toBe(R1006);
    expect(await rpc.blockHashAt(42)).toBe("0x" + "2a".repeat(32));
    expect(calls).toEqual([
      { method: "eth_getBlockByNumber", params: ["0x0", false] },
      { method: "eth_getBlockByNumber", params: ["0x2a", false] },
    ]);
  });

  it("a node without the block yields null, which the guard treats as unavailable", async () => {
    const { client } = mockClient({});
    expect(await rpcGenesisSource(client).blockHashAt(0)).toBeNull();
    const v = await checkGenesis({ rpc: rpcGenesisSource(client), store: null, expected: R1006 });
    expect(v.action).toBe("unavailable");
  });
});
