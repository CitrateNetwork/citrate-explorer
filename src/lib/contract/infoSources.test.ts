import { describe, expect, it } from "vitest";
import { createApiSourceV1, createV2InfoSource, fromV2Response } from "./infoSources";
import type { VerifiedContractRecordV2 } from "./v2Types";
import fixture from "./__fixtures__/registry.json";

const ADDR = "0xaa918302b94a4b0e75e01e019cc6b819b4f7c906";

function jsonFetch(body: unknown, status = 200) {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("ContractInfoSource: today's /api/contract/{a}/source route", () => {
  it("maps a verified record to a single-file ContractInfo with no source map", async () => {
    const { f, calls } = jsonFetch({
      address: ADDR,
      status: "verified",
      verified: true,
      matchType: "full",
      contractName: "WrappedSALT",
      compilerVersion: "v0.8.26+commit.8a97fa7a",
      sourceHash: "0x01",
      source: "contract WrappedSALT {}",
      sourceChars: 23,
      sourceTruncated: false,
      abi: [{ type: "function", name: "deposit", inputs: [], outputs: [], stateMutability: "payable" }],
      verifiedAt: "2026-11-01T00:00:00.000Z",
      note: "Verified.",
    });
    const info = await createApiSourceV1({ fetch: f }).load(ADDR);
    expect(calls[0]).toBe(`/api/contract/${ADDR}/source?maxSourceChars=400000`);
    expect(info).toMatchObject({
      status: "verified",
      verified: true,
      contractName: "WrappedSALT",
      sources: [{ path: "WrappedSALT.sol", content: "contract WrappedSALT {}" }],
      deployedSourceMap: null,
      sourceIndexById: null,
      origin: "api-source-v1",
    });
    expect(info.abi?.[0]).toMatchObject({ name: "deposit" });
  });

  it("passes 'unavailable' through instead of claiming unverified", async () => {
    const { f } = jsonFetch({ address: ADDR, status: "unavailable", verified: false, matchType: null, contractName: null, compilerVersion: null, sourceHash: null, source: null, sourceChars: 0, sourceTruncated: false, abi: null, verifiedAt: null, note: "The verification store is unavailable right now." });
    const info = await createApiSourceV1({ fetch: f }).load(ADDR);
    expect(info.status).toBe("unavailable");
    expect(info.abi).toBeNull();
  });

  it("reports a failed request as unavailable", async () => {
    const { f } = jsonFetch({ error: "rate limited" }, 429);
    const info = await createApiSourceV1({ fetch: f }).load(ADDR);
    expect(info.status).toBe("unavailable");
  });
});

describe("ContractInfoSource: verification v2 record shape", () => {
  const record: VerifiedContractRecordV2 = {
    id: "5b0f6c1e-0000-4000-8000-000000000001",
    chainId: 40204,
    genesisHash: "0x1d",
    address: ADDR,
    runtimeCodeHash: "0x02",
    matchType: "full",
    runtimeMatch: "full",
    creationMatch: "full",
    similarTo: null,
    sourceFormat: "solidity-standard-json-input",
    contractName: "Registry",
    fullyQualifiedName: "src/Registry.sol:Registry",
    compilerVersion: fixture.compiler,
    solcLongVersion: fixture.compiler,
    stdJsonInput: JSON.stringify(fixture.stdJsonInput),
    metadata: null,
    abi: JSON.stringify(fixture.abi),
    storageLayout: null,
    deployedSourceMap: fixture.deployedSourceMap,
    creationSourceMap: null,
    immutableReferences: null,
    constructorArgs: "0x000000000000000000000000000000000000000000000000000000000000dead",
    libraries: null,
    creationTxHash: null,
    deployer: null,
    sourceHash: null,
    legacyGuid: null,
    legacySource: null,
    createdAt: "2026-11-05T00:00:00.000Z",
  };

  it("a record copied forward from the v1 store is never green, even when it was a full match there", () => {
    const legacy: VerifiedContractRecordV2 = { ...record, genesisHash: null, runtimeCodeHash: null, sourceFormat: "legacy", stdJsonInput: null, legacyGuid: "abc", legacySource: "contract Registry {}", creationMatch: null };
    const info = fromV2Response({ record: legacy, original: null, proxy: null, storeAvailable: true });
    expect(info).toMatchObject({ status: "legacy-unconfirmed", verified: false });
    expect(info.note).toMatch(/not confirmed/i);
    expect(info.sources).toEqual([{ path: "Registry.sol", content: "contract Registry {}" }]);
  });

  it("maps the standard-JSON input to a multi-file tree with solc's source ids and settings", () => {
    const info = fromV2Response({ record, original: null, proxy: null, storeAvailable: true });
    expect(info.sources.map((s) => s.path)).toEqual(["src/Registry.sol", "src/interfaces/IRegistry.sol", "src/lib/Owned.sol"]);
    for (const [name, id] of Object.entries(fixture.sourceIds)) expect(info.sources[info.sourceIndexById![id as number]].path).toBe(name);
    expect(info.deployedSourceMap).toBe(fixture.deployedSourceMap);
    expect(info.settings).toEqual({ optimizer: { enabled: true, runs: 200 }, evmVersion: "shanghai" });
    expect(info).toMatchObject({ status: "verified", verified: true, runtimeMatch: "full", creationMatch: "full", origin: "verified-contracts-v2" });
  });

  it("uses explicit sourceIds when the record carries them", () => {
    const info = fromV2Response({ record: { ...record, sourceIds: { "src/lib/Owned.sol": 0, "src/Registry.sol": 1, "src/interfaces/IRegistry.sol": 2 } }, original: null, proxy: null, storeAvailable: true });
    expect(info.sources[info.sourceIndexById![0]].path).toBe("src/lib/Owned.sol");
  });

  it("labels a similar match as not verified at this address and shows the original's source", () => {
    const sim = { ...record, id: "x", matchType: "similar" as const, similarTo: record.id, stdJsonInput: null, abi: null, deployedSourceMap: null };
    const info = fromV2Response({ record: sim, original: record, proxy: null, storeAvailable: true });
    expect(info.status).toBe("similar-match");
    expect(info.verified).toBe(false);
    expect(info.sources).toHaveLength(3);
    expect(info.abi).not.toBeNull();
  });

  it("a partial match is not verified", () => {
    expect(fromV2Response({ record: { ...record, matchType: "partial" }, original: null, proxy: null, storeAvailable: true })).toMatchObject({ status: "partial-match", verified: false });
  });

  it("no record means unverified; an unreadable store means unavailable", async () => {
    expect(fromV2Response({ record: null, original: null, proxy: null, storeAvailable: true }).status).toBe("unverified");
    expect(fromV2Response({ record: null, original: null, proxy: null, storeAvailable: false }).status).toBe("unavailable");
    const src = createV2InfoSource(async () => ({ record, original: null, proxy: null, storeAvailable: true }));
    expect((await src.load(ADDR)).contractName).toBe("Registry");
  });
});
