import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { encodeAbiParameters } from "viem";
import { migratedPglite } from "@/lib/db/tests/pglite";
import { contractProxies, verifiedContracts } from "@/lib/db/schema";
import type { ChainDb } from "@/lib/indexer/types";
import { processJob, type JobDeps } from "./job";
import { EIP1967_IMPL_SLOT } from "./proxy";
import { fromEtherscanForm, type VerifyRequest } from "./request";
import { claimNextJob, enqueueJob, getVerified, listMatches } from "./store";
import { FORGE, fixtureChain, loadFixture, realCompiler, seedIndexedCreations } from "./tests/fixtures";

/**
 * EXP-S2 job processing end to end below the HTTP layer: the exact standard JSON
 * forge 1.5.1 submitted, the real solc 0.8.26 in the sandbox, and the chain state
 * recorded from the anvil deployment (src/lib/verify/__fixtures__/tools).
 */
const forge = loadFixture("forge-etherscan");

/** The verifysourcecode form forge sent for a run, as a normalized request. */
function forgeRequest(run: number): VerifyRequest {
  const submit = forge.runs[run].requests.find((r) => r.method === "POST" && r.body.includes("verifysourcecode"))!;
  return fromEtherscanForm(new URLSearchParams(submit.body));
}

const COUNTER_ARGS = encodeAbiParameters([{ type: "uint256" }, { type: "string" }], [7n, "citrate fixture"]).slice(2);

describe("verify job (real solc, recorded chain)", () => {
  let ctx: Awaited<ReturnType<typeof migratedPglite>>;
  let db: ChainDb;
  let deps: JobDeps;
  const compile = realCompiler();

  async function run(req: VerifyRequest, chain = fixtureChain(forge)) {
    deps = { db, chain, compile, similarScanLimit: 50 };
    await enqueueJob(db, { kind: "verify", origin: "etherscan", chainId: 40204, genesisHash: await chain.genesisHash(), address: req.address, request: req });
    const job = await claimNextJob(db, "test", 60_000);
    return processJob(job!, deps);
  }

  beforeAll(async () => {
    ctx = await migratedPglite();
    db = ctx.db as unknown as ChainDb;
  });
  afterAll(async () => ctx.close());
  beforeEach(async () => {
    await ctx.truncateAll();
    await seedIndexedCreations(db, forge);
  });

  it("linked library + immutables + constructor args: full runtime and full creation match, every field stored", async () => {
    const r = await run(forgeRequest(0));
    expect(r.status).toBe("pass");
    expect(r.matchType).toBe("full");
    const rec = await getVerified(db, r.verifiedContractId!);
    expect(rec).toMatchObject({
      address: FORGE.counter,
      genesisHash: forge.chain.genesisHash,
      matchType: "full",
      runtimeMatch: "full",
      creationMatch: "full",
      contractName: "FixtureCounter",
      fullyQualifiedName: "src/Fixture.sol:FixtureCounter",
      solcLongVersion: "0.8.26+commit.8a97fa7a",
      constructorArgs: COUNTER_ARGS,
      creationTxHash: forge.chain.contracts[1].creationTx.hash,
      deployer: forge.chain.contracts[1].creationTx.from.toLowerCase(),
    });
    expect(JSON.parse(rec!.libraries!)).toEqual({ "src/Fixture.sol:FixtureMath": FORGE.library });
    expect(JSON.parse(rec!.stdJsonInput!).sources["src/Fixture.sol"].content).toContain("contract FixtureCounter");
    expect(JSON.parse(rec!.metadata!).compiler.version).toBe("0.8.26+commit.8a97fa7a");
    expect(JSON.parse(rec!.abi!).some((x: { name?: string }) => x.name === "bump")).toBe(true);
    expect(JSON.parse(rec!.storageLayout!).storage.map((s: { label: string }) => s.label)).toEqual(["label", "count"]);
    expect(rec!.deployedSourceMap).toMatch(/^\d+:\d+:\d+/);
    expect(rec!.creationSourceMap).toMatch(/^\d+:\d+:\d+/);
    expect(Object.keys(JSON.parse(rec!.immutableReferences!))).toHaveLength(2);
  }, 120_000);

  it("a deployed library matches despite its call-protection self address", async () => {
    const r = await run(forgeRequest(1));
    expect(r.status).toBe("pass");
    expect(r.matchType).toBe("full");
  }, 120_000);

  it("identical code at another indexed address gets a similar match pointing at the original", async () => {
    const r = await run(forgeRequest(2));
    expect(r.status).toBe("pass");
    const [similar] = await listMatches(db, { genesisHash: forge.chain.genesisHash, address: FORGE.plainB });
    expect(similar).toMatchObject({ matchType: "similar", runtimeMatch: "full", creationMatch: null, similarTo: r.verifiedContractId, contractName: "FixturePlain" });
  }, 120_000);

  it("a source that differs only in a comment is a partial match (metadata hash differs)", async () => {
    const req = forgeRequest(2);
    const file = req.stdJsonInput.sources["src/Fixture.sol"];
    file.content = file.content.replace("Verification fixture with no constructor args", "Verification fixture, comment edited");
    const r = await run(req);
    expect(r.status).toBe("pass");
    expect(r.matchType).toBe("partial");
    const rec = await getVerified(db, r.verifiedContractId!);
    expect(rec?.creationMatch).toBe("partial");
  }, 120_000);

  it("different code fails with no match and appends nothing", async () => {
    const req = forgeRequest(2);
    const file = req.stdJsonInput.sources["src/Fixture.sol"];
    file.content = file.content.replace("value = v;", "value = v + 1;");
    const r = await run(req);
    expect(r).toMatchObject({ status: "fail", code: "no_match" });
    expect(await db.select().from(verifiedContracts)).toHaveLength(0);
  }, 120_000);

  it("a named creation transaction that did not create the address is refused", async () => {
    const req = { ...forgeRequest(2), creationTxHash: forge.chain.contracts[1].creationTx.hash };
    const r = await run(req);
    expect(r).toMatchObject({ status: "fail", code: "creation_tx_mismatch" });
  }, 120_000);

  it("without an indexed or supplied creation transaction the runtime still verifies; creation is unchecked", async () => {
    await ctx.truncateAll();
    const r = await run(forgeRequest(2));
    expect(r.status).toBe("pass");
    expect((await getVerified(db, r.verifiedContractId!))?.creationMatch).toBeNull();
  }, 120_000);

  it("a second identical submission reports the existing record and appends nothing", async () => {
    const first = await run(forgeRequest(1));
    const second = await run(forgeRequest(1));
    expect(second).toMatchObject({ status: "pass", code: "already_verified", verifiedContractId: first.verifiedContractId });
    expect(await db.select().from(verifiedContracts)).toHaveLength(1);
  }, 120_000);

  it("an address with no code fails with Etherscan's message", async () => {
    const req = { ...forgeRequest(2), address: "0x" + "12".repeat(20) };
    const r = await run(req);
    expect(r).toMatchObject({ status: "fail", code: "no_code", message: `Unable to locate ContractCode at 0x${"12".repeat(20)}` });
  }, 60_000);

  it("proxy job: an EIP-1967 implementation slot is detected and recorded", async () => {
    const chain = fixtureChain(forge, {
      storage: { [FORGE.plainB]: { [EIP1967_IMPL_SLOT]: "0x" + "0".repeat(24) + FORGE.counter.slice(2) } },
    });
    deps = { db, chain, compile };
    await enqueueJob(db, { kind: "proxy", origin: "etherscan", chainId: 40204, genesisHash: forge.chain.genesisHash, address: FORGE.plainB, request: { address: FORGE.plainB, expectedImplementation: null } });
    const r = await processJob((await claimNextJob(db, "test", 60_000))!, deps);
    expect(r.status).toBe("pass");
    expect(r.message).toBe(`The proxy's (${FORGE.plainB}) implementation contract is found at ${FORGE.counter} and is successfully updated.`);
    const [link] = await db.select().from(contractProxies);
    expect(link).toMatchObject({ address: FORGE.plainB, implementation: FORGE.counter, proxyType: "eip1967" });
  });

  it("proxy job: no proxy pattern fails with Etherscan's message", async () => {
    deps = { db, chain: fixtureChain(forge), compile };
    await enqueueJob(db, { kind: "proxy", origin: "etherscan", chainId: 40204, genesisHash: forge.chain.genesisHash, address: FORGE.plainA, request: { address: FORGE.plainA, expectedImplementation: null } });
    const r = await processJob((await claimNextJob(db, "test", 60_000))!, deps);
    expect(r).toMatchObject({ status: "fail", message: "A corresponding implementation contract was unfortunately not detected for the proxy address." });
  });
});
