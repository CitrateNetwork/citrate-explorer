/**
 * Verification job processing (EXP-S2). Runs only in the verify worker
 * (`pnpm verify:worker`), never in a web function.
 *
 * verify job: read the on-chain runtime -> compile in the sandbox -> match the
 * runtime (libraries linked, immutables masked, CBOR stripped for partial) ->
 * find the creation transaction (the submitted hash, else the indexer) and match
 * the creation input (init code + constructor args) -> append one record ->
 * apply it as a "similar" match to other indexed contracts with identical
 * (masked) runtime code.
 *
 * proxy job: detect the implementation and append a proxy link.
 *
 * Data sources (Rule 7): Citrate RPC (ChainReader), the indexer tables and the
 * verification tables (./store.ts), the solc release binaries (./sandbox.ts).
 */
import { keccak256, type Hex } from "viem";
import { PublicError } from "@/lib/api/errors";
import type { ChainDb } from "@/lib/indexer/types";
import type { ChainReader } from "./chain";
import type { CompiledContract, CompileOutput } from "./compile";
import { boundStandardInput, InputTooLarge } from "./inputbound";
import { maskedRuntimeHash, matchCreation, matchRuntime, type CreationMatch, type SideMatch } from "./match";
import { detectProxy } from "./proxy";
import { sourceHash, type StdJsonInput, type VerifyRequest } from "./request";
import { CompileFailure, type Compiler } from "./sandbox";
import {
  appendProxy,
  appendVerified,
  findCreation,
  listCreations,
  listMatches,
  originalsByLength,
  verifiedAddresses,
  type JobResult,
  type JobRow,
  type VerifiedRow,
} from "./store";

export const OUTPUT_SELECTION = {
  "*": {
    "*": [
      "abi",
      "metadata",
      "storageLayout",
      "evm.bytecode.object",
      "evm.bytecode.sourceMap",
      "evm.bytecode.linkReferences",
      "evm.deployedBytecode.object",
      "evm.deployedBytecode.sourceMap",
      "evm.deployedBytecode.linkReferences",
      "evm.deployedBytecode.immutableReferences",
    ],
  },
};

export interface JobDeps {
  db: ChainDb;
  chain: ChainReader;
  compile: Compiler;
  /** How many of the newest indexed creations a new record is checked against (default 200). */
  similarScanLimit?: number;
}

const fail = (code: string, message: string): JobResult => ({ status: "fail", code, message });

export async function processJob(job: JobRow, deps: JobDeps): Promise<JobResult> {
  return job.kind === "proxy" ? processProxyJob(job, deps) : processVerifyJob(job, deps);
}

interface Candidate {
  file: string;
  name: string;
  c: CompiledContract;
}

function candidates(contracts: Record<string, Record<string, CompiledContract>>, ident: string | null): Candidate[] {
  const all: Candidate[] = [];
  for (const [file, byName] of Object.entries(contracts)) {
    for (const [name, c] of Object.entries(byName)) all.push({ file, name, c });
  }
  if (!ident) return all;
  const i = ident.lastIndexOf(":");
  if (i < 0) return all.filter((x) => x.name === ident);
  const file = ident.slice(0, i);
  const name = ident.slice(i + 1);
  return all.filter((x) => x.name === name && x.file === file);
}

const rank = (m: string, creation: string | null) =>
  (m === "full" ? 0 : m === "partial" ? 1 : 2) * 3 + (creation === "full" ? 0 : creation === "partial" ? 1 : 2);

/** Libraries linked through `settings.libraries` (solc then emits no link references for them). */
function settingsLibraries(settings: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const libs = (settings?.libraries ?? {}) as Record<string, Record<string, string>>;
  for (const [file, byName] of Object.entries(libs)) {
    for (const [name, at] of Object.entries(byName ?? {})) {
      if (typeof at === "string") out[`${file}:${name}`] = at.toLowerCase();
    }
  }
  return out;
}

function libraryMismatch(supplied: Record<string, string>, resolved: Record<string, string>): string | null {
  for (const [k, at] of Object.entries(supplied)) {
    const hit = Object.entries(resolved).find(([key]) => key === k || key.endsWith(`:${k}`));
    if (hit && hit[1].toLowerCase() !== at.toLowerCase()) {
      return `library ${k} is linked to ${hit[1]} on chain, not ${at}`;
    }
  }
  return null;
}

interface Best {
  cand: Candidate;
  match: SideMatch;
  libraries: Record<string, string>;
  isLibrary: boolean;
  out: CompileOutput;
}

/** Compile one standard JSON input in the sandbox and find the best runtime match, or a failure result. */
async function compileAndMatch(
  deps: JobDeps,
  req: VerifyRequest,
  std: StdJsonInput,
  code: string,
): Promise<{ best: Best | null } | JobResult> {
  const input = { ...std, settings: { ...(std.settings ?? {}), outputSelection: OUTPUT_SELECTION } };
  try {
    boundStandardInput(input);
  } catch (e) {
    if (e instanceof InputTooLarge) return fail("input", e.message);
    throw e;
  }
  let out: CompileOutput;
  try {
    out = await deps.compile(req.compilerVersion, input);
  } catch (e) {
    if (e instanceof CompileFailure) return fail(`compile_${e.code}`, e.message);
    if (e instanceof PublicError) return fail("compiler", e.message);
    throw e;
  }
  const errors = (out.errors ?? []).filter((e) => e.severity === "error");
  if (errors.length) {
    const msg = errors[0].formattedMessage ?? errors[0].message ?? "compilation error";
    return fail("compile_error", `compilation error: ${msg.split("\n")[0]}`);
  }
  const pool = candidates(out.contracts ?? {}, req.contractIdentifier);
  if (!pool.length) {
    return fail("not_found", `contract ${req.contractIdentifier ?? "(any)"} was not found in the compiled output`);
  }
  let best: Best | null = null;
  for (const cand of pool) {
    const dep = cand.c.evm?.deployedBytecode;
    if (!dep?.object) continue;
    const m = matchRuntime(dep, code);
    if (!m.match) continue;
    if (!best || (m.match === "full" && best.match !== "full")) {
      best = { cand, match: m.match, libraries: m.libraries, isLibrary: m.isLibrary, out };
    }
    if (best.match === "full") break;
  }
  return { best };
}

async function processVerifyJob(job: JobRow, deps: JobDeps): Promise<JobResult> {
  const { db, chain } = deps;
  const req = JSON.parse(job.request) as VerifyRequest;
  const address = req.address.toLowerCase();

  const genesis = await chain.genesisHash();
  if (job.genesisHash && job.genesisHash !== genesis) {
    return fail("chain_changed", "the chain was reset since this submission; resubmit");
  }
  const code = await chain.getCode(address);
  if (!code || code === "0x") return fail("no_code", `Unable to locate ContractCode at ${address}`);
  const runtimeCodeHash = keccak256(code as Hex);

  const attempt = await compileAndMatch(deps, req, req.stdJsonInput, code);
  if ("status" in attempt) return attempt;
  let { best } = attempt;
  let effectiveInput = req.stdJsonInput;
  // Hardhat (and anything else that links after compiling) deploys bytecode built
  // WITHOUT settings.libraries, then submits an input WITH them. Libraries are part
  // of solc's metadata, so that input can only match partially. Try once more with
  // them taken out (links resolved from the chain); keep it if it matches fully.
  const libs = (req.stdJsonInput.settings as { libraries?: Record<string, unknown> } | undefined)?.libraries;
  if (best && best.match === "partial" && libs && Object.keys(libs).length) {
    const { libraries: stripped, ...rest } = req.stdJsonInput.settings ?? {};
    void stripped;
    const unlinked = { ...req.stdJsonInput, settings: rest };
    const second = await compileAndMatch(deps, req, unlinked, code);
    if (!("status" in second) && second.best?.match === "full") {
      best = second.best;
      effectiveInput = unlinked;
    }
  }
  if (!best) {
    return fail(
      "no_match",
      "the compiled runtime bytecode does not match the deployed code (check the compiler version, optimizer settings, libraries and source)",
    );
  }
  const out = best.out;
  best.libraries = { ...settingsLibraries(effectiveInput.settings), ...best.libraries };
  const libErr = libraryMismatch(req.libraries ?? {}, best.libraries);
  if (libErr) return fail("library_mismatch", libErr);

  // Creation transaction: the one the submitter named, else the indexer's record.
  let creation: CreationMatch | null = null;
  let creationTxHash: string | null = null;
  let deployer: string | null = null;
  const txHash = req.creationTxHash ?? (await findCreation(db, address))?.txHash ?? null;
  if (txHash) {
    const [tx, receipt] = await Promise.all([chain.getTransaction(txHash), chain.getReceipt(txHash)]);
    const created = receipt?.contractAddress?.toLowerCase() === address;
    if (req.creationTxHash && !created) {
      return fail("creation_tx_mismatch", `transaction ${txHash} did not create ${address}`);
    }
    if (tx && created) {
      creationTxHash = tx.hash;
      deployer = tx.from;
      const bytecode = best.cand.c.evm?.bytecode;
      if (tx.to === null && bytecode?.object) {
        creation = matchCreation(bytecode, tx.input, best.libraries, req.constructorArgs);
      }
    }
  }
  const creationMatch = creation?.match ?? null;

  const existing = await listMatches(db, { genesisHash: genesis, address, runtimeCodeHash });
  const already = existing.find((e) => e.matchType !== "similar" && rank(e.matchType, e.creationMatch) <= rank(best.match, creationMatch));
  if (already) {
    return {
      status: "pass",
      code: "already_verified",
      message: "Already Verified",
      matchType: already.matchType,
      verifiedContractId: already.id,
    };
  }

  const dep = best.cand.c.evm.deployedBytecode;
  const id = await appendVerified(db, {
    jobId: job.id,
    chainId: chain.chainId,
    genesisHash: genesis,
    address,
    runtimeCodeHash,
    runtimeMaskedHash: maskedRuntimeHash(code, dep.immutableReferences, best.isLibrary),
    runtimeCodeLength: (code.length - 2) / 2,
    matchType: best.match,
    runtimeMatch: best.match,
    creationMatch,
    similarTo: null,
    sourceFormat: req.format,
    contractName: best.cand.name,
    fullyQualifiedName: `${best.cand.file}:${best.cand.name}`,
    compilerVersion: req.compilerVersion,
    solcLongVersion: out.longVersion ?? out.compiler.replace(/^v/, ""),
    stdJsonInput: JSON.stringify(effectiveInput),
    metadata: best.cand.c.metadata ?? null,
    abi: JSON.stringify(best.cand.c.abi ?? []),
    storageLayout: best.cand.c.storageLayout ? JSON.stringify(best.cand.c.storageLayout) : null,
    deployedSourceMap: dep.sourceMap ?? null,
    creationSourceMap: best.cand.c.evm.bytecode?.sourceMap ?? null,
    immutableReferences: JSON.stringify(dep.immutableReferences ?? {}),
    constructorArgs: creation?.constructorArgs ?? req.constructorArgs ?? null,
    libraries: JSON.stringify(best.libraries),
    creationTxHash,
    deployer,
    sourceHash: sourceHash(effectiveInput),
  });

  const record = (await listMatches(db, { genesisHash: genesis, address, runtimeCodeHash })).find((r) => r.id === id) ?? null;
  if (record) await applySimilarFromRecord(deps, record);

  const parts = [`${best.match === "full" ? "Full" : "Partial"} match`];
  parts.push(creationMatch ? `creation ${creationMatch} match` : "creation transaction not compared");
  if (creation?.suppliedArgsDiffer) parts.push("the supplied constructor arguments differ from the creation transaction's, which are recorded");
  return { status: "pass", code: "verified", message: parts.join("; "), matchType: best.match, verifiedContractId: id };
}

/** Whether on-chain code is a deployed library at `address` (call protection carries its own address). */
function deployedLibrary(code: string, address: string): boolean {
  const c = code.toLowerCase().replace(/^0x/, "");
  return c.startsWith("73") && c.slice(2, 42) === address.toLowerCase().replace(/^0x/, "") && c.slice(42, 46) === "3014";
}

/**
 * Check `addresses` against original records with the same runtime length; on an
 * identical masked runtime, append a "similar" record that points at the original.
 */
export async function applySimilar(deps: JobDeps, genesis: string, addresses: string[], only?: VerifiedRow): Promise<number> {
  const { db, chain } = deps;
  const known = await verifiedAddresses(db, genesis, addresses);
  let applied = 0;
  for (const address of addresses) {
    if (known.has(address)) continue;
    const code = await chain.getCode(address);
    if (!code || code === "0x") continue;
    const length = (code.length - 2) / 2;
    const pool = only ? (only.runtimeCodeLength === length ? [only] : []) : await originalsByLength(db, genesis, length);
    for (const orig of pool) {
      const refs = orig.immutableReferences ? (JSON.parse(orig.immutableReferences) as Record<string, Array<{ start: number; length: number }>>) : {};
      if (maskedRuntimeHash(code, refs, deployedLibrary(code, address)) !== orig.runtimeMaskedHash) continue;
      await appendVerified(db, {
        jobId: orig.jobId,
        chainId: orig.chainId,
        genesisHash: genesis,
        address,
        runtimeCodeHash: keccak256(code as Hex),
        runtimeMaskedHash: orig.runtimeMaskedHash,
        runtimeCodeLength: length,
        matchType: "similar",
        runtimeMatch: "full",
        creationMatch: null,
        similarTo: orig.id,
        sourceFormat: orig.sourceFormat,
        contractName: orig.contractName,
        fullyQualifiedName: orig.fullyQualifiedName,
        compilerVersion: orig.compilerVersion,
        solcLongVersion: orig.solcLongVersion,
        stdJsonInput: orig.stdJsonInput,
        metadata: orig.metadata,
        abi: orig.abi,
        storageLayout: orig.storageLayout,
        deployedSourceMap: orig.deployedSourceMap,
        creationSourceMap: orig.creationSourceMap,
        immutableReferences: orig.immutableReferences,
        constructorArgs: null,
        libraries: orig.libraries,
        creationTxHash: null,
        deployer: null,
        sourceHash: orig.sourceHash,
      });
      known.add(address);
      applied++;
      break;
    }
  }
  return applied;
}

/** After a new record: check the newest indexed creations for identical runtime code. */
async function applySimilarFromRecord(deps: JobDeps, record: VerifiedRow): Promise<number> {
  if (!record.genesisHash) return 0;
  const limit = deps.similarScanLimit ?? 200;
  if (limit <= 0) return 0;
  const created = await listCreations(deps.db, { limit, newestFirst: true });
  const others = created.map((c) => c.address).filter((a) => a !== record.address);
  return applySimilar(deps, record.genesisHash, others, record);
}

async function processProxyJob(job: JobRow, deps: JobDeps): Promise<JobResult> {
  const { db, chain } = deps;
  const req = JSON.parse(job.request) as { address: string; expectedImplementation: string | null };
  const address = req.address.toLowerCase();
  const genesis = await chain.genesisHash();
  const code = await chain.getCode(address);
  if (!code || code === "0x") return fail("no_code", `Unable to locate ContractCode at ${address}`);
  const found = await detectProxy(chain, address, code);
  if (!found) {
    return fail("no_proxy", "A corresponding implementation contract was unfortunately not detected for the proxy address.");
  }
  if (req.expectedImplementation && req.expectedImplementation.toLowerCase() !== found.implementation) {
    return fail(
      "impl_mismatch",
      `The implementation contract found (${found.implementation}) does not match the expected implementation (${req.expectedImplementation.toLowerCase()}).`,
    );
  }
  const implCode = await chain.getCode(found.implementation);
  if (!implCode || implCode === "0x") {
    return fail("no_proxy", "A corresponding implementation contract was unfortunately not detected for the proxy address.");
  }
  await appendProxy(db, {
    jobId: job.id,
    chainId: chain.chainId,
    genesisHash: genesis,
    address,
    implementation: found.implementation,
    proxyType: found.type,
  });
  return {
    status: "pass",
    code: "proxy",
    message: `The proxy's (${address}) implementation contract is found at ${found.implementation} and is successfully updated.`,
  };
}
