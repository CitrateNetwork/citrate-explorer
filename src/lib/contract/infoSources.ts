/**
 * ContractInfoSource adapters (EXP-S3). The contract pages and the agent read
 * verified-source facts only through `ContractInfoSource`, so the store behind it
 * can change without touching the UI.
 *
 *  - createApiSourceV2 (the contract page and the approval view): GET
 *    /api/contract/{a}/verified, the verification v2 record (`verified_contracts` +
 *    `contract_proxies`) mapped by fromV2Response: every source file, the deployed
 *    source map, settings, the creation match.
 *  - createApiSourceV1: the lean GET /api/contract/{a}/source lookup (one display
 *    source, no source map), kept for callers that want the small shape (citrate-core's
 *    get_verified_source tool). Since verification v2 it also reads `verified_contracts`
 *    (src/lib/verify/verifiedSource.ts).
 */
import type { Abi, Hex } from "viem";
import { sourceIndexByIdFromNames } from "./sourceMap";
import type { ContractInfo, ContractInfoSource, SourceFile, VerificationStatus } from "./types";
import type { VerifiedContractRecordV2, VerifiedContractResponseV2 } from "./v2Types";
import { isLegacyRecord } from "@/lib/verify/legacy";

/** Upper bound the v1 route accepts for returned source (MAX_SOURCE_CHARS_LIMIT). */
const V1_MAX_SOURCE_CHARS = 400_000;

function parseAbi(raw: unknown): Abi | null {
  if (Array.isArray(raw)) return raw as Abi;
  if (typeof raw !== "string" || !raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? (v as Abi) : null;
  } catch {
    return null;
  }
}

function base(address: string, status: VerificationStatus, note: string, origin: ContractInfo["origin"]): ContractInfo {
  return {
    address: address.toLowerCase(),
    status,
    verified: false,
    matchType: null,
    contractName: null,
    compilerVersion: null,
    abi: null,
    sources: [],
    sourceIndexById: null,
    deployedSourceMap: null,
    settings: null,
    runtimeMatch: null,
    creationMatch: null,
    constructorArgs: null,
    verifiedAt: null,
    note,
    origin,
  };
}

const STATUSES: VerificationStatus[] = ["verified", "partial-match", "similar-match", "legacy-unconfirmed", "unverified", "unavailable"];

/** The JSON GET /api/contract/{a}/source returns (src/lib/verify/verifiedSource.ts VerifiedSource). */
export interface V1SourceJson {
  address?: string;
  status?: string;
  verified?: boolean;
  matchType?: string | null;
  contractName?: string | null;
  compilerVersion?: string | null;
  source?: string | null;
  sourceTruncated?: boolean;
  abi?: unknown;
  verifiedAt?: string | null;
  note?: string;
}

export function createApiSourceV1(opts: { fetch?: typeof fetch; baseUrl?: string } = {}): ContractInfoSource {
  const f = opts.fetch ?? fetch;
  const baseUrl = opts.baseUrl ?? "";
  return {
    origin: "api-source-v1",
    async load(address) {
      const a = address.toLowerCase();
      let j: V1SourceJson;
      try {
        const res = await f(`${baseUrl}/api/contract/${a}/source?maxSourceChars=${V1_MAX_SOURCE_CHARS}`);
        if (!res.ok) return base(a, "unavailable", `The verification lookup failed (HTTP ${res.status}), so it is unknown whether this contract is verified.`, "api-source-v1");
        j = (await res.json()) as V1SourceJson;
      } catch {
        return base(a, "unavailable", "The verification lookup could not be reached, so it is unknown whether this contract is verified.", "api-source-v1");
      }
      return contractInfoFromV1(a, j);
    },
  };
}

/** Map one v1 VerifiedSource record (the route's JSON, or the store's object) to ContractInfo. */
export function contractInfoFromV1(address: string, j: V1SourceJson): ContractInfo {
  const a = address.toLowerCase();
  const status = STATUSES.includes(j.status as VerificationStatus) ? (j.status as VerificationStatus) : "unavailable";
  const info = base(a, status, j.note ?? "", "api-source-v1");
  const name = j.contractName ?? null;
  const sources: SourceFile[] = j.source ? [{ path: `${name ?? "Contract"}.sol`, content: j.source }] : [];
  const mt = j.matchType === "full" || j.matchType === "partial" || j.matchType === "similar" ? j.matchType : null;
  return {
    ...info,
    verified: status === "verified" && j.verified === true,
    matchType: mt,
    contractName: name,
    compilerVersion: j.compilerVersion ?? null,
    abi: parseAbi(j.abi),
    sources,
    runtimeMatch: mt === "full" || mt === "partial" ? mt : null,
    verifiedAt: j.verifiedAt ?? null,
    note: j.sourceTruncated ? `${info.note} The source was truncated by the lookup.` : info.note,
  };
}

/**
 * The same v1 record read in-process on the server (the agent, /api/agent/prepare):
 * `load` is getVerifiedSource from src/lib/verify/verifiedSource.ts. Data source
 * (Rule 7): the `verified_contracts` table (verification v2, through engine.getVerifiedContract). A failing lookup is "unavailable",
 * never "unverified".
 */
export function createStoreInfoSource(load: (address: string) => Promise<V1SourceJson>): ContractInfoSource {
  return {
    origin: "api-source-v1",
    async load(address) {
      try {
        return contractInfoFromV1(address, await load(address));
      } catch {
        return base(address, "unavailable", "The verification store could not be read, so it is unknown whether this contract is verified.", "api-source-v1");
      }
    },
  };
}

interface StdJson {
  sources?: Record<string, { content?: string }>;
  settings?: Record<string, unknown>;
}

function parseStd(raw: string | null): StdJson | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as StdJson;
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

const NOTES: Record<VerificationStatus, string> = {
  verified: "Verified: the recompiled bytecode matches the deployed code exactly, metadata included.",
  "partial-match": "Partial match: the code matches only after stripping metadata, so the shown source may differ from what was deployed. This is not a verified match.",
  "similar-match": "Similar match: this address runs code identical to a contract verified at another address; the source shown is that contract's. Not verified at this address.",
  "legacy-unconfirmed": "Legacy record, not confirmed for the current code: this source was recorded before verification v2, which did not record the chain or the code it matched. Not verified.",
  unverified: "Not verified: no source has been verified for this address. Do not assume what its code does.",
  unavailable: "The verification store is unavailable right now, so it is unknown whether this contract is verified.",
};

/** Map one v2 response (best record + similar-match original + proxy link) to ContractInfo. */
export function fromV2Response(resp: VerifiedContractResponseV2): ContractInfo {
  const r = resp.record;
  if (!resp.storeAvailable) return base(r?.address ?? "", "unavailable", NOTES.unavailable, "verified-contracts-v2");
  if (!r) return base("", "unverified", NOTES.unverified, "verified-contracts-v2");
  // A record copied forward from the v1 store never names the chain or code it matched.
  const legacy = r.legacy === true || isLegacyRecord(r);
  const status: VerificationStatus = legacy
    ? "legacy-unconfirmed"
    : r.matchType === "full"
      ? "verified"
      : r.matchType === "partial"
        ? "partial-match"
        : "similar-match";
  // A similar match carries the original's source; fall back to it field by field.
  const src: VerifiedContractRecordV2 = r.matchType === "similar" && resp.original ? resp.original : r;
  const std = parseStd(r.stdJsonInput) ?? parseStd(src.stdJsonInput);
  let sources: SourceFile[] = [];
  let sourceIndexById: Record<number, number> | null = null;
  if (std?.sources) {
    sources = Object.entries(std.sources).map(([path, s]) => ({ path, content: s.content ?? "" }));
    const names = sources.map((s) => s.path);
    const ids = r.sourceIds ?? src.sourceIds ?? null;
    sourceIndexById = ids
      ? Object.fromEntries(Object.entries(ids).flatMap(([n, id]) => (names.includes(n) ? [[id, names.indexOf(n)]] : [])))
      : sourceIndexByIdFromNames(names);
  } else if (src.legacySource) {
    sources = [{ path: `${src.contractName ?? "Contract"}.sol`, content: src.legacySource }];
  }
  let settings: Record<string, unknown> | null = null;
  if (std?.settings) {
    // outputSelection is how the verifier asked solc for output, not a property of the contract.
    const { outputSelection: _drop, ...rest } = std.settings;
    void _drop;
    settings = rest;
  }
  return {
    address: r.address.toLowerCase(),
    status,
    verified: status === "verified",
    // A legacy record's old match types were never checked against this code.
    matchType: legacy ? null : r.matchType,
    contractName: r.contractName ?? src.contractName,
    compilerVersion: r.solcLongVersion ?? r.compilerVersion ?? src.compilerVersion,
    abi: parseAbi(r.abi) ?? parseAbi(src.abi),
    sources,
    sourceIndexById,
    deployedSourceMap: r.deployedSourceMap ?? src.deployedSourceMap,
    settings,
    runtimeMatch: legacy ? null : r.runtimeMatch,
    creationMatch: legacy ? null : r.creationMatch,
    constructorArgs: (r.constructorArgs as Hex | null) ?? null,
    verifiedAt: r.createdAt,
    note: NOTES[status],
    origin: "verified-contracts-v2",
  };
}

/** A ContractInfoSource over a v2 read route; `fetchRecord` is the route call. */
export function createV2InfoSource(fetchRecord: (address: string) => Promise<VerifiedContractResponseV2>): ContractInfoSource {
  return {
    origin: "verified-contracts-v2",
    async load(address) {
      try {
        const info = fromV2Response(await fetchRecord(address.toLowerCase()));
        return { ...info, address: address.toLowerCase() };
      } catch {
        return base(address, "unavailable", NOTES.unavailable, "verified-contracts-v2");
      }
    },
  };
}

/**
 * The contract page's source of verified facts: GET /api/contract/{a}/verified (the
 * verification v2 record, src/app/api/contract/[addr]/verified/route.ts). Data source
 * (Rule 7): the `verified_contracts` / `contract_proxies` tables for the address's live
 * code. Any HTTP failure (rate limit, 5xx) or unreachable route is "unavailable".
 */
export function createApiSourceV2(opts: { fetch?: typeof fetch; baseUrl?: string } = {}): ContractInfoSource {
  const f = opts.fetch ?? fetch;
  const baseUrl = opts.baseUrl ?? "";
  return createV2InfoSource(async (a) => {
    const res = await f(`${baseUrl}/api/contract/${a}/verified`);
    if (!res.ok) throw new Error(`verified record lookup failed (HTTP ${res.status})`);
    return (await res.json()) as VerifiedContractResponseV2;
  });
}
