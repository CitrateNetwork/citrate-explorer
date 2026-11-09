/**
 * Sourcify-compatible v2 API (EXP-S2), so `forge verify-contract --verifier sourcify
 * --verifier-url https://explorer.citrate.ai/` works unmodified:
 *
 *   POST /v2/verify/{chainId}/{address}            standard JSON input        -> 202 {verificationId}
 *   POST /v2/verify/metadata/{chainId}/{address}   metadata.json + sources    -> 202 {verificationId}
 *   GET  /v2/verify/{verificationId}               job status
 *   GET  /v2/contract/{chainId}/{address}?fields=  the verified contract
 *
 * Errors use Sourcify's `{customCode, message, errorId}` shape. Matches map to
 * Sourcify's vocabulary: full -> "exact_match", partial -> "match".
 *
 * Data sources (Rule 7): the verification tables (./store.ts) and the Citrate RPC
 * (./chain.ts), through {@link ContractApiDeps}.
 */
import { randomUUID } from "crypto";
import { getAddress } from "viem";
import { submitRequest, type ContractApiDeps } from "./etherscan";
import { resolveVerified, stdJsonOf } from "./read";
import { fromSourcifyMetadata, fromSourcifyStdJson, RequestError } from "./request";
import { getJob, getVerified, type VerifiedRow } from "./store";

export interface SourcifyReply {
  status: number;
  body: unknown;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

const err = (status: number, customCode: string, message: string): SourcifyReply => ({
  status,
  body: { customCode, message, errorId: randomUUID() },
});

export function sourcifyMatch(m: string | null | undefined): "exact_match" | "match" | null {
  return m === "full" ? "exact_match" : m === "partial" ? "match" : null;
}

/** A similar match carries another contract's source: at most "match", never exact. */
function runtimeOf(row: VerifiedRow): "exact_match" | "match" | null {
  return row.matchType === "similar" ? "match" : sourcifyMatch(row.runtimeMatch);
}

function overall(row: VerifiedRow): "exact_match" | "match" | null {
  const r = runtimeOf(row);
  const c = sourcifyMatch(row.creationMatch);
  if (r === "exact_match" || c === "exact_match") return "exact_match";
  return r ?? c;
}

function checkTarget(deps: ContractApiDeps, chainId: string, address: string): SourcifyReply | null {
  if (chainId !== String(deps.chain.chainId)) {
    return err(400, "unsupported_chain", `chain ${chainId} is not served here; this explorer serves chain ${deps.chain.chainId}`);
  }
  if (!ADDRESS_RE.test(address)) return err(400, "invalid_parameter", "address must be a 0x-prefixed 20-byte address");
  if (!deps.db) return err(503, "unavailable", "verification is unavailable: the explorer has no database provisioned");
  return null;
}

/** POST /v2/verify/{chainId}/{address} and POST /v2/verify/metadata/{chainId}/{address}. */
export async function sourcifyVerify(
  deps: ContractApiDeps,
  chainId: string,
  address: string,
  body: unknown,
  kind: "stdjson" | "metadata",
): Promise<SourcifyReply> {
  const bad = checkTarget(deps, chainId, address);
  if (bad) return bad;
  let req;
  try {
    req = kind === "metadata" ? fromSourcifyMetadata(body, address) : fromSourcifyStdJson(body, address);
  } catch (e) {
    if (e instanceof RequestError) return err(400, "invalid_parameter", e.message);
    throw e;
  }
  const r = await submitRequest({ db: deps.db!, chain: deps.chain }, req, "sourcify");
  if ("id" in r) return { status: 202, body: { verificationId: r.id } };
  if (r.refused === "no_code") return err(404, "contract_not_deployed", `no contract code at ${address} on chain ${chainId}`);
  if (r.refused === "already_verified") return err(409, "already_verified", `${address} on chain ${chainId} is already fully verified`);
  return err(429, "too_many_requests", "the verification queue is full; retry shortly");
}

function contractSummary(row: VerifiedRow) {
  return {
    match: overall(row),
    creationMatch: sourcifyMatch(row.creationMatch),
    runtimeMatch: runtimeOf(row),
    chainId: String(row.chainId),
    address: getAddress(row.address),
    verifiedAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    matchId: row.id,
  };
}

/** GET /v2/verify/{verificationId}. */
export async function sourcifyJob(deps: ContractApiDeps, id: string): Promise<SourcifyReply> {
  if (!deps.db) return err(503, "unavailable", "verification is unavailable: the explorer has no database provisioned");
  const job = await getJob(deps.db, id);
  if (!job || job.kind !== "verify") return err(404, "job_not_found", `no verification job ${id}`);
  const iso = (d: Date | null) => (d ? d.toISOString() : undefined);
  const base = {
    isJobCompleted: job.status === "pass" || job.status === "fail",
    verificationId: job.id,
    jobStartTime: iso(job.createdAt),
    ...(job.finishedAt ? { jobFinishTime: iso(job.finishedAt) } : {}),
  };
  const empty = { match: null, creationMatch: null, runtimeMatch: null, chainId: String(job.chainId), address: getAddress(job.address) };
  if (job.status === "pass" && job.verifiedContractId) {
    const row = await getVerified(deps.db, job.verifiedContractId);
    if (row) return { status: 200, body: { ...base, contract: contractSummary(row) } };
  }
  if (job.status === "fail") {
    return {
      status: 200,
      body: { ...base, contract: empty, error: { customCode: job.resultCode ?? "no_match", message: job.resultMessage ?? "verification failed", errorId: job.id } },
    };
  }
  return { status: 200, body: { ...base, contract: empty } };
}

const ALL_FIELDS = [
  "abi",
  "metadata",
  "sources",
  "compilation",
  "deployment",
  "storageLayout",
  "stdJsonInput",
  "runtimeBytecode",
  "creationBytecode",
  "libraries",
  "proxyResolution",
] as const;

const parseJson = (s: string | null) => {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

/** GET /v2/contract/{chainId}/{address}?fields=all|abi,sources,... */
export async function sourcifyContract(deps: ContractApiDeps, chainId: string, address: string, fieldsParam: string | null): Promise<SourcifyReply> {
  const bad = checkTarget(deps, chainId, address);
  if (bad) return bad;
  const r = await resolveVerified(deps.db!, deps.chain, address);
  if (!r?.row) return err(404, "not_found", `${address} on chain ${chainId} is not verified`);
  const row = r.row;
  const wanted = fieldsParam === "all" ? [...ALL_FIELDS] : (fieldsParam ?? "").split(",").map((f) => f.trim()).filter(Boolean);
  const std = stdJsonOf(row);
  const fqn = row.fullyQualifiedName ?? "";
  const out: Record<string, unknown> = contractSummary(row);
  for (const f of wanted) {
    switch (f) {
      case "abi":
        out.abi = parseJson(row.abi);
        break;
      case "metadata":
        out.metadata = parseJson(row.metadata);
        break;
      case "sources":
        out.sources = std?.sources ?? null;
        break;
      case "stdJsonInput":
        out.stdJsonInput = std;
        break;
      case "storageLayout":
        out.storageLayout = parseJson(row.storageLayout);
        break;
      case "libraries":
        out.libraries = parseJson(row.libraries);
        break;
      case "compilation":
        out.compilation = {
          language: std?.language ?? "Solidity",
          compiler: "solc",
          compilerVersion: row.solcLongVersion,
          compilerSettings: std?.settings ?? null,
          name: row.contractName,
          fullyQualifiedName: fqn,
        };
        break;
      case "deployment":
        out.deployment = { transactionHash: row.creationTxHash, deployer: row.deployer, chainId: String(row.chainId) };
        break;
      case "runtimeBytecode":
        out.runtimeBytecode = {
          onchainBytecode: r.code,
          sourceMap: row.deployedSourceMap,
          immutableReferences: parseJson(row.immutableReferences),
        };
        break;
      case "creationBytecode":
        out.creationBytecode = { sourceMap: row.creationSourceMap, constructorArguments: row.constructorArgs ? `0x${row.constructorArgs}` : null };
        break;
      case "proxyResolution":
        out.proxyResolution = r.proxy
          ? { isProxy: true, proxyType: r.proxy.proxyType, implementations: [{ address: getAddress(r.proxy.implementation) }] }
          : { isProxy: false, proxyType: null, implementations: [] };
        break;
      default:
        return err(400, "invalid_parameter", `unknown field "${f}"`);
    }
  }
  if (row.matchType === "similar" && r.original) out.similarTo = getAddress(r.original.address);
  return { status: 200, body: out };
}
