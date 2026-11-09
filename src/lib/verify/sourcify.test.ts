import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getAddress } from "viem";
import { migratedPglite } from "@/lib/db/tests/pglite";
import type { ChainDb } from "@/lib/indexer/types";
import type { ContractApiDeps } from "./etherscan";
import { sourcifyContract, sourcifyJob, sourcifyVerify } from "./sourcify";
import { getVerified } from "./store";
import { runOnce } from "./worker";
import { FORGE, fixtureChain, loadFixture, realCompiler, seedIndexedCreations } from "./tests/fixtures";

/**
 * EXP-S2 Sourcify v2 API: verify (standard JSON and metadata), job status and
 * contract lookup, in Sourcify's shapes, against PGlite, the recorded anvil
 * chain and the real worker + solc.
 */
const forge = loadFixture("forge-sourcify");
const forgeEs = loadFixture("forge-etherscan");
const sfBody = () => JSON.parse(forge.runs[0].requests.find((r) => r.method === "POST")!.body);

describe("Sourcify v2 API (EXP-S2)", () => {
  let ctx: Awaited<ReturnType<typeof migratedPglite>>;
  let deps: ContractApiDeps;
  const chain = fixtureChain(forge);
  const compile = realCompiler();
  const work = async () => {
    while ((await runOnce({ db: deps.db!, chain, compile }, { workerId: "t" })) === "processed");
  };

  beforeAll(async () => {
    ctx = await migratedPglite();
    deps = { db: ctx.db as unknown as ChainDb, chain };
    await seedIndexedCreations(deps.db!, forge);
  });
  afterAll(async () => ctx.close());

  it("GET /v2/contract for an unverified contract is 404 not_found", async () => {
    const r = await sourcifyContract(deps, "40204", FORGE.counter, null);
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ customCode: "not_found" });
    expect((r.body as { errorId: string }).errorId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("refuses another chain with unsupported_chain", async () => {
    const r = await sourcifyVerify(deps, "1", FORGE.counter, sfBody(), "stdjson");
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ customCode: "unsupported_chain" });
  });

  it("POST standard JSON -> 202 verificationId -> job completes with exact matches", async () => {
    const sub = await sourcifyVerify(deps, "40204", getAddress(FORGE.counter), sfBody(), "stdjson");
    expect(sub.status).toBe(202);
    const id = (sub.body as { verificationId: string }).verificationId;
    const pending = await sourcifyJob(deps, id);
    expect(pending.body).toMatchObject({ isJobCompleted: false, verificationId: id, contract: { match: null } });
    await work();
    const done = await sourcifyJob(deps, id);
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({
      isJobCompleted: true,
      verificationId: id,
      contract: { match: "exact_match", runtimeMatch: "exact_match", creationMatch: "exact_match", chainId: "40204", address: getAddress(FORGE.counter) },
    });
    expect(done.body).not.toHaveProperty("error");
  }, 120_000);

  it("GET /v2/contract?fields=all returns the stored compilation, sources, ABI and deployment", async () => {
    const r = await sourcifyContract(deps, "40204", FORGE.counter, "all");
    expect(r.status).toBe(200);
    const b = r.body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(b).toMatchObject({ match: "exact_match", runtimeMatch: "exact_match", creationMatch: "exact_match", chainId: "40204" });
    expect(b.compilation).toMatchObject({ compiler: "solc", compilerVersion: "0.8.26+commit.8a97fa7a", name: "FixtureCounter", fullyQualifiedName: "src/Fixture.sol:FixtureCounter" });
    expect(Object.keys(b.sources)).toEqual(["src/Fixture.sol"]);
    expect(b.stdJsonInput.settings.libraries).toEqual({ "src/Fixture.sol": { FixtureMath: getAddress(FORGE.library) } });
    expect(b.abi.some((x: { name?: string }) => x.name === "bump")).toBe(true);
    expect(b.deployment.transactionHash).toBe(forge.chain.contracts[1].creationTx.hash);
    expect(b.creationBytecode.constructorArguments).toMatch(/^0x0{63}7/);
    expect(b.storageLayout.storage).toHaveLength(2);
    expect(b.runtimeBytecode.onchainBytecode).toBe(forge.chain.contracts[1].code.toLowerCase());
    expect(b.proxyResolution).toEqual({ isProxy: false, proxyType: null, implementations: [] });
  });

  it("a second exact submission is 409 already_verified", async () => {
    const r = await sourcifyVerify(deps, "40204", FORGE.counter, sfBody(), "stdjson");
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ customCode: "already_verified" });
  });

  it("metadata-based verification: solc metadata.json + sources", async () => {
    // Take FixturePlain's metadata and sources from a standard-JSON verification of the
    // same build in a scratch store, then verify plainA with only those.
    const scratch = await migratedPglite();
    const sdeps = { db: scratch.db as unknown as ChainDb, chain };
    const esForm = new URLSearchParams(forgeEs.runs[2].requests.find((q) => q.method === "POST" && q.body.includes("verifysourcecode"))!.body);
    const std = JSON.parse(esForm.get("sourceCode")!);
    const tmp = await sourcifyVerify(sdeps, "40204", FORGE.plainA, { stdJsonInput: std, compilerVersion: "0.8.26+commit.8a97fa7a", contractIdentifier: "src/Fixture.sol:FixturePlain" }, "stdjson");
    while ((await runOnce({ db: sdeps.db, chain, compile }, { workerId: "s" })) === "processed");
    const tmpJob = await sourcifyJob(sdeps, (tmp.body as { verificationId: string }).verificationId);
    const matchId = (tmpJob.body as { contract: { matchId: string } }).contract.matchId;
    const metadata = (await getVerified(sdeps.db, matchId))!.metadata!;
    await scratch.close();

    const sources = Object.fromEntries(Object.entries(std.sources as Record<string, { content: string }>).map(([k, v]) => [k, v.content]));
    const sub = await sourcifyVerify(deps, "40204", FORGE.plainA, { metadata: JSON.parse(metadata), sources }, "metadata");
    expect(sub.status).toBe(202);
    await work();
    const done = await sourcifyJob(deps, (sub.body as { verificationId: string }).verificationId);
    expect(done.body).toMatchObject({ isJobCompleted: true, contract: { match: "exact_match", runtimeMatch: "exact_match", creationMatch: "exact_match" } });
  }, 180_000);

  it("a failed job reports isJobCompleted with an error and no match", async () => {
    const body = sfBody();
    body.stdJsonInput.sources["src/Fixture.sol"].content = body.stdJsonInput.sources["src/Fixture.sol"].content.replace("value = v;", "value = v + 1;");
    body.contractIdentifier = "src/Fixture.sol:FixturePlain";
    const sub = await sourcifyVerify(deps, "40204", FORGE.plainB, body, "stdjson");
    await work();
    const done = await sourcifyJob(deps, (sub.body as { verificationId: string }).verificationId);
    expect(done.body).toMatchObject({ isJobCompleted: true, contract: { match: null }, error: { customCode: "no_match" } });
  }, 120_000);

  it("an unknown verificationId is 404 job_not_found", async () => {
    const r = await sourcifyJob(deps, "00000000-0000-4000-8000-000000000000");
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ customCode: "job_not_found" });
  });
});

describe("Sourcify v2 API: a similar match is never an exact match", () => {
  let ctx: Awaited<ReturnType<typeof migratedPglite>>;
  beforeAll(async () => {
    ctx = await migratedPglite();
  });
  afterAll(async () => ctx.close());

  it("GET /v2/contract for an address carrying another contract's source reports match, not exact_match", async () => {
    const { appendVerified } = await import("./store");
    const { keccak256 } = await import("viem");
    const chain = fixtureChain(forgeEs);
    const deps = { db: ctx.db as unknown as ChainDb, chain };
    const code = forgeEs.chain.contracts.find((c) => c.address === FORGE.plainB)!.code;
    await appendVerified(deps.db, {
      chainId: 40204, genesisHash: forgeEs.chain.genesisHash, address: FORGE.plainB, runtimeCodeHash: keccak256(code as `0x${string}`).toLowerCase(),
      matchType: "similar", runtimeMatch: "full", creationMatch: null, sourceFormat: "solidity-standard-json-input", contractName: "FixturePlain", stdJsonInput: "{}",
    });
    const r = await sourcifyContract(deps, "40204", FORGE.plainB, null);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ match: "match", runtimeMatch: "match", creationMatch: null });
  });
});
