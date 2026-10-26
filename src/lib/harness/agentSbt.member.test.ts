/**
 * AgentSBT member mint (2026-10-05 reroll): a member mints their own agent from their wallet, so the
 * mint is Transfer(0, member, id) in a transaction the member sent, and the parent org is whatever
 * getAgent stores (the member organization, here #3). The explorer must show the member as holder,
 * the stored org as parent, and the member as the one who minted it, never some other issuer.
 *
 * The node is a scripted JSON-RPC server on loopback that answers only the reads the harness makes,
 * with values ABI-encoded by viem, so the harness's real decoding runs end to end. The same reads
 * run against a real deploy in agentSbt.anvil.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createPublicClient, decodeFunctionData, encodeFunctionResult, http as httpTransport, pad, type Address, type Hex, type PublicClient } from "viem";
import { AGENT_SBT_ABI, ORG_SBT_ABI, TRANSFER_TOPIC, tokenIdTopic } from "@/lib/citrate/agentSbt";
import { readAgent, listAgents } from "./agentSbt";

const SBT = "0x00000000000000000000000000000000000a6e70" as Address;
const ORG = "0x00000000000000000000000000000000000000f9" as Address;
const MEMBER = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" as Address;
const OPERATOR = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc" as Address;
const SIGNER = "0x90f79bf6eb2c4f870365e785982e1f101e93b906" as Address;
const MEMBER_ORG_ID = 3n;
const DID = `0x${"ab".repeat(32)}` as Hex;
const FP = `0x${"cd".repeat(32)}` as Hex;
const ORG_DID = `0x${"ef".repeat(32)}` as Hex;
const SELF_TX = `0x${"11".repeat(32)}` as Hex;
const OP_TX = `0x${"22".repeat(32)}` as Hex;
const HEAD = 100n;
const hex = (n: bigint) => `0x${n.toString(16)}`;

/** Agent 0: self-minted by MEMBER. Agent 1: minted to MEMBER by an operator account. */
const AGENTS = [
  { id: 0n, holder: MEMBER, tx: SELF_TX, sender: MEMBER, block: 7n },
  { id: 1n, holder: MEMBER, tx: OP_TX, sender: OPERATOR, block: 9n },
];

function txObject(a: (typeof AGENTS)[number]) {
  return {
    hash: a.tx, from: a.sender, to: SBT, blockHash: pad(hex(a.block) as Hex), blockNumber: hex(a.block),
    transactionIndex: "0x0", nonce: "0x0", gas: "0x5208", gasPrice: "0x1", value: "0x0", input: "0x",
    type: "0x0", chainId: hex(40204n), v: "0x1b", r: pad("0x1"), s: pad("0x1"),
  };
}

function ethCall(to: string, data: Hex): Hex {
  if (to.toLowerCase() === SBT) {
    const { functionName, args } = decodeFunctionData({ abi: AGENT_SBT_ABI, data });
    switch (functionName) {
      case "nextTokenId":
        return encodeFunctionResult({ abi: AGENT_SBT_ABI, functionName, result: BigInt(AGENTS.length) });
      case "orgContract":
        return encodeFunctionResult({ abi: AGENT_SBT_ABI, functionName, result: ORG });
      case "ownerOf":
        return encodeFunctionResult({ abi: AGENT_SBT_ABI, functionName, result: AGENTS[Number(args[0])].holder });
      case "getAgent":
        return encodeFunctionResult({
          abi: AGENT_SBT_ABI,
          functionName,
          result: { parent_org_id: MEMBER_ORG_ID, did: DID, pubkey_fingerprint: FP, quarantined: false },
        });
    }
  }
  if (to.toLowerCase() === ORG) {
    const { functionName, args } = decodeFunctionData({ abi: ORG_SBT_ABI, data });
    if (functionName === "getOrg" && args[0] === MEMBER_ORG_ID) {
      return encodeFunctionResult({
        abi: ORG_SBT_ABI,
        functionName,
        result: { did: ORG_DID, signing_authority: SIGNER, active_overlays: [], active: true },
      });
    }
  }
  throw new Error(`unscripted eth_call to ${to}`);
}

type CallParam = { to: string; data: Hex };
type LogFilter = { topics?: (string | null)[] };
type RpcRequest = { id: number; method: string; params?: unknown[] };

function answer(method: string, params: unknown[]): unknown {
  switch (method) {
    case "eth_chainId":
      return hex(40204n);
    case "eth_getCode":
      return String(params[0]).toLowerCase() === SBT ? "0x6080" : "0x";
    case "eth_blockNumber":
      return hex(HEAD);
    case "eth_call":
      return ethCall((params[0] as CallParam).to, (params[0] as CallParam).data);
    case "eth_getLogs": {
      const f = params[0] as LogFilter;
      const want = (f.topics?.[3] ?? "").toLowerCase();
      return AGENTS.filter((a) => tokenIdTopic(a.id) === want).map((a) => ({
        address: SBT,
        topics: [TRANSFER_TOPIC, pad("0x0"), pad(a.holder), tokenIdTopic(a.id)],
        data: "0x",
        blockNumber: hex(a.block),
        blockHash: pad(hex(a.block) as Hex),
        transactionHash: a.tx,
        transactionIndex: "0x0",
        logIndex: "0x0",
        removed: false,
      }));
    }
    case "eth_getTransactionByHash": {
      const a = AGENTS.find((x) => x.tx === params[0]);
      return a ? txObject(a) : null;
    }
  }
  throw new Error(`unscripted method ${method}`);
}

let server: http.Server;
let client: PublicClient;

beforeAll(async () => {
  delete process.env.DATABASE_URL; // RPC-window history, not the index
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const one = (r: RpcRequest) => {
        try {
          return { jsonrpc: "2.0", id: r.id, result: answer(r.method, r.params ?? []) };
        } catch (e) {
          return { jsonrpc: "2.0", id: r.id, error: { code: -32601, message: (e as Error).message } };
        }
      };
      const parsed = JSON.parse(body);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(Array.isArray(parsed) ? parsed.map(one) : one(parsed)));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  client = createPublicClient({ transport: httpTransport(`http://127.0.0.1:${port}`, { retryCount: 0 }) }) as PublicClient;
});
afterAll(() => server.close());

describe("AgentSBT member self-mint", () => {
  it("holder is the member, parent org is the stored member org, and the member is the minter", async () => {
    const a = await readAgent({ client, address: SBT }, 0n);
    expect(a?.owner).toBe(MEMBER.toLowerCase());
    expect(a?.parentOrg).toEqual({ id: "3", contract: ORG, did: ORG_DID, active: true, signingAuthority: SIGNER });
    expect(a?.mint).toMatchObject({ from: "0x0000000000000000000000000000000000000000", to: MEMBER.toLowerCase(), txHash: SELF_TX });
    expect(a?.mintSender).toBe(MEMBER.toLowerCase());
  });

  it("an operator mint to a member names the operator as sender and the member as holder", async () => {
    const a = await readAgent({ client, address: SBT }, 1n);
    expect(a?.owner).toBe(MEMBER.toLowerCase());
    expect(a?.mintSender).toBe(OPERATOR.toLowerCase());
    expect(a?.parentOrg.id).toBe("3");
  });

  it("the list reports the stored parent org per agent, not a fixed id", async () => {
    const l = await listAgents({ client, address: SBT });
    expect(l.agents.map((x) => [x.tokenId, x.owner, x.parentOrgId])).toEqual([
      ["1", MEMBER.toLowerCase(), "3"],
      ["0", MEMBER.toLowerCase(), "3"],
    ]);
  });
});
