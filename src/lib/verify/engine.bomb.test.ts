import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChainReader } from "./chain";
import type { ChainDb } from "@/lib/indexer/types";
import { processJob } from "./job";
import { fromApiJson, RequestError } from "./request";
import type { JobRow } from "./store";

/**
 * FWA-C12-03 (integration RED→GREEN): a compile-bomb input must be REJECTED BEFORE
 * the compiler is ever invoked — proving the input bound short-circuits the
 * expensive path rather than handing a pathological payload to solc.
 *
 * EXP-S2: compiles moved to the verify worker. The bound now holds at both ends:
 * the front door refuses the submission (no job is created), and the worker
 * re-checks before it calls the compiler. We spy on the injected compiler and
 * assert it is NOT called for a bomb input.
 */
const compileSpy = vi.fn(async () => ({ contracts: {}, compiler: "vX" }));

const ADDR = ("0x" + "c".repeat(40)) as `0x${string}`;

// On-chain code reads as a contract so we get past the EOA guard and reach compile.
const chain: ChainReader = {
  chainId: 40204,
  genesisHash: async () => "0x" + "0".repeat(64),
  getCode: async () => "0xabcd",
  getTransaction: async () => null,
  getReceipt: async () => null,
  getStorageAt: async () => "0x" + "0".repeat(64),
  call: async () => "0x",
};
// The bounded paths never reach the database; findCreation is only hit after a compile.
const db = {
  select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }), limit: async () => [] }) }) }),
} as unknown as ChainDb;

function bombStandardJson(): string {
  const sources: Record<string, { content: string }> = {};
  for (let i = 0; i < 2000; i++) sources[`F${i}.sol`] = { content: "contract X {}" };
  return JSON.stringify({ language: "Solidity", sources });
}

function jobFor(request: unknown): JobRow {
  return {
    id: "g",
    kind: "verify",
    status: "running",
    origin: "api",
    chainId: 40204,
    genesisHash: null,
    address: ADDR,
    request: JSON.stringify(request),
    sourceHash: null,
    attempts: 1,
    workerId: "t",
    lockedAt: new Date(),
    createdAt: new Date(),
    startedAt: new Date(),
    finishedAt: null,
    resultCode: null,
    resultMessage: null,
    matchType: null,
    verifiedContractId: null,
  };
}

describe("verification — compile-bomb is bounded before solc (FWA-C12-03)", () => {
  beforeEach(() => compileSpy.mockClear());

  it("rejects a 2000-source compile-bomb WITHOUT invoking the compiler", async () => {
    expect(() =>
      fromApiJson({ address: ADDR, format: "solidity-standard-json-input", compilerVersion: "0.8.26", source: bombStandardJson() }),
    ).toThrow(/too many source files/);
    // A job that somehow carries one (e.g. queued before a bound changed) is refused by the worker too.
    const out = await processJob(
      jobFor({
        address: ADDR,
        format: "solidity-standard-json-input",
        compilerVersion: "0.8.26",
        stdJsonInput: JSON.parse(bombStandardJson()),
        contractIdentifier: null,
        constructorArgs: null,
        creationTxHash: null,
        libraries: {},
      }),
      { db, chain, compile: compileSpy },
    );
    expect(out.status).toBe("fail");
    expect(out.message.toLowerCase()).toContain("too many source files");
    expect(compileSpy).not.toHaveBeenCalled();
  });

  it("rejects a urls-based (out-of-band fetch) source without compiling", async () => {
    let err: unknown;
    try {
      fromApiJson({
        address: ADDR,
        format: "solidity-standard-json-input",
        compilerVersion: "0.8.26",
        source: JSON.stringify({ language: "Solidity", sources: { "R.sol": { urls: ["https://evil.example/x.sol"] } } }),
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RequestError);
    expect(compileSpy).not.toHaveBeenCalled();
  });

  it("still reaches the compiler for a normal, in-bounds input", async () => {
    const req = fromApiJson({ address: ADDR, format: "solidity-single-file", compilerVersion: "0.8.26", source: "contract A {}" });
    const out = await processJob(jobFor(req), { db, chain, compile: compileSpy });
    // compiles (no contracts returned by the stub) → a clean failure.
    expect(compileSpy).toHaveBeenCalledTimes(1);
    expect(out.status).toBe("fail");
  });
});
