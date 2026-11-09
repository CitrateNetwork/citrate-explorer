import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { migratedPglite } from "@/lib/db/tests/pglite";
import type { ChainDb } from "@/lib/indexer/types";
import type { ChainReader } from "./chain";
import { countOpenJobs, enqueueJob, getJob, listMatches } from "./store";
import { fromEtherscanForm } from "./request";
import { verifiedContracts } from "@/lib/db/schema";
import { runOnce } from "./worker";
import { fixtureChain, loadFixture, realCompiler, seedIndexedCreations, type RecordedRequest, type ToolFixture } from "./tests/fixtures";

/**
 * The Citrate clients against the verification API, end to end.
 * scripts/verify/capture-client-fixtures.mjs pointed `citrate contract verify | verify-get`
 * (citrate-chain cli, its own command code), @citrate/sdk `verifyContract` and citrate_sdk
 * `verify_contract` at a recorder; the recorded requests go here, in order, to the real
 * `/api` route handler with PGlite as the database, the forge fixture's anvil state as the
 * chain, and the real worker + solc 0.8.26 between submission and status polls.
 *
 * The client-side reading of each answer is checked with the rules the clients apply
 * (citrate-chain cli/src/commands/verify.rs classify_status / submit_once, sdk-js
 * src/verify/index.ts checkVerifyStatus / submitVerification, sdk-python citrate_sdk/verify.py):
 * status "1" = success; result containing "already verified" = verified; result starting
 * with "pending" or containing "rate limit" = keep polling / retry the submission.
 */
const holder: { db: ChainDb | null; chain: ChainReader | null } = { db: null, chain: null };
vi.mock("@/lib/verify/deps", () => ({ verifyDeps: () => ({ db: holder.db, chain: holder.chain }) }));

import { GET as apiGet, POST as apiPost } from "@/app/api/route";

const BASE = "https://explorer.citrate.ai";
let ipSeq = 10;

interface Reply {
  status: string;
  message: string;
  result: unknown;
}

/** How the CLI and both SDKs read a checkverifystatus answer. */
function clientVerdict(r: Reply): "verified" | "pending" | "failed" {
  const text = typeof r.result === "string" ? r.result : JSON.stringify(r.result);
  if (r.status === "1" || /already verified/i.test(text)) return "verified";
  if (/^pending/i.test(text) || /rate limit/i.test(text)) return "pending";
  return "failed";
}

/** How the CLI and both SDKs read a verifysourcecode answer. */
function clientSubmit(r: Reply): "guid" | "already_verified" | "rate_limited" | "rejected" {
  const text = typeof r.result === "string" ? r.result : JSON.stringify(r.result);
  if (r.status === "1") return "guid";
  if (/already verified/i.test(text)) return "already_verified";
  if (/rate limit/i.test(text)) return "rate_limited";
  return "rejected";
}

function rewrite(r: RecordedRequest, edit: (p: URLSearchParams) => void): RecordedRequest {
  if (r.method === "POST") {
    const p = new URLSearchParams(r.body);
    edit(p);
    return { ...r, body: p.toString() };
  }
  const u = new URL(r.url, BASE);
  const p = new URLSearchParams(u.search);
  edit(p);
  return { ...r, url: `${u.pathname}?${p.toString()}` };
}

async function send(r: RecordedRequest, ip: string): Promise<{ http: number; body: Reply }> {
  const url = new URL(r.url, BASE);
  expect(url.pathname).toBe("/api");
  const req = new Request(url, {
    method: r.method,
    headers: { ...(r.contentType ? { "content-type": r.contentType } : {}), "x-forwarded-for": ip },
    body: r.method === "POST" ? r.body : undefined,
  });
  const res = r.method === "POST" ? await apiPost(req) : await apiGet(req);
  return { http: res.status, body: (await res.json()) as Reply };
}

const actionOf = (r: RecordedRequest) => new URLSearchParams(r.method === "POST" ? r.body : new URL(r.url, BASE).search).get("action")!;

describe("Citrate CLI and SDK requests replayed against the verification API", () => {
  let ctx: Awaited<ReturnType<typeof migratedPglite>>;
  let f: ToolFixture;
  const compile = realCompiler();
  const work = async () => {
    while ((await runOnce({ db: holder.db!, chain: holder.chain!, compile, similarScanLimit: 20 }, { workerId: "clients" })) === "processed");
  };
  const run = (prefix: string) => {
    const r = f.runs.find((x) => x.name.startsWith(prefix));
    if (!r) throw new Error(`no captured run ${prefix}`);
    return r;
  };

  beforeAll(async () => {
    ctx = await migratedPglite();
    holder.db = ctx.db as unknown as ChainDb;
    f = loadFixture("citrate-clients");
  });
  afterAll(async () => ctx.close());
  beforeEach(async () => {
    await ctx.truncateAll();
    holder.chain = fixtureChain(f);
    await seedIndexedCreations(holder.db!, f);
  });

  /** Replay one captured client run: submit, a poll before the worker ran, then polls after. */
  async function replay(name: string) {
    const r = run(name);
    const ip = `198.51.100.${ipSeq++}`;
    let guid: string | null = null;
    let polled = false;
    const seen: Array<{ action: string; body: Reply }> = [];
    for (const rec of r.requests) {
      const action = actionOf(rec);
      let q = rec;
      if (action === "checkverifystatus") {
        q = rewrite(rec, (p) => p.set("guid", guid!));
        if (!polled) {
          const early = await send(q, ip);
          expect(early.body).toEqual({ status: "0", message: "NOTOK", result: "Pending in queue" });
          expect(clientVerdict(early.body)).toBe("pending");
          await work();
          polled = true;
        }
      }
      const res = await send(q, ip);
      expect(res.http).toBe(200);
      seen.push({ action, body: res.body });
      if (action === "verifysourcecode") {
        expect(clientSubmit(res.body)).toBe("guid");
        guid = res.body.result as string;
      }
    }
    return { seen, address: r.address, client: r.client };
  }

  it("citrate CLI: --standard-json with constructor args and --chain-id 40204 verifies with a full runtime and creation match", async () => {
    const { seen, address, client } = await replay("citrate contract verify --standard-json");
    expect(client).toMatch(/^citrate-cli@/);
    expect(seen.map((s) => s.action)).toEqual(["verifysourcecode", "checkverifystatus", "checkverifystatus"]);
    expect(seen[2].body).toEqual({ status: "1", message: "OK", result: "Pass - Verified" });
    expect(clientVerdict(seen[2].body)).toBe("verified");
    const [rec] = await listMatches(holder.db!, { genesisHash: f.chain.genesisHash, address });
    expect(rec).toMatchObject({ matchType: "full", runtimeMatch: "full", creationMatch: "full", contractName: "FixtureCounter" });
    expect(rec.constructorArgs).toBe(new URLSearchParams(run("citrate contract verify --standard-json").requests[0].body).get("constructorArguments"));
  }, 180_000);

  it("citrate CLI: verify-get reads the verified record back in Etherscan's getsourcecode shape", async () => {
    await replay("citrate contract verify --standard-json");
    const [get] = run("citrate contract verify-get").requests;
    const res = await send(get, `198.51.100.${ipSeq++}`);
    expect(res.body.status).toBe("1");
    const [entry] = res.body.result as Array<Record<string, string>>;
    expect(entry.ContractName).toBe("FixtureCounter");
    expect(entry.CompilerVersion).toBe("v0.8.26+commit.8a97fa7a");
    expect(entry.ContractFileName).toBe("src/Fixture.sol");
    expect(entry.SourceCode.startsWith("{{") && entry.SourceCode.endsWith("}}")).toBe(true);
    expect(JSON.parse(entry.SourceCode.slice(1, -1)).sources["src/Fixture.sol"].content).toContain("contract FixtureCounter");
    expect(JSON.parse(entry.ABI)).toBeInstanceOf(Array);
    expect(entry.ConstructorArguments).toMatch(/^[0-9a-f]+$/);
  }, 180_000);

  it("citrate CLI: single-file mode without chainid passes; the record is honest about the file layout (partial, not full)", async () => {
    const { seen, address } = await replay("citrate contract verify <file.sol> single-file");
    const submitted = new URLSearchParams(run("citrate contract verify <file.sol> single-file").requests[0].body);
    expect(submitted.get("codeformat")).toBe("solidity-single-file");
    expect(submitted.has("chainid")).toBe(false);
    expect(seen[seen.length - 1].body).toEqual({ status: "1", message: "OK", result: "Pass - Verified" });
    const [rec] = await listMatches(holder.db!, { genesisHash: f.chain.genesisHash, address });
    // forge compiled the contract as src/Fixture.sol; a single file is named FixturePlain.sol, so
    // only the metadata hash differs: the runtime code matches after stripping metadata.
    expect(rec).toMatchObject({ sourceFormat: "solidity-single-file", contractName: "FixturePlain", matchType: "partial", runtimeMatch: "partial" });
  }, 180_000);

  it("@citrate/sdk: verifyContract with constructor args and no chainId, then a library with chainId 40204", async () => {
    for (const name of ["@citrate/sdk verifyContract standardJsonInput + constructorArgs", "@citrate/sdk verifyContract standardJsonInput, chainId 40204"]) {
      const { seen, address, client } = await replay(name);
      expect(client).toMatch(/^citrate-sdk-js@/);
      expect(clientVerdict(seen[seen.length - 1].body)).toBe("verified");
      const [rec] = await listMatches(holder.db!, { genesisHash: f.chain.genesisHash, address });
      expect(rec.matchType).toBe("full");
    }
  }, 240_000);

  it("citrate_sdk (Python): verify_contract with constructor args and chain_id 40204", async () => {
    const { seen, address, client } = await replay("citrate_sdk verify_contract");
    expect(client).toMatch(/^citrate-sdk-python@/);
    expect(seen[seen.length - 1].body).toEqual({ status: "1", message: "OK", result: "Pass - Verified" });
    const [rec] = await listMatches(holder.db!, { genesisHash: f.chain.genesisHash, address });
    expect(rec).toMatchObject({ matchType: "full", creationMatch: "full" });
  }, 180_000);

  it("a second client's submission for a contract already fully verified is answered as already verified, and the record stays", async () => {
    await replay("citrate contract verify --standard-json");
    const ip = `198.51.100.${ipSeq++}`;
    for (const name of ["@citrate/sdk verifyContract standardJsonInput + constructorArgs", "citrate_sdk verify_contract"]) {
      const res = await send(run(name).requests[0], ip);
      expect(res.body).toEqual({ status: "0", message: "NOTOK", result: "Contract source code already verified" });
      expect(clientSubmit(res.body)).toBe("already_verified");
    }
    expect(await countOpenJobs(holder.db!)).toBe(0);
    const recs = await listMatches(holder.db!, { genesisHash: f.chain.genesisHash, address: run("citrate_sdk verify_contract").address });
    expect(recs).toHaveLength(1);
  }, 180_000);

  it("a passing record survives a later failing submission for the same contract, through the worker", async () => {
    // Two submissions for FixtureCounter are queued before either runs (as when two clients
    // race): the CLI's real one, and one whose source differs in executable code.
    const ip = `198.51.100.${ipSeq++}`;
    const [submit] = run("citrate contract verify --standard-json").requests;
    const good = await send(submit, ip);
    expect(clientSubmit(good.body)).toBe("guid");
    const form = new URLSearchParams(submit.body);
    const std = JSON.parse(form.get("sourceCode")!);
    std.sources["src/Fixture.sol"].content = std.sources["src/Fixture.sol"].content.replace("FixtureMath.twice(count) + start;", "FixtureMath.twice(count) + start + 1;");
    form.set("sourceCode", JSON.stringify(std));
    const bad = fromEtherscanForm(form);
    const badId = await enqueueJob(holder.db!, { kind: "verify", origin: "etherscan", chainId: 40204, genesisHash: f.chain.genesisHash, address: bad.address, request: bad });

    await work();
    const pollOf = (guid: string) => rewrite(run("citrate contract verify --standard-json").requests[1], (p) => p.set("guid", guid));
    expect((await send(pollOf(good.body.result as string), ip)).body).toEqual({ status: "1", message: "OK", result: "Pass - Verified" });
    expect((await send(pollOf(badId), ip)).body).toEqual({ status: "0", message: "NOTOK", result: "Fail - Unable to verify" });
    expect((await getJob(holder.db!, badId))?.resultCode).toBe("no_match");

    const rows = await holder.db!.select().from(verifiedContracts);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ matchType: "full", jobId: good.body.result });
    const [get] = run("citrate contract verify-get").requests;
    const [entry] = (await send(get, ip)).body.result as Array<Record<string, string>>;
    expect(entry.SourceCode).toContain("FixtureMath.twice(count) + start;");
    expect(entry.SourceCode).not.toContain("start + 1;");
  }, 240_000);

  it("chainid is optional; only a value other than 40204 is refused, on submit and on poll, and nothing is queued", async () => {
    const ip = `198.51.100.${ipSeq++}`;
    const [submit, poll] = run("citrate_sdk verify_contract").requests;
    for (const bad of ["1", "0x9D0C", "402040"]) {
      const res = await send(rewrite(submit, (p) => p.set("chainid", bad)), ip);
      expect(res.body.status).toBe("0");
      expect(res.body.result).toMatch(/unsupported chainid/i);
      expect(clientSubmit(res.body)).toBe("rejected");
    }
    expect(await countOpenJobs(holder.db!)).toBe(0);
    const p = await send(rewrite(poll, (q) => q.set("chainid", "1")), ip);
    expect(clientVerdict(p.body)).toBe("failed");
    // The same submission without chainid, and with 40204, is accepted.
    expect(clientSubmit((await send(rewrite(submit, (q) => q.delete("chainid")), ip)).body)).toBe("guid");
    expect(clientSubmit((await send(submit, `198.51.100.${ipSeq++}`)).body)).toBe("guid");
  }, 60_000);

  it("a burst of submissions from one address gets Etherscan's rate-limit text, which every client retries", async () => {
    const ip = `198.51.100.${ipSeq++}`;
    const submit = run("@citrate/sdk verifyContract standardJsonInput, chainId 40204").requests[0];
    const verdicts: string[] = [];
    for (let i = 0; i < 7; i++) {
      const res = await send(submit, ip);
      verdicts.push(clientSubmit(res.body));
      if (verdicts[i] === "rate_limited") expect(res.body).toEqual({ status: "0", message: "NOTOK", result: "Max rate limit reached" });
    }
    expect(verdicts.slice(0, 5)).toEqual(["guid", "guid", "guid", "guid", "guid"]);
    expect(verdicts.slice(5)).toEqual(["rate_limited", "rate_limited"]);
    // The poll path reads rate-limit text as "still pending" in all three clients.
    expect(clientVerdict({ status: "0", message: "NOTOK", result: "Max rate limit reached" })).toBe("pending");
  }, 60_000);
});
