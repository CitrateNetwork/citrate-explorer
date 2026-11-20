/**
 * The soljson loader verifies the downloaded build against the keccak256 the
 * release list publishes, and only THEN evaluates it. compile.test.ts covers
 * list membership; this suite pins the digest check itself and the list-entry
 * digest shape. The "compiler" payloads are tiny scripts that set a marker
 * when evaluated, so the tests observe whether code ran. No network is touched.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { keccak256, toBytes } from "viem";
import { compileSolidity, resolveVerifiedBuild } from "./compile";

const BUILD = "v0.8.26+commit.8a97fa7a";
const FILE = `soljson-${BUILD}.js`;
const MARK = "__citrateSoljsonEvaluated";
const PAYLOAD = `globalThis.${MARK} = (globalThis.${MARK} || 0) + 1;`;
const TAMPERED = `${PAYLOAD} /* altered after publication */`;

function list(digest: string) {
  return {
    releases: { "0.8.26": FILE },
    builds: [{ path: FILE, version: "0.8.26", build: "commit.8a97fa7a", longVersion: "0.8.26+commit.8a97fa7a", keccak256: digest }],
  };
}

function serve(digest: string, body: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith("list.json")) return new Response(JSON.stringify(list(digest)), { status: 200 });
      if (u.endsWith(`/${FILE}`)) return new Response(body, { status: 200 });
      throw new Error(`unexpected fetch: ${u}`);
    }),
  );
}

const evaluated = () => (globalThis as Record<string, unknown>)[MARK] ?? 0;

beforeEach(() => {
  delete (globalThis as Record<string, unknown>)[MARK];
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  delete (globalThis as Record<string, unknown>)[MARK];
});

describe("soljson integrity check", () => {
  it("refuses a build whose bytes do not match the published digest, without evaluating it", async () => {
    serve(keccak256(toBytes(PAYLOAD)), TAMPERED);
    await expect(compileSolidity("0.8.26", {})).rejects.toThrow(/integrity check failed/);
    expect(evaluated()).toBe(0);
  });

  it("refuses an empty download against a real digest", async () => {
    serve(keccak256(toBytes(PAYLOAD)), "");
    await expect(compileSolidity("0.8.26", {})).rejects.toThrow(/integrity check failed/);
    expect(evaluated()).toBe(0);
  });

  it("compares digests case-insensitively and evaluates a matching build exactly once", async () => {
    serve(keccak256(toBytes(PAYLOAD)).toUpperCase().replace(/^0X/, "0x"), PAYLOAD);
    // The marker payload is not a real compiler, so wrapping it fails AFTER the
    // digest matched and the code ran; what matters is that it was not refused
    // as an integrity failure.
    const err = await compileSolidity("0.8.26", {}).catch((e: Error) => e);
    expect(String(err)).not.toMatch(/integrity check failed/);
    expect(evaluated()).toBe(1);
  });
});

describe("release-list digest shape", () => {
  for (const [name, digest] of [
    ["empty", ""],
    ["no 0x prefix", "ab".repeat(32)],
    ["short", `0x${"ab".repeat(31)}`],
    ["non-hex", `0x${"zz".repeat(32)}`],
  ] as const) {
    it(`refuses a listed build whose digest is ${name}`, async () => {
      serve(digest, PAYLOAD);
      await expect(resolveVerifiedBuild("0.8.26")).rejects.toThrow(/no valid keccak256/);
      expect(evaluated()).toBe(0);
    });
  }
});
