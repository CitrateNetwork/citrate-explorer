import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Compile-input bounds at the engine entry point for the paths the existing
 * bomb suite does not cover: the single-file (flattened) path and a malformed
 * bound override. In every case solc must never be invoked.
 */
const compileSpy = vi.fn(async (): Promise<{ contracts: object; compiler: string }> => ({ contracts: {}, compiler: "vX" }));
vi.mock("./compile", () => ({ compileSolidity: () => compileSpy() }));
vi.mock("@/lib/harness/ops", () => ({
  getContractCode: async () => ({ isContract: true, bytecode: "0xabcd" }),
}));

import { verifyContract } from "./engine";

const ADDR = ("0x" + "d".repeat(40)) as `0x${string}`;
let g = 0;
const run = (over: Partial<Parameters<typeof verifyContract>[0]>) =>
  verifyContract({
    guid: `sf-${++g}`,
    address: ADDR,
    format: "solidity-single-file",
    compilerVersion: "0.8.26",
    source: "contract A {}",
    ...over,
  });

function manySources(n: number): string {
  const sources: Record<string, { content: string }> = {};
  for (let i = 0; i < n; i++) sources[`S${i}.sol`] = { content: "contract S {}" };
  return JSON.stringify({ language: "Solidity", sources });
}

beforeEach(() => compileSpy.mockClear());
afterEach(() => {
  delete process.env.CITRATE_VERIFY_MAX_SOURCES;
  delete process.env.CITRATE_VERIFY_MAX_OPT_RUNS;
});

describe("single-file verification is bounded before solc", () => {
  it("refuses an out-of-range optimizer runs value without compiling", async () => {
    const out = await run({ optimizationRuns: 1_000_000_001 });
    expect(out.status).toBe("fail");
    expect(out.message.toLowerCase()).toContain("optimizer runs");
    expect(compileSpy).not.toHaveBeenCalled();
  });

  it("still compiles an in-range runs value", async () => {
    await run({ optimizationRuns: 200 });
    expect(compileSpy).toHaveBeenCalledTimes(1);
  });
});

describe("a malformed bound override falls back to the default, never to unlimited", () => {
  it.each(["abc", "0", "-5", "1.5", " "])("CITRATE_VERIFY_MAX_SOURCES=%j keeps the 64-source cap", async (raw) => {
    process.env.CITRATE_VERIFY_MAX_SOURCES = raw;
    const out = await run({ format: "solidity-standard-json-input", source: manySources(65) });
    expect(out.status).toBe("fail");
    expect(out.message.toLowerCase()).toContain("too many source files");
    expect(compileSpy).not.toHaveBeenCalled();
  });

  it("a valid override is honoured", async () => {
    process.env.CITRATE_VERIFY_MAX_SOURCES = "100";
    await run({ format: "solidity-standard-json-input", source: manySources(65) });
    expect(compileSpy).toHaveBeenCalledTimes(1);
  });
});
