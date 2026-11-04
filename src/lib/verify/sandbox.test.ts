import { describe, it, expect, beforeAll } from "vitest";
import { join } from "node:path";
import { ensureVerifiedBinary, type VerifiedBinary } from "./compile";
import { CompileFailure, compileFile } from "./sandbox";

/**
 * EXP-S2: compiles run in a separate process with a wall-clock timeout, a memory
 * cap and an integrity re-check. Real solc 0.8.26 from binaries.soliditylang.org,
 * keccak256-checked against list.json and cached (network on first run).
 */
const INPUT = {
  language: "Solidity",
  sources: { "A.sol": { content: "// SPDX-License-Identifier: MIT\npragma solidity 0.8.26;\ncontract A { uint256 public x; }" } },
  settings: { outputSelection: { "*": { "*": ["evm.deployedBytecode.object"] } } },
};

async function failure(p: Promise<unknown>): Promise<CompileFailure> {
  try {
    await p;
  } catch (e) {
    return e as CompileFailure;
  }
  throw new Error("expected the compile to fail");
}

describe("sandboxed compile (EXP-S2)", () => {
  let bin: VerifiedBinary;
  beforeAll(async () => {
    process.env.CITRATE_SOLC_CACHE_DIR ??= join(__dirname, "..", "..", "..", "node_modules", ".cache", "citrate-solc");
    bin = await ensureVerifiedBinary("0.8.26");
  }, 120_000);

  it("compiles in a child process with the verified build", async () => {
    const out = JSON.parse(await compileFile(bin, INPUT, { timeoutMs: 60_000, memoryMb: 2048, maxOutputBytes: 8 << 20 }));
    expect(out.contracts["A.sol"].A.evm.deployedBytecode.object).toMatch(/^6080/);
    expect(bin.longVersion).toBe("0.8.26+commit.8a97fa7a");
  }, 60_000);

  it("stops a compile that runs past the timeout", async () => {
    const e = await failure(compileFile(bin, INPUT, { timeoutMs: 30, memoryMb: 2048, maxOutputBytes: 8 << 20 }));
    expect(e).toBeInstanceOf(CompileFailure);
    expect(e.code).toBe("timeout");
  }, 30_000);

  it("stops a compile whose resident memory passes the cap", async () => {
    const e = await failure(compileFile(bin, INPUT, { timeoutMs: 60_000, memoryMb: 40, maxOutputBytes: 8 << 20 }));
    expect(e.code).toBe("memory");
  }, 60_000);

  it("refuses output larger than the cap", async () => {
    const e = await failure(compileFile(bin, INPUT, { timeoutMs: 60_000, memoryMb: 2048, maxOutputBytes: 16 }));
    expect(e.code).toBe("output");
  }, 60_000);

  it("the child refuses to evaluate a build whose keccak256 does not match", async () => {
    const e = await failure(compileFile({ ...bin, keccak256: "0x" + "00".repeat(32) }, INPUT));
    expect(e.code).toBe("integrity");
  }, 30_000);
});
