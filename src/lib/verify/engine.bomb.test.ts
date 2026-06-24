import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * FWA-C12-03 (integration RED→GREEN): a compile-bomb input must be REJECTED by
 * the engine BEFORE the in-process solc compiler is ever invoked — proving the
 * input bound short-circuits the expensive path rather than handing a pathological
 * payload to solc (which could hang/exhaust the function).
 *
 * We spy on compileSolidity and assert it is NOT called for a bomb input, and
 * that the engine returns a clean `fail` outcome.
 */
const compileSpy = vi.fn(async (): Promise<{ contracts: object; compiler: string }> => ({
  contracts: {},
  compiler: "vX",
}));

vi.mock("./compile", () => ({
  compileSolidity: () => compileSpy(),
}));

// On-chain code reads as a contract so we get past the EOA guard and reach compile.
vi.mock("@/lib/harness/ops", () => ({
  getContractCode: async () => ({ isContract: true, bytecode: "0xabcd" }),
}));

// No DATABASE_URL in tests ⇒ getDb() is null ⇒ persist() is a no-op (returns row).

import { verifyContract } from "./engine";

const ADDR = ("0x" + "c".repeat(40)) as `0x${string}`;

function bombStandardJson(): string {
  const sources: Record<string, { content: string }> = {};
  for (let i = 0; i < 2000; i++) sources[`F${i}.sol`] = { content: "contract X {}" };
  return JSON.stringify({ language: "Solidity", sources });
}

describe("verifyContract — compile-bomb is bounded before solc (FWA-C12-03)", () => {
  beforeEach(() => compileSpy.mockClear());

  it("rejects a 2000-source compile-bomb WITHOUT invoking the compiler", async () => {
    const out = await verifyContract({
      guid: "g1",
      address: ADDR,
      format: "solidity-standard-json-input",
      compilerVersion: "0.8.26",
      source: bombStandardJson(),
    });
    expect(out.status).toBe("fail");
    expect(out.message.toLowerCase()).toContain("too many source files");
    expect(compileSpy).not.toHaveBeenCalled();
  });

  it("rejects a urls-based (out-of-band fetch) source without compiling", async () => {
    const out = await verifyContract({
      guid: "g2",
      address: ADDR,
      format: "solidity-standard-json-input",
      compilerVersion: "0.8.26",
      source: JSON.stringify({
        language: "Solidity",
        sources: { "R.sol": { urls: ["https://evil.example/x.sol"] } },
      }),
    });
    expect(out.status).toBe("fail");
    expect(compileSpy).not.toHaveBeenCalled();
  });

  it("still reaches the compiler for a normal, in-bounds input", async () => {
    const out = await verifyContract({
      guid: "g3",
      address: ADDR,
      format: "solidity-single-file",
      compilerVersion: "0.8.26",
      source: "contract A {}",
    });
    // compiles (no contracts returned by the stub) → a clean "no match" fail.
    expect(compileSpy).toHaveBeenCalledTimes(1);
    expect(out.status).toBe("fail");
  });
});
