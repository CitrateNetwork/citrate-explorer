/**
 * Normalize verification submissions (EXP-S2) into one request shape the worker
 * compiles. Front doors:
 *   - Etherscan `module=contract&action=verifysourcecode` form fields
 *     (codeformat solidity-standard-json-input | solidity-single-file);
 *   - Sourcify v2 `POST /v2/verify/{chainId}/{address}` (standard JSON) and
 *     `POST /v2/verify/metadata/{chainId}/{address}` (metadata.json + sources);
 *   - the JSON `POST /api/verify` used by Citrate Core.
 *
 * Every path ends in {@link boundStandardInput} (source count, total bytes, no
 * `urls` sources, optimizer runs) so oversized or out-of-band input is refused at
 * the door, before a job exists. Pure: no RPC, no DB, no compiler.
 */
import { createHash } from "crypto";
import { boundStandardInput, InputTooLarge } from "./inputbound";

export type SourceFormat = "solidity-standard-json-input" | "solidity-single-file" | "metadata";

export interface StdJsonInput {
  language: string;
  sources: Record<string, { content: string }>;
  settings?: Record<string, unknown>;
}

export interface VerifyRequest {
  /** Lowercased 0x address. */
  address: string;
  format: SourceFormat;
  /** The compiler version as submitted, e.g. "v0.8.26+commit.8a97fa7a" or "0.8.26". */
  compilerVersion: string;
  stdJsonInput: StdJsonInput;
  /** "path/File.sol:Name", or a bare "Name", or null to try every compiled contract. */
  contractIdentifier: string | null;
  /** Hex without 0x, as the submitter gave it; checked against the creation tx. */
  constructorArgs: string | null;
  creationTxHash: string | null;
  /** Libraries the submitter named ("Name" or "path:Name" -> address). */
  libraries: Record<string, string>;
}

export class RequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestError";
  }
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const TX_RE = /^0x[0-9a-fA-F]{64}$/;
const HEX_RE = /^(0x)?([0-9a-fA-F]{2})*$/;
const IDENT_RE = /^[^\0]{1,512}$/;

/** Hard cap on the raw submitted source payload (before parsing). */
export function maxSourceBytes(): number {
  const raw = Number(process.env.CITRATE_VERIFY_MAX_SOURCE);
  return Number.isInteger(raw) && raw > 0 ? raw : 2 * 1024 * 1024;
}

function address(v: unknown, field: string): string {
  if (typeof v !== "string" || !ADDRESS_RE.test(v)) throw new RequestError(`${field} must be a 0x-prefixed 20-byte address`);
  return v.toLowerCase();
}

function optHex(v: unknown, field: string): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !HEX_RE.test(v)) throw new RequestError(`${field} must be hex`);
  const h = v.replace(/^0x/, "").toLowerCase();
  return h.length ? h : null;
}

function optTx(v: unknown, field: string): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !TX_RE.test(v)) throw new RequestError(`${field} must be a 32-byte transaction hash`);
  return v.toLowerCase();
}

function optIdent(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !IDENT_RE.test(v)) throw new RequestError("contract name is malformed");
  return v.trim();
}

function version(v: unknown): string {
  if (typeof v !== "string" || !/^v?\d{1,2}\.\d{1,2}\.\d{1,2}(\+commit\.[0-9a-fA-F]{6,40})?$/.test(v.trim())) {
    throw new RequestError("compiler version must look like v0.8.26+commit.8a97fa7a or 0.8.26");
  }
  return v.trim();
}

function bounded(input: unknown): StdJsonInput {
  try {
    boundStandardInput(input);
  } catch (e) {
    if (e instanceof InputTooLarge) throw new RequestError(e.message);
    throw e;
  }
  return input as StdJsonInput;
}

function parseStdJson(raw: string): StdJsonInput {
  if (Buffer.byteLength(raw, "utf8") > maxSourceBytes()) {
    throw new RequestError(`source exceeds the ${maxSourceBytes()} byte limit`);
  }
  let parsed: unknown;
  try {
    // Etherscan's getsourcecode wraps standard JSON in an extra pair of braces; accept it back.
    const t = raw.trim();
    parsed = JSON.parse(t.startsWith("{{") && t.endsWith("}}") ? t.slice(1, -1) : t);
  } catch {
    throw new RequestError("source is not valid standard JSON input");
  }
  return bounded(parsed);
}

/** sha256 of the canonical JSON of the input, for dedup and display. */
export function sourceHash(input: StdJsonInput): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

/** Etherscan form fields -> request. Accepts both `constructorArguements` (Etherscan's spelling) and `constructorArguments`. */
export function fromEtherscanForm(p: URLSearchParams): VerifyRequest {
  const addr = address(p.get("contractaddress") ?? p.get("address"), "contractaddress");
  const codeformat = p.get("codeformat") ?? "solidity-single-file";
  const compilerVersion = version(p.get("compilerversion"));
  const source = p.get("sourceCode") ?? p.get("sourcecode");
  if (!source) throw new RequestError("sourceCode is required");
  const constructorArgs = optHex(p.get("constructorArguements") ?? p.get("constructorArguments"), "constructorArguments");
  const libraries: Record<string, string> = {};
  for (let i = 1; i <= 10; i++) {
    const name = p.get(`libraryname${i}`);
    const at = p.get(`libraryaddress${i}`);
    if (name && at) libraries[name.trim()] = address(at, `libraryaddress${i}`);
  }
  const creationTxHash = optTx(p.get("creationtxhash"), "creationtxhash");

  if (codeformat === "solidity-standard-json-input") {
    return {
      address: addr,
      format: codeformat,
      compilerVersion,
      stdJsonInput: parseStdJson(source),
      contractIdentifier: optIdent(p.get("contractname")),
      constructorArgs,
      creationTxHash,
      libraries,
    };
  }
  if (codeformat !== "solidity-single-file") {
    throw new RequestError(`unsupported codeformat "${codeformat}" (solidity-standard-json-input or solidity-single-file)`);
  }
  if (Buffer.byteLength(source, "utf8") > maxSourceBytes()) {
    throw new RequestError(`source exceeds the ${maxSourceBytes()} byte limit`);
  }
  const name = optIdent(p.get("contractname"));
  const bare = name ? name.replace(/^.*:/, "") : null;
  const file = bare ? `${bare}.sol` : "Contract.sol";
  const optimized = p.get("optimizationUsed") === "1" || p.get("optimizationused") === "1";
  const runs = Number(p.get("runs") ?? 200);
  if (!Number.isInteger(runs) || runs < 0) throw new RequestError("runs must be a non-negative integer");
  const evm = p.get("evmversion") ?? p.get("evmVersion");
  const settings: Record<string, unknown> = { optimizer: { enabled: optimized, runs } };
  if (evm && evm.toLowerCase() !== "default") settings.evmVersion = evm;
  return {
    address: addr,
    format: "solidity-single-file",
    compilerVersion,
    stdJsonInput: bounded({ language: "Solidity", sources: { [file]: { content: source } }, settings }),
    contractIdentifier: bare ? `${file}:${bare}` : null,
    constructorArgs,
    creationTxHash,
    libraries,
  };
}

/** Sourcify v2 `POST /v2/verify/{chainId}/{address}` body -> request. */
export function fromSourcifyStdJson(body: unknown, addr: string): VerifyRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!b.stdJsonInput || typeof b.stdJsonInput !== "object") throw new RequestError("stdJsonInput is required");
  const raw = JSON.stringify(b.stdJsonInput);
  if (Buffer.byteLength(raw, "utf8") > maxSourceBytes()) throw new RequestError(`stdJsonInput exceeds the ${maxSourceBytes()} byte limit`);
  const ident = optIdent(b.contractIdentifier);
  if (!ident) throw new RequestError("contractIdentifier is required (path/File.sol:Name)");
  return {
    address: address(addr, "address"),
    format: "solidity-standard-json-input",
    compilerVersion: version(b.compilerVersion),
    stdJsonInput: bounded(b.stdJsonInput),
    contractIdentifier: ident,
    constructorArgs: null,
    creationTxHash: optTx(b.creationTransactionHash, "creationTransactionHash"),
    libraries: {},
  };
}

interface SolcMetadata {
  compiler?: { version?: string };
  language?: string;
  settings?: Record<string, unknown> & { compilationTarget?: Record<string, string>; libraries?: Record<string, string> };
  sources?: Record<string, unknown>;
}

/**
 * Sourcify v2 `POST /v2/verify/metadata/{chainId}/{address}`: a solc metadata.json
 * plus the source files it names. Rebuilds the exact standard JSON input solc used:
 * the metadata's settings, minus compilationTarget, with libraries regrouped by file.
 */
export function fromSourcifyMetadata(body: unknown, addr: string): VerifyRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  const raw = typeof b.metadata === "string" ? b.metadata : JSON.stringify(b.metadata ?? null);
  if (Buffer.byteLength(raw, "utf8") > maxSourceBytes()) throw new RequestError(`metadata exceeds the ${maxSourceBytes()} byte limit`);
  let meta: SolcMetadata;
  try {
    meta = JSON.parse(raw) as SolcMetadata;
  } catch {
    throw new RequestError("metadata is not valid JSON");
  }
  if (!meta || typeof meta !== "object" || !meta.settings || !meta.compiler?.version) {
    throw new RequestError("metadata must be a solc metadata.json (compiler.version and settings)");
  }
  const target = Object.entries(meta.settings.compilationTarget ?? {});
  if (target.length !== 1) throw new RequestError("metadata.settings.compilationTarget must name exactly one contract");
  const [targetFile, targetName] = target[0];

  const files = (b.sources ?? {}) as Record<string, unknown>;
  const sources: Record<string, { content: string }> = {};
  for (const name of Object.keys(meta.sources ?? {})) {
    const content = files[name];
    if (typeof content !== "string") throw new RequestError(`source "${name}" named in metadata was not provided`);
    sources[name] = { content };
  }

  const { compilationTarget: _ct, libraries: flatLibs, ...rest } = meta.settings;
  void _ct;
  const settings: Record<string, unknown> = { ...rest };
  if (flatLibs && Object.keys(flatLibs).length) {
    const grouped: Record<string, Record<string, string>> = {};
    for (const [key, at] of Object.entries(flatLibs)) {
      const i = key.lastIndexOf(":");
      const file = i >= 0 ? key.slice(0, i) : "";
      const lib = i >= 0 ? key.slice(i + 1) : key;
      (grouped[file] ??= {})[lib] = at;
    }
    settings.libraries = grouped;
  }
  return {
    address: address(addr, "address"),
    format: "metadata",
    compilerVersion: version(meta.compiler.version),
    stdJsonInput: bounded({ language: meta.language ?? "Solidity", sources, settings }),
    contractIdentifier: `${targetFile}:${targetName}`,
    constructorArgs: null,
    creationTxHash: optTx(b.creationTransactionHash, "creationTransactionHash"),
    libraries: {},
  };
}

/** The JSON `POST /api/verify` body (Citrate Core's post-deploy verify). */
export function fromApiJson(body: unknown): VerifyRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  const p = new URLSearchParams();
  const set = (k: string, v: unknown) => {
    if (v !== undefined && v !== null) p.set(k, String(v));
  };
  set("contractaddress", b.address);
  const format = (b.format as string | undefined) ?? "solidity-standard-json-input";
  if (format === "metadata") {
    let parsed: { metadata?: unknown; sources?: unknown };
    try {
      parsed = JSON.parse(String(b.source ?? "")) as { metadata?: unknown; sources?: unknown };
    } catch {
      throw new RequestError("metadata source must be JSON {metadata, sources}");
    }
    return fromSourcifyMetadata(parsed, String(b.address ?? ""));
  }
  set("codeformat", format);
  set("compilerversion", b.compilerVersion);
  set("sourceCode", b.source);
  set("constructorArguments", b.constructorArguments);
  set("creationtxhash", b.creationTxHash);
  set("contractname", b.contractName);
  if (typeof b.optimizationRuns === "number") {
    set("optimizationUsed", b.optimizationRuns > 0 ? "1" : "0");
    set("runs", b.optimizationRuns);
  }
  set("evmversion", b.evmVersion);
  return fromEtherscanForm(p);
}
