/**
 * solc-js compile layer (WS-2b). Loads the EXACT requested compiler version on
 * demand (the official soljson WASM builds) and compiles a standard-JSON input —
 * the same engine Sourcify/Hardhat use. Runs in the Node serverless runtime
 * (maxDuration is bumped on the verify route).
 *
 * Safety envelope: callers bound the source size + run under the route timeout.
 * Compiling Solidity is pure translation (no host access), but a hardened
 * production deployment would move this into a Vercel Sandbox microVM — noted as
 * the next isolation step in the WS-2b plan.
 *
 * EX-B-011 / CIT-EXP-02 (RM-Q remediation, 2026-09-07) — supply-chain hardening
 * of the fetched compiler:
 *   1. MEMBERSHIP: every requested version (bare semver AND `+commit`) is now
 *      resolved through the signed release list (`list.json`). The old code
 *      returned the `+commit` form immediately WITHOUT consulting the list, so an
 *      arbitrary unlisted build name reached the fetch. An unlisted / unknown
 *      build is now rejected before any binary is downloaded.
 *   2. INTEGRITY: the downloaded soljson build is verified against the
 *      `keccak256` digest that `list.json` publishes for it BEFORE it is loaded
 *      and executed in-process. Previously nothing checked the bytes, so the
 *      trust anchor was TLS-to-a-single-host alone; a compromise/MITM of the
 *      binaries host would run attacker WASM alongside the function's secrets.
 *   3. ALLOWLIST (optional): `CITRATE_VERIFY_ALLOWED_COMPILERS` (comma-separated
 *      semvers) pins the set of acceptable versions; fail-closed parsing.
 */
import { createRequire } from "module";
import { keccak256 } from "viem";

const require = createRequire(import.meta.url);
// solc ships a `wrapper` that adapts a raw soljson (Emscripten) module into the
// { compile } surface. We load the soljson OURSELVES (with an integrity check)
// rather than via solc.loadRemoteVersion, which fetches + evals with no check.
const solcWrap = require("solc/wrapper") as (soljson: unknown) => SolcSnapshot;

interface SolcSnapshot {
  compile: (input: string) => string;
}

interface SolcListBuild {
  path: string;
  version: string;
  build: string;
  longVersion: string;
  keccak256: string;
}
interface SolcList {
  releases?: Record<string, string>;
  builds?: SolcListBuild[];
}

export interface CompiledContract {
  abi: unknown[];
  evm: { deployedBytecode: { object: string; immutableReferences?: Record<string, Array<{ start: number; length: number }>> } };
}
export interface CompileOutput {
  errors?: Array<{ severity: "error" | "warning"; formattedMessage?: string; message?: string }>;
  contracts?: Record<string, Record<string, CompiledContract>>;
  /** The full build name we actually used. */
  compiler: string;
}

const SOLC_LIST = "https://binaries.soliditylang.org/bin/list.json";
const SOLC_BIN = "https://binaries.soliditylang.org/bin";

// FWA-C12-03: the resolved build name is interpolated into the solc binaries URL,
// so the version string is an outbound-fetch sink. Pin it to the exact semver /
// semver+commit shapes — no path separators, no host, no traversal — before it
// can ever reach a fetch.
const SEMVER = /^\d{1,2}\.\d{1,2}\.\d{1,2}$/;
const SEMVER_COMMIT = /^\d{1,2}\.\d{1,2}\.\d{1,2}\+commit\.[0-9a-f]{6,40}$/i;

/**
 * Optional fail-closed allowlist of acceptable compiler semvers, from
 * `CITRATE_VERIFY_ALLOWED_COMPILERS` (comma-separated, e.g. "0.8.26,0.8.30").
 * Unset/empty ⇒ no extra restriction (any listed release is allowed). A
 * malformed entry is dropped, never widens the set.
 */
function allowedCompilers(): Set<string> | null {
  const raw = process.env.CITRATE_VERIFY_ALLOWED_COMPILERS;
  if (!raw || raw.trim() === "") return null;
  const set = new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => SEMVER.test(s)),
  );
  return set.size > 0 ? set : new Set();
}

/** Resolve a build to `{ build, keccak256 }`, validated against the release list. */
export async function resolveVerifiedBuild(
  version: string,
): Promise<{ build: string; keccak256: string }> {
  const v = version.trim().replace(/^v/, "");
  // Strict shape check FIRST — reject anything that isn't a clean solc version so
  // a crafted string can't steer the soljson fetch to an arbitrary path/host.
  if (!SEMVER.test(v) && !SEMVER_COMMIT.test(v)) {
    throw new Error(`invalid solc version "${version}" (expected e.g. 0.8.26 or v0.8.26+commit.8a97fa7a)`);
  }

  const allow = allowedCompilers();
  const baseSemver = v.split("+")[0];
  if (allow && !allow.has(baseSemver)) {
    throw new Error(`solc version "${baseSemver}" is not in CITRATE_VERIFY_ALLOWED_COMPILERS`);
  }

  // MEMBERSHIP: always consult the release list — including for the +commit form,
  // which previously bypassed this lookup entirely and let an arbitrary build
  // name reach the fetch sink.
  const res = await fetch(SOLC_LIST);
  if (!res.ok) throw new Error(`could not fetch the solc version list (${res.status})`);
  const list = (await res.json()) as SolcList;
  const builds = list.builds ?? [];

  let entry: SolcListBuild | undefined;
  if (SEMVER_COMMIT.test(v)) {
    // Match the exact published build by its longVersion (release builds have no
    // prerelease segment, so longVersion === "<semver>+commit.<hash>").
    entry = builds.find((b) => b.longVersion.toLowerCase() === v.toLowerCase());
  } else {
    // Bare semver → the canonical release file for that version, then its entry.
    const file = list.releases?.[v];
    if (file) entry = builds.find((b) => b.path === file);
  }
  if (!entry) {
    throw new Error(`unknown/unlisted solc build "${version}" — not present in the release list`);
  }
  if (!/^0x[0-9a-f]{64}$/i.test(entry.keccak256)) {
    throw new Error(`release list has no valid keccak256 for "${version}"`);
  }

  const build = entry.path.replace(/^soljson-/, "").replace(/\.js$/, "");
  return { build, keccak256: entry.keccak256 };
}

/**
 * Resolve "0.8.26" or "v0.8.26+commit.8a97fa7a" to the full soljson build name,
 * validated against the release list. Kept for callers/tests that only need the
 * name; {@link compileSolidity} uses {@link resolveVerifiedBuild} for the digest.
 */
export async function resolveCompilerVersion(version: string): Promise<string> {
  return (await resolveVerifiedBuild(version)).build;
}

/**
 * Download the soljson build, verify its keccak256 against the release list, and
 * ONLY THEN evaluate it in-process. A digest mismatch aborts before the untrusted
 * bytes are executed.
 */
async function loadVerified(build: string, expectedKeccak: string): Promise<SolcSnapshot> {
  const url = `${SOLC_BIN}/soljson-${build}.js`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not download solc build "${build}" (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const got = keccak256(bytes);
  if (got.toLowerCase() !== expectedKeccak.toLowerCase()) {
    throw new Error(
      `solc integrity check failed for "${build}": expected ${expectedKeccak}, got ${got}`,
    );
  }
  const code = new TextDecoder().decode(bytes);
  const mod = { exports: {} as Record<string, unknown> };
  // The verified soljson is a CommonJS/Emscripten module. It is executed only
  // AFTER the keccak256 digest matched the signed release list.
  new Function("module", "exports", code)(mod, mod.exports);
  return solcWrap(mod.exports);
}

/** Compile a Solidity standard-JSON input with the given version. */
export async function compileSolidity(
  version: string,
  input: object,
): Promise<CompileOutput> {
  const { build, keccak256: digest } = await resolveVerifiedBuild(version);
  const snap = await loadVerified(build, digest);
  const out = JSON.parse(snap.compile(JSON.stringify(input))) as Omit<CompileOutput, "compiler">;
  return { ...out, compiler: build };
}
