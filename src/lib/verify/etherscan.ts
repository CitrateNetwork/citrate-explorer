/**
 * Etherscan-compatible `module=contract` API (EXP-S2), served at `/api` so
 * `forge verify-contract --verifier custom --verifier-url https://explorer.citrate.ai/api`
 * and hardhat-verify `customChains` work unmodified.
 *
 * Envelope `{status, message, result}` exactly as Etherscan returns it, including
 * the strings the tools poll for: "Pending in queue", "Pass - Verified",
 * "Fail - Unable to verify", "Contract source code not verified",
 * "Contract source code already verified", "Unable to locate ContractCode at".
 *
 * Submissions only validate and enqueue; the verify worker compiles.
 *
 * Data sources (Rule 7): the verification and indexer tables (./store.ts) and the
 * Citrate RPC (./chain.ts), through {@link VerifyDeps}.
 */
import { keccak256, type Hex } from "viem";
import type { ChainDb } from "@/lib/indexer/types";
import type { ChainReader } from "./chain";
import { resolveConfirmed, stdJsonOf, type Resolved } from "./read";
import { fromEtherscanForm, RequestError, sourceHash, type VerifyRequest } from "./request";
import { countOpenJobs, enqueueJob, findCreation, getJob, isLegacyPassJob, LEGACY_NOTE, listMatches, type VerifiedRow } from "./store";

export interface EtherscanReply {
  status: "0" | "1";
  message: string;
  result: unknown;
}

export const ok = (result: unknown, message = "OK"): EtherscanReply => ({ status: "1", message, result });
export const notok = (result: unknown, message = "NOTOK"): EtherscanReply => ({ status: "0", message, result });

export const PENDING = "Pending in queue";
export const PASS = "Pass - Verified";
export const FAIL = "Fail - Unable to verify";
export const NOT_VERIFIED = "Contract source code not verified";
export const ALREADY_VERIFIED = "Contract source code already verified";
export const RATE_LIMITED = "Max rate limit reached";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const UNAVAILABLE = "Verification is unavailable: the explorer has no database provisioned";

export function maxOpenJobs(): number {
  const n = Number(process.env.CITRATE_VERIFY_MAX_PENDING);
  return Number.isInteger(n) && n > 0 ? n : 200;
}

export interface ContractApiDeps {
  db: ChainDb | null;
  chain: ChainReader;
}

/** Actions that submit work (rate limited as submissions by the route). */
export const SUBMIT_ACTIONS = new Set(["verifysourcecode", "verifyproxycontract"]);
export const CONTRACT_ACTIONS = new Set([
  "verifysourcecode",
  "checkverifystatus",
  "getabi",
  "getsourcecode",
  "getcontractcreation",
  "verifyproxycontract",
  "checkproxyverification",
]);

/** Shared by Etherscan and Sourcify doors: a full runtime record already exists for the live code. */
export async function hasFullMatch(db: ChainDb, genesis: string, address: string, code: string): Promise<boolean> {
  const rows = await listMatches(db, { genesisHash: genesis, address, runtimeCodeHash: keccak256(code as Hex) });
  return rows.some((r) => r.matchType === "full");
}

/** Validate a request, refuse what cannot verify, then enqueue. Returns the job id or an Etherscan-style refusal. */
export async function submitRequest(
  deps: { db: ChainDb; chain: ChainReader },
  req: VerifyRequest,
  origin: "etherscan" | "sourcify" | "api",
): Promise<{ id: string } | { refused: "no_code" | "already_verified" | "busy"; message: string }> {
  const [genesis, code] = await Promise.all([deps.chain.genesisHash(), deps.chain.getCode(req.address)]);
  if (!code || code === "0x") return { refused: "no_code", message: `Unable to locate ContractCode at ${req.address}` };
  if (await hasFullMatch(deps.db, genesis, req.address, code)) return { refused: "already_verified", message: ALREADY_VERIFIED };
  if ((await countOpenJobs(deps.db)) >= maxOpenJobs()) return { refused: "busy", message: RATE_LIMITED };
  const id = await enqueueJob(deps.db, {
    kind: "verify",
    origin,
    chainId: deps.chain.chainId,
    genesisHash: genesis,
    address: req.address,
    request: req,
    sourceHash: sourceHash(req.stdJsonInput),
  });
  return { id };
}

function spdx(row: VerifiedRow): string {
  const std = stdJsonOf(row);
  const file = row.fullyQualifiedName?.slice(0, row.fullyQualifiedName.lastIndexOf(":"));
  const content = (file && std?.sources?.[file]?.content) ?? Object.values(std?.sources ?? {})[0]?.content ?? row.legacySource ?? "";
  const m = /SPDX-License-Identifier:\s*([^\s*]+)/.exec(content);
  return m ? m[1] : "Unknown";
}

function libraryString(row: VerifiedRow): string {
  if (!row.libraries) return "";
  try {
    const libs = JSON.parse(row.libraries) as Record<string, string>;
    return Object.entries(libs)
      .map(([k, at]) => `${k.slice(k.lastIndexOf(":") + 1)}:${at}`)
      .join(";");
  } catch {
    return "";
  }
}

const UNVERIFIED_SOURCE = {
  SourceCode: "",
  ABI: NOT_VERIFIED,
  ContractName: "",
  CompilerVersion: "",
  OptimizationUsed: "",
  Runs: "",
  ConstructorArguments: "",
  EVMVersion: "Default",
  Library: "",
  LicenseType: "Unknown",
  Proxy: "0",
  Implementation: "",
  SwarmSource: "",
};

/** One `getsourcecode` result entry in Etherscan's shape. */
export function sourceEntry(r: Resolved | null): Record<string, string> {
  const proxy = r?.proxy ? { Proxy: "1", Implementation: r.proxy.implementation } : {};
  const row = r?.row;
  if (!row) return { ...UNVERIFIED_SOURCE, ...proxy };
  const std = stdJsonOf(row);
  const settings = (std?.settings ?? {}) as { optimizer?: { enabled?: boolean; runs?: number }; evmVersion?: string };
  const single = row.sourceFormat === "solidity-single-file" && std?.sources;
  const sourceCode = std
    ? single
      ? Object.values(std.sources ?? {})[0]?.content ?? ""
      : `{${JSON.stringify(std)}}` // Etherscan wraps standard JSON in a second pair of braces
    : (row.legacySource ?? "");
  const fqn = row.fullyQualifiedName ?? "";
  return {
    SourceCode: sourceCode,
    ABI: row.abi ?? "",
    ContractName: row.contractName ?? "",
    CompilerVersion: row.solcLongVersion ? `v${row.solcLongVersion}` : (row.compilerVersion ?? ""),
    CompilerType: "solc",
    OptimizationUsed: settings.optimizer?.enabled ? "1" : "0",
    Runs: String(settings.optimizer?.runs ?? 200),
    ConstructorArguments: row.constructorArgs ?? "",
    EVMVersion: settings.evmVersion ?? "Default",
    Library: libraryString(row),
    ContractFileName: fqn.includes(":") ? fqn.slice(0, fqn.lastIndexOf(":")) : "",
    LicenseType: spdx(row),
    Proxy: "0",
    Implementation: "",
    SwarmSource: "",
    SimilarMatch: row.matchType === "similar" && r?.original ? r.original.address : "",
    ...proxy,
  };
}

async function statusOf(db: ChainDb, guid: string | null, kind: "verify" | "proxy"): Promise<EtherscanReply> {
  if (!guid) return notok("Missing guid");
  const job = await getJob(db, guid);
  if (!job || job.kind !== kind) return notok("Unknown UID");
  if (job.status === "pending" || job.status === "running") return notok(PENDING);
  if (kind === "proxy") return job.status === "pass" ? ok(job.resultMessage) : notok(job.resultMessage);
  if (isLegacyPassJob(job)) return notok(`Fail - ${LEGACY_NOTE}`);
  if (job.status === "pass") return ok(PASS);
  return notok(FAIL);
}

/** Handle one `module=contract` action. The route has already applied rate limits. */
export async function contractAction(
  action: string,
  p: URLSearchParams,
  method: "GET" | "POST",
  deps: ContractApiDeps,
): Promise<EtherscanReply> {
  const chainid = p.get("chainid");
  if (chainid !== null && chainid !== String(deps.chain.chainId)) {
    return notok(`Missing or unsupported chainid parameter: this explorer serves chain ${deps.chain.chainId}`);
  }
  if (!CONTRACT_ACTIONS.has(action)) return notok(`Unsupported action "${action}" for module contract`);
  const db = deps.db;
  if (!db) return notok(UNAVAILABLE);

  switch (action) {
    case "verifysourcecode": {
      if (method !== "POST") return notok("verifysourcecode requires POST");
      let req: VerifyRequest;
      try {
        req = fromEtherscanForm(p);
      } catch (e) {
        if (e instanceof RequestError) return notok(e.message);
        throw e;
      }
      const r = await submitRequest({ db, chain: deps.chain }, req, "etherscan");
      return "id" in r ? ok(r.id) : notok(r.message);
    }
    case "checkverifystatus":
      return statusOf(db, p.get("guid"), "verify");
    case "checkproxyverification":
      return statusOf(db, p.get("guid"), "proxy");
    case "verifyproxycontract": {
      const address = p.get("address") ?? p.get("contractaddress");
      if (!address || !ADDRESS_RE.test(address)) return notok("Invalid address format");
      const expected = p.get("expectedimplementation");
      if (expected && !ADDRESS_RE.test(expected)) return notok("Invalid expectedimplementation address format");
      const [genesis, code] = await Promise.all([deps.chain.genesisHash(), deps.chain.getCode(address)]);
      if (!code || code === "0x") return notok(`Unable to locate ContractCode at ${address.toLowerCase()}`);
      if ((await countOpenJobs(db)) >= maxOpenJobs()) return notok(RATE_LIMITED);
      const id = await enqueueJob(db, {
        kind: "proxy",
        origin: "etherscan",
        chainId: deps.chain.chainId,
        genesisHash: genesis,
        address,
        request: { address: address.toLowerCase(), expectedImplementation: expected ? expected.toLowerCase() : null },
      });
      return ok(id);
    }
    case "getabi": {
      const address = p.get("address");
      if (!address || !ADDRESS_RE.test(address)) return notok("Invalid Address format");
      const r = await resolveConfirmed(db, deps.chain, address);
      return r?.row?.abi ? ok(r.row.abi) : notok(NOT_VERIFIED);
    }
    case "getsourcecode": {
      const address = p.get("address");
      if (!address || !ADDRESS_RE.test(address)) return notok("Invalid Address format");
      return ok([sourceEntry(await resolveConfirmed(db, deps.chain, address))]);
    }
    case "getcontractcreation": {
      const list = (p.get("contractaddresses") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      if (!list.length || list.length > 5 || !list.every((a) => ADDRESS_RE.test(a))) {
        return notok("contractaddresses must be 1 to 5 comma-separated addresses");
      }
      const out = [];
      for (const a of list) {
        const created = await findCreation(db, a);
        const txHash = created?.txHash ?? (await resolveConfirmed(db, deps.chain, a))?.row?.creationTxHash ?? null;
        if (!txHash) continue;
        const tx = await deps.chain.getTransaction(txHash);
        if (!tx) continue;
        out.push({
          contractAddress: a.toLowerCase(),
          contractCreator: tx.from,
          txHash: tx.hash,
          blockNumber: tx.blockNumber ? String(Number(BigInt(tx.blockNumber))) : "",
          timestamp: created?.timestamp != null ? String(created.timestamp) : "",
          contractFactory: tx.to ?? "",
          creationBytecode: tx.to === null ? tx.input : "",
        });
      }
      return out.length ? ok(out) : { status: "0", message: "No data found", result: null };
    }
  }
  return notok(`Unsupported action "${action}" for module contract`);
}
