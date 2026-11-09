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

describe("sandboxed compile: the child gets no environment", () => {
  it("secrets in the worker's environment (DATABASE_URL and the like) are not visible to the compile child", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { keccak256 } = await import("viem");
    // A stand-in "soljson" that reports the child's environment instead of compiling.
    const dir = mkdtempSync(join(tmpdir(), "citrate-sandbox-env-"));
    const path = join(dir, "soljson-probe.js");
    // Node's IPC channel variables and macOS's per-process __CF_USER_TEXT_ENCODING are set
    // by the runtime and the OS, not inherited from the worker.
    const js = `process.send({ ok: false, code: "crash", error: JSON.stringify(Object.keys(process.env).filter((k) => !k.startsWith("NODE_CHANNEL") && k !== "__CF_USER_TEXT_ENCODING")) });`;
    writeFileSync(path, js);
    const prev = { db: process.env.DATABASE_URL, s: process.env.CITRATE_SANDBOX_PROBE };
    process.env.DATABASE_URL = "postgresql://probe";
    process.env.CITRATE_SANDBOX_PROBE = "1";
    try {
      const e = await failure(compileFile({ path, keccak256: keccak256(new TextEncoder().encode(js)) }, INPUT, { timeoutMs: 20_000, memoryMb: 512, maxOutputBytes: 1024 }));
      expect(JSON.parse(e.message)).toEqual([]);
    } finally {
      if (prev.db === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prev.db;
      delete process.env.CITRATE_SANDBOX_PROBE;
    }
  });
});
