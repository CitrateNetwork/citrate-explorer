/**
 * solc-js compiler resolution (WS-2b, EXP-S2). Resolves the EXACT requested
 * compiler version through the official release list and fetches the soljson
 * WASM build, verified against the list's keccak256. Compilation itself runs in
 * the verify worker's sandbox child (scripts/verify/compile-child.mjs, spawned by
 * ./sandbox.ts) under a timeout and memory cap; no web function compiles.
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
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { keccak256 } from "viem";
import { PublicError } from "@/lib/api/errors";

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

type Spans = Array<{ start: number; length: number }>;

/** The per-contract solc output the worker requests (see OUTPUT_SELECTION in ./job.ts). */
export interface CompiledContract {
  abi: unknown[];
  metadata?: string;
  storageLayout?: unknown;
  evm: {
    bytecode?: { object: string; sourceMap?: string; linkReferences?: Record<string, Record<string, Spans>> };
    deployedBytecode: {
      object: string;
      sourceMap?: string;
      linkReferences?: Record<string, Record<string, Spans>>;
      immutableReferences?: Record<string, Spans>;
    };
  };
}
export interface CompileOutput {
  errors?: Array<{ severity: "error" | "warning"; formattedMessage?: string; message?: string }>;
  contracts?: Record<string, Record<string, CompiledContract>>;
  /** The full build name we actually used. */
  compiler: string;
  /** solc's long version, e.g. 0.8.26+commit.8a97fa7a. */
  longVersion?: string;
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
    throw new PublicError(`invalid solc version "${version}" (expected e.g. 0.8.26 or v0.8.26+commit.8a97fa7a)`);
  }

  const allow = allowedCompilers();
  const baseSemver = v.split("+")[0];
  if (allow && !allow.has(baseSemver)) {
    throw new PublicError(`solc version "${baseSemver}" is not in CITRATE_VERIFY_ALLOWED_COMPILERS`);
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
    throw new PublicError(`unknown/unlisted solc build "${version}" — not present in the release list`);
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
 * Where verified soljson builds are cached on the worker host. Every load
 * re-checks the file's keccak256 against the release list, so the cache is a
 * speed-up only, never a trust anchor.
 */
export function solcCacheDir(): string {
  return process.env.CITRATE_SOLC_CACHE_DIR || join(tmpdir(), "citrate-solc-cache");
}

export interface VerifiedBinary {
  /** Path of a soljson file whose keccak256 matched the release list. */
  path: string;
  keccak256: string;
  /** e.g. v0.8.26+commit.8a97fa7a */
  build: string;
  /** e.g. 0.8.26+commit.8a97fa7a */
  longVersion: string;
}

/**
 * Resolve the version through the release list, then return a local soljson
 * file verified against the list's keccak256: the cached copy when it still
 * matches, else a fresh download (checked BEFORE it is written to the cache).
 * Nothing here executes the compiler; the sandbox child does that.
 */
export async function ensureVerifiedBinary(version: string, cacheDir = solcCacheDir()): Promise<VerifiedBinary> {
  const { build, keccak256: digest } = await resolveVerifiedBuild(version);
  const file = join(cacheDir, `soljson-${build}.js`);
  const result = { path: file, keccak256: digest, build, longVersion: build.replace(/^v/, "") };
  try {
    const cached = new Uint8Array(await readFile(file));
    if (keccak256(cached).toLowerCase() === digest.toLowerCase()) return result;
  } catch {
    // not cached yet
  }
  const res = await fetch(`${SOLC_BIN}/soljson-${build}.js`);
  if (!res.ok) throw new Error(`could not download solc build "${build}" (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const got = keccak256(bytes);
  if (got.toLowerCase() !== digest.toLowerCase()) {
    throw new Error(`solc integrity check failed for "${build}": expected ${digest}, got ${got}`);
  }
  await mkdir(cacheDir, { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, bytes);
  await rename(tmp, file);
  return result;
}
