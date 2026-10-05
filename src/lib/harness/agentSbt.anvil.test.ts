/**
 * HUP US-7.1 AC2, against a real chain: deploy citrate-chain's OrganizationSBT + AgentSBT on a local
 * anvil (chain id 40204), then read them through the same code the explorer ships: the harness reads,
 * the /api/agents routes and the MCP getAgent tool. No mocks; every value comes from the deployed
 * contracts.
 *
 * Opt-in: needs `anvil` on PATH and CITRATE_AGENT_SBT_ARTIFACTS pointing at a forge `out/` that holds
 * AgentSBT.sol/AgentSBT.json and OrganizationSBT.sol/OrganizationSBT.json. `scripts/anvil-agent-sbt.sh`
 * builds them from the citrate-chain source and runs this file.
 *
 * Accounts are anvil's unlocked dev accounts (eth_accounts); no key material appears here.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  stringToBytes,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";

const ARTIFACTS = process.env.CITRATE_AGENT_SBT_ARTIFACTS ?? "";
const enabled = ARTIFACTS !== "" && existsSync(join(ARTIFACTS, "AgentSBT.sol", "AgentSBT.json"));
const suite = enabled ? describe : describe.skip;

interface Artifact {
  abi: Abi;
  bytecode: Hex;
}
function artifact(name: string): Artifact {
  const j = JSON.parse(readFileSync(join(ARTIFACTS, `${name}.sol`, `${name}.json`), "utf8"));
  return { abi: j.abi as Abi, bytecode: j.bytecode.object as Hex };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForRpc(url: string, ms = 15_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (r.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error(`anvil did not come up at ${url}`);
}

const didHashFor = (member: string) => keccak256(stringToBytes(`did:citrate:agent:${member.toLowerCase()}`));
const FINGERPRINT_A = keccak256(stringToBytes("explorer-anvil-test identity key A"));
const FINGERPRINT_B = keccak256(stringToBytes("explorer-anvil-test identity key B"));
const ORG_DID = keccak256(stringToBytes("did:citrate:org:explorer-anvil-test"));
const ZERO = "0x0000000000000000000000000000000000000000";

suite("AgentSBT on a real anvil deploy", () => {
  let anvil: ChildProcess | null = null;
  let url = "";
  let pub: PublicClient;
  let wallet: WalletClient;
  let admin: Address;
  let memberA: Address;
  let memberB: Address;
  let signer: Address;
  let org: Address;
  let sbt: Address;
  let agentAbi: Abi;
  let orgAbi: Abi;
  let mintTxA: Hex;
  // The modules under test, imported after the env points them at this anvil.
  let harness: typeof import("./agentSbt");
  let listRoute: typeof import("@/app/api/agents/route");
  let oneRoute: typeof import("@/app/api/agents/[tokenId]/route");
  let mcp: typeof import("@/app/api/mcp/route");
  const savedEnv = { ...process.env };

  const send = async (to: Address, abi: Abi, functionName: string, args: unknown[]): Promise<Hex> => {
    const hash = await wallet.writeContract({ account: admin, chain: null, address: to, abi, functionName, args });
    const rcpt = await pub.waitForTransactionReceipt({ hash });
    expect(rcpt.status).toBe("success");
    return hash;
  };
  const deploy = async (a: Artifact, args: unknown[]): Promise<Address> => {
    const hash = await wallet.deployContract({ account: admin, chain: null, abi: a.abi, bytecode: a.bytecode, args });
    const rcpt = await pub.waitForTransactionReceipt({ hash });
    if (!rcpt.contractAddress) throw new Error("deploy produced no contract");
    return rcpt.contractAddress;
  };

  let ip = 0;
  const req = (path: string, init: RequestInit = {}) => {
    ip += 1;
    return new Request(`http://x${path}`, { ...init, headers: { ...(init.headers ?? {}), "x-forwarded-for": `10.72.1.${ip}` } });
  };
  const mcpGetAgent = async (tokenId: string) => {
    const res = await mcp.POST(
      req("/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "getAgent", arguments: { tokenId } } }),
      }),
    );
    return (await res.json()).result;
  };

  beforeAll(async () => {
    const port = await freePort();
    url = `http://127.0.0.1:${port}`;
    anvil = spawn("anvil", ["--port", String(port), "--chain-id", "40204", "--silent"], { stdio: "ignore" });
    await waitForRpc(url);
    pub = createPublicClient({ transport: http(url), cacheTime: 0 }) as PublicClient;
    wallet = createWalletClient({ transport: http(url) });
    [admin, memberA, memberB, signer] = (await wallet.getAddresses()) as Address[];

    const orgArt = artifact("OrganizationSBT");
    const agentArt = artifact("AgentSBT");
    orgAbi = orgArt.abi;
    agentAbi = agentArt.abi;
    org = await deploy(orgArt, [admin]);
    sbt = await deploy(agentArt, [admin, org]);

    process.env.NEXT_PUBLIC_CITRATE_RPC_URL = url;
    process.env.NEXT_PUBLIC_AGENT_SBT = sbt;
    delete process.env.CITRATE_RPC_FALLBACK;
    delete process.env.DATABASE_URL;
    vi.resetModules();
    harness = await import("./agentSbt");
    listRoute = await import("@/app/api/agents/route");
    oneRoute = await import("@/app/api/agents/[tokenId]/route");
    mcp = await import("@/app/api/mcp/route");
  }, 60_000);

  afterAll(() => {
    anvil?.kill("SIGTERM");
    process.env = savedEnv;
  });

  // --- before any org or agent exists (today's 40204) -------------------------------------------

  it("an empty registry reads as 'No agents registered yet.'", async () => {
    const src = { client: pub, address: sbt };
    const reg = await harness.readAgentRegistry(src);
    expect(reg).toEqual({ address: sbt.toLowerCase(), deployed: true, total: "0", orgContract: org.toLowerCase() });
    expect(harness.agentListNote(reg)).toBe(harness.NO_AGENTS_NOTE);
    expect(await harness.readAgent(src, 0n)).toBeNull();
    const list = await harness.listAgents(src);
    expect(list.agents).toEqual([]);
    expect(list.nextBefore).toBeNull();
  });

  it("the routes and the MCP tool render the empty registry cleanly", async () => {
    const res = await listRoute.GET(req("/api/agents"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agents).toEqual([]);
    expect(body.note).toBe("No agents registered yet.");
    expect(body.registry.total).toBe("0");

    const r0 = await oneRoute.GET(req("/api/agents/0"), { params: Promise.resolve({ tokenId: "0" }) });
    expect(r0.status).toBe(404);

    const tool = await mcpGetAgent("0");
    expect(tool.isError).toBe(false);
    expect(tool.structuredContent.found).toBe(false);
    expect(tool.structuredContent.note).toBe("No agents registered yet.");
  });

  it("ownerOf: a revert (no such token) is null, an unreachable node is an error", async () => {
    expect(await harness.readOwner({ client: pub, address: sbt }, 999n)).toBeNull();
    const dead = createPublicClient({ transport: http("http://127.0.0.1:1", { retryCount: 0, timeout: 2_000 }) }) as PublicClient;
    await expect(harness.readOwner({ client: dead, address: sbt }, 0n)).rejects.toThrow();
  });

  it("an address with no code reads as not deployed, not as an empty registry", async () => {
    const reg = await harness.readAgentRegistry({ client: pub, address: memberA });
    expect(reg.deployed).toBe(false);
    expect(harness.agentListNote(reg)).toBe(harness.NOT_DEPLOYED_NOTE);
  });

  // --- after the org and two agents are minted -------------------------------------------------

  it("reads a minted agent: DID, owner, parent org, fingerprint and mint tx", async () => {
    await send(org, orgAbi, "mintOrg", [admin, ORG_DID, signer, []]);
    mintTxA = await send(sbt, agentAbi, "mintAgent", [memberA, 0n, didHashFor(memberA), FINGERPRINT_A]);
    await send(sbt, agentAbi, "mintAgent", [memberB, 0n, didHashFor(memberB), FINGERPRINT_B]);

    const a = await harness.readAgent({ client: pub, address: sbt }, 0n);
    expect(a).not.toBeNull();
    const rcpt = await pub.getTransactionReceipt({ hash: mintTxA });
    expect(a).toEqual({
      registry: sbt.toLowerCase(),
      tokenId: "0",
      owner: memberA.toLowerCase(),
      did: { hash: didHashFor(memberA), did: `did:citrate:agent:${memberA.toLowerCase()}`, empty: false },
      pubkeyFingerprint: FINGERPRINT_A,
      quarantined: false,
      parentOrg: { id: "0", contract: org.toLowerCase(), did: ORG_DID, active: true, signingAuthority: signer.toLowerCase() },
      mint: { from: ZERO, to: memberA.toLowerCase(), txHash: mintTxA, blockNumber: rcpt.blockNumber.toString(), logIndex: expect.any(Number) },
      // An operator (the contract owner) sent this mint, so the sender is not the holder.
      mintSender: admin.toLowerCase(),
      transfers: [{ from: ZERO, to: memberA.toLowerCase(), txHash: mintTxA, blockNumber: rcpt.blockNumber.toString(), logIndex: expect.any(Number) }],
      history: { source: "rpc-window", fromBlock: "0", toBlock: expect.any(String), complete: true },
    });
  });

  it("the token-id topic keeps one agent's history apart from another's", async () => {
    const b = await harness.readAgent({ client: pub, address: sbt }, 1n);
    expect(b?.owner).toBe(memberB.toLowerCase());
    expect(b?.transfers).toHaveLength(1);
    expect(b?.mint?.txHash).not.toBe(mintTxA);
    expect(b?.pubkeyFingerprint).toBe(FINGERPRINT_B);
  });

  it("lists agents newest first and pages backwards with `before`", async () => {
    const src = { client: pub, address: sbt };
    const all = await harness.listAgents(src);
    expect(all.registry.total).toBe("2");
    expect(all.agents.map((x) => x.tokenId)).toEqual(["1", "0"]);
    expect(all.agents[1].did.did).toBe(`did:citrate:agent:${memberA.toLowerCase()}`);
    expect(all.nextBefore).toBeNull();

    const page1 = await harness.listAgents(src, { limit: 1 });
    expect(page1.agents.map((x) => x.tokenId)).toEqual(["1"]);
    expect(page1.nextBefore).toBe("1");
    const page2 = await harness.listAgents(src, { limit: 1, before: 1n });
    expect(page2.agents.map((x) => x.tokenId)).toEqual(["0"]);
    expect(page2.nextBefore).toBeNull();
  });

  it("reports quarantine from the contract", async () => {
    await send(sbt, agentAbi, "quarantine", [1n]);
    const b = await harness.readAgent({ client: pub, address: sbt }, 1n);
    expect(b?.quarantined).toBe(true);
  });

  it("a mint older than the log window is reported as outside it, never invented", async () => {
    await pub.request({ method: "anvil_mine" as never, params: ["0x20", "0x1"] as never });
    const hist = await harness.agentTransferLogs({ client: pub, address: sbt }, 0n, 4n);
    expect(hist.transfers).toEqual([]);
    expect(hist.history.complete).toBe(false);
    expect(BigInt(hist.history.toBlock ?? "0") - BigInt(hist.history.fromBlock ?? "0")).toBe(3n);
  });

  it("a holder that sends its own mint reads as self-minted under the stored parent org (#3)", async () => {
    // The member path (mintAgentAsMember) mints to msg.sender under the member org. This deploy has
    // the owner-only mintAgent, so the owner mints to itself: the same on-chain shape for the
    // explorer (Transfer(0, holder, id) in a tx the holder sent, parent org from getAgent).
    const orgDid = (i: number) => keccak256(stringToBytes(`did:citrate:org:explorer-anvil-test-${i}`));
    for (let i = 1; i <= 3; i++) await send(org, orgAbi, "mintOrg", [admin, orgDid(i), signer, []]);
    const selfTx = await send(sbt, agentAbi, "mintAgent", [admin, 3n, didHashFor(admin), FINGERPRINT_A]);
    const a = await harness.readAgent({ client: pub, address: sbt }, 2n);
    expect(a?.owner).toBe(admin.toLowerCase());
    expect(a?.parentOrg.id).toBe("3");
    expect(a?.parentOrg.did).toBe(orgDid(3));
    expect(a?.parentOrg.active).toBe(true);
    expect(a?.mint?.txHash).toBe(selfTx);
    expect(a?.mint?.to).toBe(admin.toLowerCase());
    expect(a?.mintSender).toBe(admin.toLowerCase());
    expect(a?.did.did).toBe(`did:citrate:agent:${admin.toLowerCase()}`);
  });

  it("serves the agent over /api/agents/[tokenId] and /api/agents", async () => {
    const r0 = await oneRoute.GET(req("/api/agents/0"), { params: Promise.resolve({ tokenId: "0" }) });
    expect(r0.status).toBe(200);
    const a = await r0.json();
    expect(a.owner).toBe(memberA.toLowerCase());
    expect(a.mint.txHash).toBe(mintTxA);
    expect(a.parentOrg.active).toBe(true);

    const r9 = await oneRoute.GET(req("/api/agents/9"), { params: Promise.resolve({ tokenId: "9" }) });
    expect(r9.status).toBe(404);

    const l = await (await listRoute.GET(req("/api/agents?limit=5"))).json();
    expect(l.note).toBeNull();
    expect(l.agents.map((x: { tokenId: string }) => x.tokenId)).toEqual(["2", "1", "0"]);
  });

  it("the MCP getAgent tool returns the same agent", async () => {
    const tool = await mcpGetAgent("0");
    expect(tool.isError).toBe(false);
    expect(tool.structuredContent.found).toBe(true);
    expect(tool.structuredContent.agent.owner).toBe(memberA.toLowerCase());
    expect(tool.structuredContent.agent.mint.txHash).toBe(mintTxA);

    const missing = await mcpGetAgent("7");
    expect(missing.structuredContent.found).toBe(false);
    expect(missing.structuredContent.note).toMatch(/Agent #7 is not registered \(3 agents so far\)/);
  });
});
