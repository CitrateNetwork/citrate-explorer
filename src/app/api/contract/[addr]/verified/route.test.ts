import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { keccak256, type Hex } from "viem";
import { migratedPglite } from "@/lib/db/tests/pglite";
import { contractProxies } from "@/lib/db/schema";
import type { ChainDb } from "@/lib/indexer/types";
import type { ChainReader } from "@/lib/verify/chain";
import { appendVerified, type NewVerifiedRow } from "@/lib/verify/store";
import { FORGE, fixtureChain, loadFixture } from "@/lib/verify/tests/fixtures";
import { createApiSourceV2 } from "@/lib/contract/infoSources";
import type { VerifiedContractResponseV2 } from "@/lib/contract/v2Types";

/**
 * GET /api/contract/{a}/verified: the verification v2 record the contract page reads
 * (explorer#52 P2), against PGlite with the real migrations and the forge fixture's chain
 * state. Then the page's adapter (createApiSourceV2) over this route, so source maps, every
 * source file and the creation match reach ContractInfo; and a record copied forward from
 * the v1 store (migration 0006) still reads.
 */
const holder: { db: ChainDb | null; chain: ChainReader | null } = { db: null, chain: null };
vi.mock("@/lib/verify/deps", () => ({ verifyDeps: () => ({ db: holder.db, chain: holder.chain }) }));

import { GET } from "./route";

const f = loadFixture("forge-etherscan");
const codeOf = (a: string) => f.chain.contracts.find((c) => c.address === a)!.code;
let ipSeq = 1;

function call(addr: string): Promise<Response> {
  const req = new Request(`https://explorer.citrate.ai/api/contract/${addr}/verified`, { headers: { "x-forwarded-for": `203.0.113.${ipSeq++}` } });
  return GET(req, { params: Promise.resolve({ addr }) });
}

/** fetch for the adapter, served by the route handler in-process. */
const routeFetch = (async (url: string) => {
  const addr = new URL(url, "https://explorer.citrate.ai").pathname.split("/")[3];
  return call(addr);
}) as unknown as typeof fetch;

const STD = {
  language: "Solidity",
  sources: {
    "src/lib/Owned.sol": { content: "abstract contract Owned {}" },
    "src/Registry.sol": { content: "import './lib/Owned.sol';\ncontract Registry is Owned {}" },
  },
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun", outputSelection: { "*": { "*": ["abi"] } } },
};

function record(o: Partial<NewVerifiedRow> = {}): NewVerifiedRow {
  return {
    chainId: 40204,
    genesisHash: f.chain.genesisHash,
    address: FORGE.counter,
    runtimeCodeHash: keccak256(codeOf(FORGE.counter) as Hex).toLowerCase(),
    runtimeMaskedHash: "0x" + "e5".repeat(32),
    runtimeCodeLength: (codeOf(FORGE.counter).length - 2) / 2,
    matchType: "full",
    runtimeMatch: "full",
    creationMatch: "full",
    sourceFormat: "solidity-standard-json-input",
    contractName: "Registry",
    fullyQualifiedName: "src/Registry.sol:Registry",
    compilerVersion: "v0.8.26+commit.8a97fa7a",
    solcLongVersion: "0.8.26+commit.8a97fa7a",
    stdJsonInput: JSON.stringify(STD),
    abi: JSON.stringify([{ type: "function", name: "owner", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" }]),
    deployedSourceMap: "0:10:1:-:0;12:4:0",
    constructorArgs: "00ff",
    ...o,
  };
}

describe("GET /api/contract/{a}/verified (verification v2 record)", () => {
  let ctx: Awaited<ReturnType<typeof migratedPglite>>;

  beforeAll(async () => {
    ctx = await migratedPglite();
  });
  afterAll(async () => ctx.close());
  beforeEach(async () => {
    await ctx.truncateAll();
    holder.db = ctx.db as unknown as ChainDb;
    holder.chain = fixtureChain(f);
  });

  it("returns the best record for the live code as JSON (camelCase, ISO timestamps), with no store error", async () => {
    const id = await appendVerified(holder.db!, record());
    const res = await call(FORGE.counter.toUpperCase().replace("0X", "0x"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as VerifiedContractResponseV2;
    expect(body.storeAvailable).toBe(true);
    expect(body.original).toBeNull();
    expect(body.proxy).toBeNull();
    expect(body.record).toMatchObject({ id, address: FORGE.counter, matchType: "full", creationMatch: "full", deployedSourceMap: "0:10:1:-:0;12:4:0" });
    expect(new Date(body.record!.createdAt).toISOString()).toBe(body.record!.createdAt);
  });

  it("feeds the contract page adapter: every source file, the source map, settings and the creation match", async () => {
    await appendVerified(holder.db!, record());
    const info = await createApiSourceV2({ fetch: routeFetch }).load(FORGE.counter);
    expect(info).toMatchObject({ origin: "verified-contracts-v2", status: "verified", verified: true, contractName: "Registry", creationMatch: "full", runtimeMatch: "full", constructorArgs: "00ff" });
    expect(info.sources.map((s) => s.path)).toEqual(["src/lib/Owned.sol", "src/Registry.sol"]);
    expect(info.deployedSourceMap).toBe("0:10:1:-:0;12:4:0");
    // solc numbers source units in sorted name order.
    expect(info.sourceIndexById).toEqual({ 0: 1, 1: 0 });
    expect(info.settings).toEqual({ optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" });
    expect(info.abi?.[0]).toMatchObject({ name: "owner" });
  });

  it("a record for other code at the address (a reroll, or the code changed) is not returned", async () => {
    await appendVerified(holder.db!, record({ runtimeCodeHash: "0x" + "99".repeat(32) }));
    await appendVerified(holder.db!, record({ genesisHash: "0x" + "77".repeat(32) }));
    const body = (await (await call(FORGE.counter)).json()) as VerifiedContractResponseV2;
    expect(body).toEqual({ record: null, original: null, proxy: null, storeAvailable: true });
    expect((await createApiSourceV2({ fetch: routeFetch }).load(FORGE.counter)).status).toBe("unverified");
  });

  it("a v1 record copied forward by migration 0006 still reads (one file, no genesis) and is shown as not confirmed", async () => {
    await appendVerified(holder.db!, {
      chainId: 40204,
      genesisHash: null,
      address: FORGE.counter,
      matchType: "full",
      runtimeMatch: "full",
      sourceFormat: "legacy",
      contractName: "FixtureCounter",
      fullyQualifiedName: "src/Fixture.sol:FixtureCounter",
      compilerVersion: "v0.8.26+commit.8a97fa7a",
      abi: "[]",
      legacyGuid: "abc123",
      legacySource: "contract FixtureCounter {}",
    });
    const info = await createApiSourceV2({ fetch: routeFetch }).load(FORGE.counter);
    expect(info).toMatchObject({ status: "legacy-unconfirmed", verified: false, contractName: "FixtureCounter", creationMatch: null, deployedSourceMap: null });
    expect(info.sources).toEqual([{ path: "FixtureCounter.sol", content: "contract FixtureCounter {}" }]);
  });

  it("a similar match carries the original record, and a recorded proxy link comes along", async () => {
    const origId = await appendVerified(holder.db!, record({ address: FORGE.plainA, runtimeCodeHash: "0x" + "12".repeat(32) }));
    await appendVerified(holder.db!, record({ matchType: "similar", similarTo: origId, stdJsonInput: null, deployedSourceMap: null, contractName: null }));
    await holder.db!.insert(contractProxies).values({ id: "p1", chainId: 40204, genesisHash: f.chain.genesisHash, address: FORGE.counter, implementation: FORGE.plainA, proxyType: "eip1967" });
    const body = (await (await call(FORGE.counter)).json()) as VerifiedContractResponseV2;
    expect(body.record?.matchType).toBe("similar");
    expect(body.original?.id).toBe(origId);
    expect(body.proxy).toMatchObject({ implementation: FORGE.plainA, proxyType: "eip1967" });
    const info = await createApiSourceV2({ fetch: routeFetch }).load(FORGE.counter);
    expect(info).toMatchObject({ status: "similar-match", verified: false, contractName: "Registry", deployedSourceMap: "0:10:1:-:0;12:4:0" });
    expect(info.sources).toHaveLength(2);
  });

  it("an address with no code is unverified, not an error", async () => {
    const body = (await (await call("0x" + "ab".repeat(20))).json()) as VerifiedContractResponseV2;
    expect(body).toEqual({ record: null, original: null, proxy: null, storeAvailable: true });
  });

  it("no database: storeAvailable false, and the page says unknown rather than unverified", async () => {
    holder.db = null;
    const body = (await (await call(FORGE.counter)).json()) as VerifiedContractResponseV2;
    expect(body.storeAvailable).toBe(false);
    expect((await createApiSourceV2({ fetch: routeFetch }).load(FORGE.counter)).status).toBe("unavailable");
  });

  it("an RPC or store failure is a 502 with a generic message, and the page says unknown", async () => {
    holder.chain = { ...fixtureChain(f), getCode: async () => { throw new Error("connect ECONNREFUSED 10.0.0.5:8545"); } };
    const res = await call(FORGE.counter);
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("10.0.0.5");
    expect((await createApiSourceV2({ fetch: routeFetch }).load(FORGE.counter)).status).toBe("unavailable");
  });

  it("refuses a malformed address", async () => {
    expect((await call("0x1234")).status).toBe(400);
  });
});
