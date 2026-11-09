import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { spawn, execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migratedPglite } from "@/lib/db/tests/pglite";
import { transactions } from "@/lib/db/schema";
import { buildHarnessClient } from "@/lib/harness/client";
import type { ChainDb } from "@/lib/indexer/types";
import { liveChainReader, type ChainReader } from "./chain";
import { listMatches } from "./store";
import { runWorker } from "./worker";
import { realCompiler } from "./tests/fixtures";

/**
 * EXP-S2 live proof (opt-in: VERIFY_E2E_LIVE=1; needs forge/anvil/cast on PATH and
 * network for solc on the first run). Starts anvil (chain id 40204), deploys the
 * fixture contracts with `forge create`, serves the real route handlers over HTTP
 * with PGlite behind them, runs the verify worker, and then runs the real tools:
 *   forge verify-contract --verifier custom   --verifier-url <server>/api
 *   forge verify-contract --verifier sourcify --verifier-url <server>/
 *   npx hardhat verify (hardhat-verify customChains), when VERIFY_E2E_HARDHAT_DIR
 *     points at a directory with hardhat + @nomicfoundation/hardhat-verify installed.
 * Each tool must exit 0 and the store must hold a full runtime + creation match.
 */
const LIVE = process.env.VERIFY_E2E_LIVE === "1";
const HARDHAT_DIR = process.env.VERIFY_E2E_HARDHAT_DIR;

const holder: { db: ChainDb | null; chain: ChainReader | null } = { db: null, chain: null };
vi.mock("@/lib/verify/deps", () => ({ verifyDeps: () => ({ db: holder.db, chain: holder.chain }) }));

import { GET as apiGet, POST as apiPost } from "@/app/api/route";
import { POST as sfPost } from "@/app/v2/verify/[id]/[address]/route";
import { GET as sfJob } from "@/app/v2/verify/[id]/route";
import { GET as sfContract } from "@/app/v2/contract/[chainId]/[address]/route";

const FROM = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"; // anvil default account (unlocked)
const PROJECT = join(__dirname, "__fixtures__", "project");

function runAsync(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => resolve({ code: code ?? 1, out }));
  });
}

async function dispatch(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const seg = url.pathname.split("/").filter(Boolean);
  if (url.pathname === "/api" || url.pathname === "/api/") return req.method === "POST" ? apiPost(req) : apiGet(req);
  if (seg[0] === "v2" && seg[1] === "verify" && seg[2] === "metadata") return new Response("not used", { status: 404 });
  if (seg[0] === "v2" && seg[1] === "verify" && seg.length === 4) return sfPost(req, { params: Promise.resolve({ id: seg[2], address: seg[3] }) });
  if (seg[0] === "v2" && seg[1] === "verify" && seg.length === 3) return sfJob(req, { params: Promise.resolve({ id: seg[2] }) });
  if (seg[0] === "v2" && seg[1] === "contract") return sfContract(req, { params: Promise.resolve({ chainId: seg[2], address: seg[3] }) });
  return new Response("not found", { status: 404 });
}

describe.skipIf(!LIVE)("live: forge and hardhat against the verification routes", () => {
  let anvil: ReturnType<typeof spawn>;
  let server: Server;
  let ctx: Awaited<ReturnType<typeof migratedPglite>>;
  const ac = new AbortController();
  const port = 19000 + Math.floor(Math.random() * 500);
  const rpc = `http://127.0.0.1:${port}`;
  const api = `http://127.0.0.1:${port + 1}`;
  let work: string;
  const deployed: Record<string, { address: string; txHash: string }> = {};

  async function rpcCall(method: string, params: unknown[]) {
    const res = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    return ((await res.json()) as { result: unknown }).result;
  }

  async function indexCreation(address: string, txHash: string) {
    const r = (await rpcCall("eth_getTransactionReceipt", [txHash])) as { blockNumber: string; blockHash: string; from: string };
    await ctx.db.insert(transactions).values({
      hash: txHash.toLowerCase(),
      blockHash: r.blockHash,
      blockHeight: Number(BigInt(r.blockNumber)),
      from: r.from.toLowerCase(),
      to: null,
      status: 1,
      createdContract: address.toLowerCase(),
      timestamp: Math.floor(Date.now() / 1000),
    });
  }

  function forgeCreate(target: string, extra: string[] = []) {
    const out = execFileSync("forge", ["create", "--rpc-url", rpc, "--unlocked", "--from", FROM, "--broadcast", "--json", target, ...extra], { cwd: work, encoding: "utf8" });
    const j = JSON.parse(out.slice(out.indexOf("{"))) as { deployedTo: string; transactionHash: string };
    return { address: j.deployedTo.toLowerCase(), txHash: j.transactionHash };
  }

  beforeAll(async () => {
    anvil = spawn("anvil", ["--chain-id", "40204", "--port", String(port), "--silent"], { stdio: "ignore" });
    for (let i = 0; i < 50; i++) {
      try {
        if (await rpcCall("eth_chainId", [])) break;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    ctx = await migratedPglite();
    holder.db = ctx.db as unknown as ChainDb;
    holder.chain = liveChainReader(buildHarnessClient({ primary: rpc }));

    work = mkdtempSync(join(tmpdir(), "verify-live-"));
    cpSync(PROJECT, work, { recursive: true });
    execFileSync("forge", ["build"], { cwd: work, stdio: "ignore" });
    deployed.lib = forgeCreate("src/Fixture.sol:FixtureMath");
    deployed.counter = forgeCreate("src/Fixture.sol:FixtureCounter", ["--libraries", `src/Fixture.sol:FixtureMath:${deployed.lib.address}`, "--constructor-args", "7", "citrate fixture"]);
    deployed.plain = forgeCreate("src/Fixture.sol:FixturePlain");
    for (const d of Object.values(deployed)) await indexCreation(d.address, d.txHash);

    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", async () => {
        const body = Buffer.concat(chunks);
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
        headers.set("x-forwarded-for", "203.0.113.7");
        const r = await dispatch(new Request(`${api}${req.url}`, { method: req.method, headers, body: req.method === "POST" ? body : undefined }));
        res.statusCode = r.status;
        r.headers.forEach((v, k) => res.setHeader(k, v));
        res.end(Buffer.from(await r.arrayBuffer()));
      });
    });
    await new Promise<void>((r) => server.listen(port + 1, "127.0.0.1", r));
    void runWorker({ db: holder.db, chain: holder.chain, compile: realCompiler(), similarScanLimit: 20 }, { idleMs: 200, signal: ac.signal, workerId: "live" });
  }, 180_000);

  afterAll(async () => {
    ac.abort();
    server?.close();
    anvil?.kill();
    await ctx?.close();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it("forge verify-contract --verifier custom (Etherscan protocol) exits 0 and the store holds full/full", async () => {
    const args = execFileSync("cast", ["abi-encode", "c(uint256,string)", "7", "citrate fixture"], { encoding: "utf8" }).trim();
    const r = await runAsync(
      "forge",
      ["verify-contract", "--chain", "40204", "--rpc-url", rpc, "--verifier", "custom", "--verifier-url", `${api}/api`, "--verifier-api-key", "citrate", "--watch",
        "--libraries", `src/Fixture.sol:FixtureMath:${deployed.lib.address}`, "--constructor-args", args, deployed.counter.address, "src/Fixture.sol:FixtureCounter"],
      { cwd: work },
    );
    expect(r.out).toContain("Pass - Verified");
    expect(r.code).toBe(0);
    const [rec] = await listMatches(holder.db!, { genesisHash: await holder.chain!.genesisHash(), address: deployed.counter.address });
    expect(rec).toMatchObject({ matchType: "full", creationMatch: "full" });
  }, 240_000);

  it("forge verify-contract --verifier sourcify exits 0 with exact_match", async () => {
    const r = await runAsync(
      "forge",
      ["verify-contract", "--chain", "40204", "--rpc-url", rpc, "--verifier", "sourcify", "--verifier-url", `${api}/`, "--watch", deployed.plain.address, "src/Fixture.sol:FixturePlain"],
      { cwd: work },
    );
    expect(r.out).toContain("exact_match");
    expect(r.code).toBe(0);
  }, 240_000);

  it.skipIf(!HARDHAT_DIR)("npx hardhat verify (hardhat-verify customChains) exits 0", async () => {
    const dir = HARDHAT_DIR!;
    mkdirSync(join(dir, "contracts"), { recursive: true });
    cpSync(join(PROJECT, "src", "Fixture.sol"), join(dir, "contracts", "Fixture.sol"));
    cpSync(join(PROJECT, "hardhat.config.js"), join(dir, "hardhat.config.js"));
    const env = { ...process.env, CAPTURE_RPC: rpc, CAPTURE_URL: api };
    expect((await runAsync("npx", ["hardhat", "compile"], { cwd: dir, env })).code).toBe(0);
    const art = (n: string) => JSON.parse(readFileSync(join(dir, `artifacts/contracts/Fixture.sol/${n}.json`), "utf8"));
    const deploy = async (data: string) => {
      const txHash = (await rpcCall("eth_sendTransaction", [{ from: FROM, data, gas: "0x989680" }])) as string;
      const rc = (await rpcCall("eth_getTransactionReceipt", [txHash])) as { contractAddress: string };
      await indexCreation(rc.contractAddress, txHash);
      return rc.contractAddress.toLowerCase();
    };
    const lib = await deploy(art("FixtureMath").bytecode);
    const c = art("FixtureCounter");
    let bc: string = c.bytecode;
    for (const f of Object.values(c.linkReferences as Record<string, Record<string, Array<{ start: number }>>>))
      for (const refs of Object.values(f)) for (const ref of refs) bc = bc.slice(0, 2 + ref.start * 2) + lib.slice(2) + bc.slice(2 + ref.start * 2 + 40);
    const args = execFileSync("cast", ["abi-encode", "c(uint256,string)", "9", "hardhat fixture"], { encoding: "utf8" }).trim();
    const counter = await deploy(bc + args.slice(2));
    writeFileSync(join(dir, "libs.js"), `module.exports = { FixtureMath: "${lib}" };\n`);
    const r = await runAsync("npx", ["hardhat", "verify", "--network", "citrate", "--contract", "contracts/Fixture.sol:FixtureCounter", "--libraries", "libs.js", counter, "9", "hardhat fixture"], { cwd: dir, env });
    expect(r.out).toContain("Successfully verified contract FixtureCounter");
    expect(r.code).toBe(0);
    const [rec] = await listMatches(holder.db!, { genesisHash: await holder.chain!.genesisHash(), address: counter });
    expect(rec).toMatchObject({ matchType: "full", creationMatch: "full" });
  }, 300_000);
});
