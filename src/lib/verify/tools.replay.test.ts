import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { migratedPglite } from "@/lib/db/tests/pglite";
import type { ChainDb } from "@/lib/indexer/types";
import type { ChainReader } from "./chain";
import { listMatches } from "./store";
import { runOnce } from "./worker";
import { fixtureChain, loadFixture, realCompiler, seedIndexedCreations, type RecordedRequest, type ToolFixture } from "./tests/fixtures";

/**
 * EXP-S2 proof with the real tools' requests. scripts/verify/capture-tool-fixtures.mjs
 * ran forge 1.5.1 (`--verifier custom` = Etherscan protocol, and `--verifier sourcify`)
 * and hardhat-verify 2.1.3 against a recorder and a local anvil deployment. Here the
 * exact recorded HTTP requests go, in order, to the real route handlers
 * (src/app/api/route.ts and src/app/v2/...), with PGlite as the database, the
 * recorded anvil state as the chain, and the real worker + solc 0.8.26 between
 * submission and status polls. Each response is checked against what the tool
 * needs to see to report success.
 */
const holder: { db: ChainDb | null; chain: ChainReader | null } = { db: null, chain: null };
vi.mock("@/lib/verify/deps", () => ({ verifyDeps: () => ({ db: holder.db, chain: holder.chain }) }));

import { GET as apiGet, POST as apiPost } from "@/app/api/route";
import { POST as sfPost } from "@/app/v2/verify/[id]/[address]/route";
import { GET as sfJob } from "@/app/v2/verify/[id]/route";
import { GET as sfContract } from "@/app/v2/contract/[chainId]/[address]/route";

const BASE = "https://explorer.citrate.ai";
let ipSeq = 10;

async function send(r: RecordedRequest, ip: string): Promise<Response> {
  const url = new URL(r.url, BASE);
  const req = new Request(url, {
    method: r.method,
    headers: { ...(r.contentType ? { "content-type": r.contentType } : {}), "x-forwarded-for": ip },
    body: r.method === "POST" ? r.body : undefined,
  });
  const seg = url.pathname.split("/").filter(Boolean);
  if (url.pathname === "/api") return r.method === "POST" ? apiPost(req) : apiGet(req);
  if (seg[0] === "v2" && seg[1] === "verify" && seg.length === 4) {
    return sfPost(req, { params: Promise.resolve({ id: seg[2], address: seg[3] }) });
  }
  if (seg[0] === "v2" && seg[1] === "verify" && seg.length === 3) return sfJob(req, { params: Promise.resolve({ id: seg[2] }) });
  if (seg[0] === "v2" && seg[1] === "contract") {
    return sfContract(req, { params: Promise.resolve({ chainId: seg[2], address: seg[3] }) });
  }
  throw new Error(`no route for ${r.method} ${r.url}`);
}

/** Swap the recorder's guid / job id for the one our server issued. */
function withId(r: RecordedRequest, recorded: string, ours: string): RecordedRequest {
  return { ...r, url: r.url.split(recorded).join(ours), body: r.body.split(recorded).join(ours) };
}

describe("real tool requests replayed against the verification routes", () => {
  let ctx: Awaited<ReturnType<typeof migratedPglite>>;
  const compile = realCompiler();
  const work = async () => {
    while ((await runOnce({ db: holder.db!, chain: holder.chain!, compile, similarScanLimit: 20 }, { workerId: "replay" })) === "processed");
  };

  beforeAll(async () => {
    ctx = await migratedPglite();
    holder.db = ctx.db as unknown as ChainDb;
  });
  afterAll(async () => ctx.close());
  beforeEach(async () => ctx.truncateAll());

  async function replayEtherscan(f: ToolFixture, runIndex: number) {
    holder.chain = fixtureChain(f);
    await seedIndexedCreations(holder.db!, f);
    const run = f.runs[runIndex];
    const ip = `198.51.100.${ipSeq++}`;
    let ours: string | null = null;
    const seen: Array<{ action: string; body: { status: string; message: string; result: unknown } }> = [];
    for (const rec of run.requests) {
      const action = new URLSearchParams(rec.method === "POST" ? rec.body : new URL(rec.url, BASE).search).get("action")!;
      let r = rec;
      if (action === "checkverifystatus") {
        r = withId(rec, "recordedguid", ours!);
        // The tool polls; the first poll lands before the worker has run.
        const early = (await (await send(r, ip)).json()) as { status: string; message: string; result: unknown };
        expect(early).toEqual({ status: "0", message: "NOTOK", result: "Pending in queue" });
        await work();
      }
      const res = await send(r, ip);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; message: string; result: unknown };
      seen.push({ action, body });
      if (action === "verifysourcecode") ours = body.result as string;
    }
    return { seen, address: run.address };
  }

  it("forge 1.5.1 --verifier custom (Etherscan protocol): FixtureCounter with a linked library and constructor args", async () => {
    const f = loadFixture("forge-etherscan");
    expect(f.tool).toContain("1.5.1");
    const { seen, address } = await replayEtherscan(f, 0);
    expect(seen.map((s) => s.action)).toEqual(["getabi", "verifysourcecode", "checkverifystatus"]);
    // forge treats this as "not verified yet" and goes on to submit.
    expect(seen[0].body).toEqual({ status: "0", message: "NOTOK", result: "Contract source code not verified" });
    expect(seen[1].body.status).toBe("1");
    expect(seen[1].body.message).toBe("OK");
    expect(seen[2].body).toEqual({ status: "1", message: "OK", result: "Pass - Verified" });
    const [rec] = await listMatches(holder.db!, { genesisHash: f.chain.genesisHash, address });
    expect(rec).toMatchObject({ matchType: "full", runtimeMatch: "full", creationMatch: "full", contractName: "FixtureCounter" });
  }, 180_000);

  it("forge 1.5.1 --verifier custom: a library and a plain contract", async () => {
    const f = loadFixture("forge-etherscan");
    for (const i of [1, 2]) {
      const { seen } = await replayEtherscan(f, i);
      expect(seen[seen.length - 1].body).toEqual({ status: "1", message: "OK", result: "Pass - Verified" });
    }
  }, 240_000);

  it("forge 1.5.1 --verifier sourcify (v2 API): lookup 404, submit 202, job exact_match", async () => {
    const f = loadFixture("forge-sourcify");
    holder.chain = fixtureChain(f);
    await seedIndexedCreations(holder.db!, f);
    const ip = `198.51.100.${ipSeq++}`;
    const [lookup, submit, poll] = f.runs[0].requests;
    expect([lookup.method, submit.method, poll.method]).toEqual(["GET", "POST", "GET"]);

    const l = await send(lookup, ip);
    expect(l.status).toBe(404);

    const s = await send(submit, ip);
    expect(s.status).toBe(202);
    const { verificationId } = (await s.json()) as { verificationId: string };
    const recordedId = poll.url.split("/").pop()!;
    const p = withId(poll, recordedId, verificationId);
    expect(((await (await send(p, ip)).json()) as { isJobCompleted: boolean }).isJobCompleted).toBe(false);
    await work();
    const done = (await (await send(p, ip)).json()) as { isJobCompleted: boolean; contract: { match: string; runtimeMatch: string; creationMatch: string } };
    expect(done.isJobCompleted).toBe(true);
    expect(done.contract).toMatchObject({ match: "exact_match", runtimeMatch: "exact_match", creationMatch: "exact_match" });

    const after = await send(lookup, ip);
    expect(after.status).toBe(200);
  }, 180_000);

  it("hardhat 2.29.1 + hardhat-verify 2.1.3 (customChains): FixtureCounter with a linked library and constructor args", async () => {
    const f = loadFixture("hardhat-etherscan");
    expect(f.tool).toContain("hardhat-verify 2.1.3");
    const { seen, address } = await replayEtherscan(f, 0);
    expect(seen.map((s) => s.action)).toEqual(["getsourcecode", "verifysourcecode", "checkverifystatus"]);
    // hardhat-verify's isVerified(): message "OK" and an empty SourceCode means not verified.
    expect(seen[0].body.message).toBe("OK");
    expect((seen[0].body.result as Array<{ SourceCode: string }>)[0].SourceCode).toBe("");
    expect(seen[1].body.status).toBe("1");
    expect(seen[2].body).toEqual({ status: "1", message: "OK", result: "Pass - Verified" });
    const [rec] = await listMatches(holder.db!, { genesisHash: f.chain.genesisHash, address });
    expect(rec).toMatchObject({ matchType: "full", creationMatch: "full" });
    expect(JSON.parse(rec.libraries!)).toEqual({ "contracts/Fixture.sol:FixtureMath": f.chain.contracts[0].address });
  }, 180_000);
});
