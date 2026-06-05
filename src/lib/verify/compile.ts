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
 */
import { createRequire } from "module";

const require = createRequire(import.meta.url);
// solc is CJS; load it through createRequire so it resolves in the Next runtime.
const solc = require("solc") as {
  loadRemoteVersion: (v: string, cb: (err: Error | null, snap?: SolcSnapshot) => void) => void;
};

interface SolcSnapshot {
  compile: (input: string) => string;
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

/** Resolve "0.8.26" or "v0.8.26+commit.8a97fa7a" to the full soljson build name. */
export async function resolveCompilerVersion(version: string): Promise<string> {
  const v = version.trim().replace(/^v/, "");
  if (/\+commit\.[0-9a-f]+$/i.test(v)) return `v${v}`;
  const res = await fetch(SOLC_LIST);
  if (!res.ok) throw new Error(`could not fetch the solc version list (${res.status})`);
  const list = (await res.json()) as { releases?: Record<string, string> };
  const file = list.releases?.[v];
  if (!file) throw new Error(`unknown solc version "${version}" (expected e.g. 0.8.26 or v0.8.26+commit.8a97fa7a)`);
  return file.replace(/^soljson-/, "").replace(/\.js$/, "");
}

function loadRemote(build: string): Promise<SolcSnapshot> {
  return new Promise((resolve, reject) => {
    solc.loadRemoteVersion(build, (err, snap) => {
      if (err || !snap) reject(err ?? new Error("failed to load compiler"));
      else resolve(snap);
    });
  });
}

/** Compile a Solidity standard-JSON input with the given version. */
export async function compileSolidity(
  version: string,
  input: object,
): Promise<CompileOutput> {
  const build = await resolveCompilerVersion(version);
  const snap = await loadRemote(build);
  const out = JSON.parse(snap.compile(JSON.stringify(input))) as Omit<CompileOutput, "compiler">;
  return { ...out, compiler: build };
}
