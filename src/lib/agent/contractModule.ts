/**
 * EXP-AGENT's implementation of the shared `ContractModule`
 * (src/lib/contracts/types.ts): ABI resolution, proxy detection, reads,
 * calldata/log decoding and write preparation with simulation and risk flags.
 *
 * EXP-CONTRACT owns the canonical module. Until it lands, the agent uses this
 * one through `defaultContractModule()`; switching to EXP-CONTRACT's is a
 * one-line change to that factory.
 *
 * Data sources (Rule 11):
 *   - live Citrate RPC through the read-only harness client: eth_getCode,
 *     eth_getStorageAt (proxy slots), eth_call (reads, ERC-165 probes,
 *     simulation), eth_estimateGas, eth_gasPrice, eth_blockNumber;
 *   - verified ABIs from the `contract_verifications` table via getVerifiedSource;
 *   - the relay sponsor policy (src/lib/relay/policy.ts) for gasless eligibility.
 * No signer is reachable from here: the harness client has no account.
 */
import {
  decodeErrorResult,
  decodeEventLog,
  decodeFunctionData,
  decodeFunctionResult,
  encodeFunctionData,
  formatEther,
  getAddress as checksum,
  keccak256,
  parseAbi,
  parseAbiItem,
  parseEther,
  toBytes,
  toFunctionSelector,
  toFunctionSignature,
  toEventSignature,
  type Abi,
} from "viem";
import { PublicError } from "@/lib/api/errors";
import {
  CITRATE_WRITE_CHAIN_ID,
  type AbiItem,
  type AbiParam,
  type AbiSource,
  type Address,
  type ContractIdentity,
  type ContractModule,
  type ContractReadResult,
  type DecodedCall,
  type DecodedLog,
  type DecodedValue,
  type Hex,
  type InterfaceSupport,
  type PreparedWrite,
  type PrepareWriteRequest,
  type ProxyInfo,
  type RelayEligibility,
  type ResolvedAbi,
  type Simulation,
  type VerificationStatus,
} from "@/lib/contracts/types";
import type { VerifiedSource } from "@/lib/verify/verifiedSource";
import { assessRisk, payableThresholdWei } from "./risk";

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

/** The subset of a viem PublicClient this module reads with (the harness client satisfies it). */
export interface ChainReader {
  getCode(a: { address: Address }): Promise<Hex | undefined>;
  getStorageAt(a: { address: Address; slot: Hex }): Promise<Hex | undefined>;
  call(a: { account?: Address; to: Address; data: Hex; value?: bigint; blockNumber?: bigint }): Promise<{ data?: Hex }>;
  estimateGas(a: { account?: Address; to: Address; data: Hex; value?: bigint }): Promise<bigint>;
  getGasPrice(): Promise<bigint>;
  getBlockNumber(): Promise<bigint>;
}

export interface ContractModuleDeps {
  reader: ChainReader;
  verified: (address: string) => Promise<VerifiedSource>;
  label: (address: string) => string | null;
  /** The relay's sponsor policy, applied to (value, to, gas). */
  relayPolicy: (req: { value: string; to: string; gas: string }) => { ok: true } | { ok: false; error: string };
  /** True when a forwarder address is configured for gasless writes. */
  relayConfigured: () => boolean;
  payableThresholdWei: () => bigint;
  now: () => Date;
}

// ---------------------------------------------------------------------------
// Proxy detection
// ---------------------------------------------------------------------------

const slotMinusOne = (label: string): Hex => `0x${(BigInt(keccak256(toBytes(label))) - 1n).toString(16).padStart(64, "0")}` as Hex;

/** EIP-1967 storage slots (keccak256(label) - 1) and the EIP-1822 PROXIABLE slot. */
export const PROXY_SLOTS = {
  implementation: slotMinusOne("eip1967.proxy.implementation"),
  admin: slotMinusOne("eip1967.proxy.admin"),
  beacon: slotMinusOne("eip1967.proxy.beacon"),
  eip1822: keccak256(toBytes("PROXIABLE")),
} as const;

const EIP1167_RE = /^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/i;
const ZERO = "0x0000000000000000000000000000000000000000";

function slotAddress(word: Hex | undefined): Address | null {
  if (!word || word === "0x") return null;
  const hex = word.slice(2).padStart(64, "0");
  if (!/^0{24}/.test(hex)) return null; // not an address-shaped word
  const a = `0x${hex.slice(24)}`;
  return a === ZERO ? null : (checksum(a) as Address);
}

// ---------------------------------------------------------------------------
// Known signatures (decode fallback when no verified ABI)
// ---------------------------------------------------------------------------

const KNOWN_ABI = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function increaseAllowance(address spender, uint256 addedValue) returns (bool)",
  "function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
  "function setApprovalForAll(address operator, bool approved)",
  "function safeTransferFrom(address from, address to, uint256 tokenId)",
  "function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)",
  "function transferOwnership(address newOwner)",
  "function renounceOwnership()",
  "function upgradeTo(address newImplementation)",
  "function upgradeToAndCall(address newImplementation, bytes data) payable",
  "function changeAdmin(address newAdmin)",
  "function deposit() payable",
  "function withdraw(uint256 amount)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
  "event ApprovalForAll(address indexed owner, address indexed operator, bool approved)",
  "event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)",
  "event Upgraded(address indexed implementation)",
  "event AdminChanged(address previousAdmin, address newAdmin)",
  "event BeaconUpgraded(address indexed beacon)",
]) as unknown as AbiItem[];

// ---------------------------------------------------------------------------
// ABI helpers
// ---------------------------------------------------------------------------

function asAbi(items: unknown[] | null): AbiItem[] | null {
  if (!items) return null;
  return items.filter((x): x is AbiItem => !!x && typeof x === "object" && typeof (x as AbiItem).type === "string");
}

const fnSig = (f: AbiItem) => toFunctionSignature(f as never);

function functions(abi: AbiItem[]): AbiItem[] {
  return abi.filter((x) => x.type === "function" && x.name);
}

/** Pick one function by name or full signature. Throws a caller-facing error on ambiguity. */
export function pickFunction(abi: AbiItem[] | null, ref: string): AbiItem | null {
  if (!abi) return null;
  const want = ref.trim().replace(/^function\s+/, "");
  const fns = functions(abi);
  if (want.includes("(")) {
    const norm = want.replace(/\s+/g, "").replace(/\)(view|pure|payable|nonpayable|returns.*)$/i, ")");
    const exact = fns.find((f) => fnSig(f) === norm);
    if (exact) return exact;
    // A signature with parameter names: compare by name + types.
    try {
      const parsed = parseAbiItem(`function ${want}` as never) as unknown as AbiItem;
      return fns.find((f) => fnSig(f) === fnSig(parsed)) ?? null;
    } catch {
      return null;
    }
  }
  const byName = fns.filter((f) => f.name === want);
  if (byName.length > 1) {
    throw new PublicError(`"${want}" is overloaded; pass one of: ${byName.map(fnSig).join(", ")}`);
  }
  return byName[0] ?? null;
}

/** Parse a caller-supplied function signature into an ABI item (no verified ABI). */
export function fragmentFromSignature(ref: string): AbiItem | null {
  const s = ref.trim();
  if (!s.includes("(")) return null;
  try {
    const item = parseAbiItem((s.startsWith("function ") ? s : `function ${s}`) as never) as unknown as AbiItem;
    return item.type === "function" ? item : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Argument coercion and JSON-safe decoding
// ---------------------------------------------------------------------------

function fail(param: AbiParam, why: string): never {
  throw new PublicError(`argument ${param.name || "(unnamed)"} (${param.type}): ${why}`);
}

export function coerceArg(param: AbiParam, v: unknown): unknown {
  const t = param.type;
  const arr = /^(.*)\[(\d*)\]$/.exec(t);
  if (arr) {
    let list = v;
    if (typeof v === "string") {
      try {
        list = JSON.parse(v);
      } catch {
        fail(param, "expected an array");
      }
    }
    if (!Array.isArray(list)) fail(param, "expected an array");
    if (arr[2] !== "" && list.length !== Number(arr[2])) fail(param, `expected exactly ${arr[2]} items`);
    const inner = { ...param, type: arr[1] };
    return list.map((x) => coerceArg(inner, x));
  }
  if (t === "tuple") {
    const comps = param.components ?? [];
    let obj = v;
    if (typeof v === "string") {
      try {
        obj = JSON.parse(v);
      } catch {
        fail(param, "expected a tuple (array or object)");
      }
    }
    if (Array.isArray(obj)) return comps.map((c, i) => coerceArg(c, obj[i]));
    if (obj && typeof obj === "object") return Object.fromEntries(comps.map((c) => [c.name, coerceArg(c, (obj as Record<string, unknown>)[c.name ?? ""])]));
    fail(param, "expected a tuple (array or object)");
  }
  if (/^u?int\d*$/.test(t)) {
    if (typeof v === "bigint") return v;
    if (typeof v === "number" && Number.isSafeInteger(v)) return BigInt(v);
    if (typeof v === "string" && /^-?(\d+|0x[0-9a-fA-F]+)$/.test(v.trim())) return BigInt(v.trim());
    fail(param, "expected an integer (decimal or 0x)");
  }
  if (t === "address") {
    if (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v)) return checksum(v.toLowerCase());
    fail(param, "expected a 0x-prefixed 20-byte address");
  }
  if (t === "bool") {
    if (v === true || v === "true") return true;
    if (v === false || v === "false") return false;
    fail(param, "expected true or false");
  }
  if (/^bytes(\d+)?$/.test(t)) {
    if (typeof v === "string" && /^0x([0-9a-fA-F]{2})*$/.test(v)) {
      const n = /^bytes(\d+)$/.exec(t)?.[1];
      if (n && (v.length - 2) / 2 !== Number(n)) fail(param, `expected exactly ${n} bytes`);
      return v;
    }
    fail(param, "expected 0x-prefixed hex bytes");
  }
  if (t === "string") {
    if (typeof v === "string") return v;
    fail(param, "expected text");
  }
  fail(param, "unsupported type");
}

export function coerceArgs(inputs: AbiParam[], args: unknown[]): unknown[] {
  if (args.length !== inputs.length) {
    throw new PublicError(`expected ${inputs.length} argument(s) (${inputs.map((i) => `${i.type} ${i.name ?? ""}`.trim()).join(", ")}), got ${args.length}`);
  }
  return inputs.map((p, i) => coerceArg(p, args[i]));
}

/** JSON-safe view of a decoded value, typed by its ABI param (bigints → decimal strings). */
export function jsonValue(param: AbiParam, v: unknown): unknown {
  const arr = /^(.*)\[(\d*)\]$/.exec(param.type);
  if (arr && Array.isArray(v)) return v.map((x) => jsonValue({ ...param, type: arr[1] }, x));
  if (param.type === "tuple") {
    const comps = param.components ?? [];
    if (Array.isArray(v)) return Object.fromEntries(comps.map((c, i) => [c.name || String(i), jsonValue(c, v[i])]));
    if (v && typeof v === "object") return Object.fromEntries(comps.map((c, i) => [c.name || String(i), jsonValue(c, (v as Record<string, unknown>)[c.name ?? String(i)])]));
  }
  if (typeof v === "bigint") return v.toString();
  return v;
}

export function decodedValues(params: AbiParam[] = [], values: readonly unknown[] | unknown): DecodedValue[] {
  const list = params.length === 1 && !Array.isArray(values) ? [values] : (values as readonly unknown[]) ?? [];
  return params.map((p, i) => ({ name: p.name ?? "", type: p.type === "tuple" ? "tuple" : p.type, value: jsonValue(p, (list as unknown[])[i]) }));
}

// ---------------------------------------------------------------------------
// Revert decoding
// ---------------------------------------------------------------------------

function revertData(err: unknown): Hex | null {
  let e: unknown = err;
  for (let depth = 0; e && depth < 8; depth++) {
    const d = (e as { data?: unknown }).data;
    if (typeof d === "string" && /^0x[0-9a-fA-F]*$/.test(d)) return d as Hex;
    if (d && typeof d === "object" && typeof (d as { data?: unknown }).data === "string") return (d as { data: Hex }).data;
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

function mentionsRevert(err: unknown): boolean {
  let e: unknown = err;
  for (let depth = 0; e && depth < 8; depth++) {
    const m = `${(e as { shortMessage?: string }).shortMessage ?? ""} ${(e as { message?: string }).message ?? ""}`;
    if (/revert|execution reverted|out of gas|invalid opcode/i.test(m)) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/** A readable revert reason, or null when the failure was not a revert (RPC down). */
export function revertReason(err: unknown, abi: AbiItem[] | null): string | null {
  const data = revertData(err);
  if (data && data.length >= 10) {
    try {
      const r = decodeErrorResult({ abi: [...(abi ?? []), ...(parseAbi(["error Error(string)", "error Panic(uint256)"]) as unknown as AbiItem[])] as Abi, data });
      if (r.errorName === "Error") return String(r.args?.[0] ?? "");
      if (r.errorName === "Panic") return `panic 0x${BigInt(r.args?.[0] as bigint).toString(16)}`;
      return `${r.errorName}(${(r.args ?? []).map((a) => (typeof a === "bigint" ? a.toString() : JSON.stringify(a))).join(", ")})`;
    } catch {
      return `custom error ${data.slice(0, 10)}`;
    }
  }
  if (data === "0x" || mentionsRevert(err)) return "reverted without a reason";
  return null;
}

// ---------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const SUPPORTS = parseAbi(["function supportsInterface(bytes4) view returns (bool)"]);
const ERC20_PROBES = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
]);

export function preparedWriteId(p: { from: string | null; to: string; data: string; valueWei: bigint }): Hex {
  return keccak256(toBytes(JSON.stringify([CITRATE_WRITE_CHAIN_ID, p.from?.toLowerCase() ?? null, p.to.toLowerCase(), p.data.toLowerCase(), p.valueWei.toString()])));
}

export function createContractModule(deps: ContractModuleDeps): ContractModule & {
  decodeWith(abi: AbiItem[] | null, data: Hex): DecodedCall | null;
} {
  const r = deps.reader;

  const code = async (address: Address): Promise<Hex> => (await r.getCode({ address })) ?? "0x";

  const tryCall = async (to: Address, data: Hex): Promise<Hex | null> => {
    try {
      const res = await r.call({ to, data });
      return res.data && res.data !== "0x" ? res.data : null;
    } catch {
      return null;
    }
  };

  async function detectProxy(address: Address, knownCode?: Hex): Promise<ProxyInfo> {
    const c = knownCode ?? (await code(address));
    const evidence: string[] = [];
    const clone = EIP1167_RE.exec(c);
    if (clone) {
      return { isProxy: true, kind: "eip1167", implementation: checksum(`0x${clone[1]}`) as Address, admin: null, beacon: null, evidence: ["EIP-1167 minimal-proxy bytecode"] };
    }
    if (c === "0x") return { isProxy: false, kind: null, implementation: null, admin: null, beacon: null, evidence };
    const read = (slot: Hex) => r.getStorageAt({ address, slot }).catch(() => undefined);
    const [impl, admin, beacon, uups] = await Promise.all([read(PROXY_SLOTS.implementation), read(PROXY_SLOTS.admin), read(PROXY_SLOTS.beacon), read(PROXY_SLOTS.eip1822)]);
    const implA = slotAddress(impl);
    const adminA = slotAddress(admin);
    const beaconA = slotAddress(beacon);
    const uupsA = slotAddress(uups);
    if (implA) {
      evidence.push("EIP-1967 implementation slot");
      if (adminA) evidence.push("EIP-1967 admin slot");
      return { isProxy: true, kind: "eip1967", implementation: implA, admin: adminA, beacon: null, evidence };
    }
    if (beaconA) {
      evidence.push("EIP-1967 beacon slot");
      const out = await tryCall(beaconA, encodeFunctionData({ abi: parseAbi(["function implementation() view returns (address)"]), functionName: "implementation" }));
      const implFromBeacon = out ? slotAddress(out) : null;
      if (implFromBeacon) evidence.push("beacon.implementation()");
      return { isProxy: true, kind: "eip1967-beacon", implementation: implFromBeacon, admin: adminA, beacon: beaconA, evidence };
    }
    if (uupsA) {
      evidence.push("EIP-1822 PROXIABLE slot");
      return { isProxy: true, kind: "eip1822", implementation: uupsA, admin: null, beacon: null, evidence };
    }
    return { isProxy: false, kind: null, implementation: null, admin: adminA, beacon: null, evidence };
  }

  async function resolveAbiWith(address: Address, knownCode?: Hex): Promise<ResolvedAbi> {
    const c = knownCode ?? (await code(address));
    const proxy = await detectProxy(address, c);
    const own = c === "0x" ? null : await deps.verified(address);
    const ownAbi = own && (own.status === "verified" || own.status === "partial-match") ? asAbi(own.abi) : null;
    if (proxy.isProxy && proxy.implementation) {
      const impl = await deps.verified(proxy.implementation);
      const implAbi = impl.status === "verified" || impl.status === "partial-match" ? asAbi(impl.abi) : null;
      if (implAbi) {
        return {
          address,
          source: "implementation",
          status: impl.status,
          abi: [...implAbi, ...(ownAbi ?? []).filter((x) => x.type !== "constructor")],
          contractName: impl.contractName,
          implementation: proxy.implementation,
          proxy,
          note: `Proxy (${proxy.kind}); decoded with the ${impl.status === "verified" ? "verified" : "partially matched"} implementation ${proxy.implementation}.`,
        };
      }
    }
    if (ownAbi && own) {
      const source: AbiSource = own.status === "verified" ? "verified" : "partial-match";
      return { address, source, status: own.status, abi: ownAbi, contractName: own.contractName, implementation: null, proxy, note: own.note };
    }
    const status: VerificationStatus = own?.status ?? "unverified";
    return {
      address,
      source: "none",
      status,
      abi: null,
      contractName: null,
      implementation: null,
      proxy,
      note:
        c === "0x"
          ? "No contract code at this address."
          : status === "unavailable"
            ? "The verification store is unavailable, so no ABI could be loaded. Pass a full function signature to read or prepare a call."
            : "Not verified: no ABI. Pass a full function signature to read or prepare a call; nothing confirms what the function does.",
    };
  }

  function decodeWith(abi: AbiItem[] | null, data: Hex): DecodedCall | null {
    if (!abi) return null;
    try {
      const d = decodeFunctionData({ abi: abi as Abi, data });
      const frag = functions(abi).find((f) => f.name === d.functionName && toFunctionSelector(fnSig(f)) === data.slice(0, 10).toLowerCase());
      if (!frag) return null;
      return { selector: data.slice(0, 10) as Hex, decodedWith: "", function: d.functionName, signature: fnSig(frag), args: decodedValues(frag.inputs, d.args ?? []), note: "" };
    } catch {
      return null;
    }
  }

  async function decodeCalldata(req: { data: Hex; address?: Address }): Promise<DecodedCall> {
    const selector = (req.data.length >= 10 ? req.data.slice(0, 10) : req.data) as Hex;
    if (req.data.length < 10) return { selector, decodedWith: "unknown", function: null, signature: null, args: [], note: "Calldata shorter than a 4-byte selector (a plain value transfer or fallback call)." };
    if (req.address) {
      const res = await resolveAbiWith(req.address);
      const d = decodeWith(res.abi, req.data);
      if (d) {
        const how = res.source === "verified" ? "verified-abi" : res.source === "implementation" ? "implementation-abi" : "partial-abi";
        return { ...d, decodedWith: how, note: res.source === "verified" ? "Decoded with the verified ABI." : res.note };
      }
    }
    const k = decodeWith(KNOWN_ABI, req.data);
    if (k) return { ...k, decodedWith: "known-signature", note: "Decoded by matching a well-known signature. The selector matched; nothing verified that the contract implements it this way." };
    return { selector, decodedWith: "unknown", function: null, signature: null, args: [], note: "Unknown selector: no verified ABI and no well-known signature matches." };
  }

  async function decodeLog(req: { address: Address; topics: Hex[]; data: Hex }): Promise<DecodedLog> {
    const base = { address: req.address, topics: req.topics, data: req.data };
    const attempt = (abi: AbiItem[] | null) => {
      if (!abi || req.topics.length === 0) return null;
      try {
        const d = decodeEventLog({ abi: abi as Abi, topics: req.topics as [Hex, ...Hex[]], data: req.data });
        const frag = abi.find((x) => x.type === "event" && x.name === d.eventName);
        if (!frag) return null;
        const args = d.args as unknown;
        const list = Array.isArray(args) ? args : (frag.inputs ?? []).map((p, i) => (args as Record<string, unknown>)[p.name ?? String(i)]);
        return { event: d.eventName ?? null, signature: toEventSignature(frag as never), args: decodedValues(frag.inputs, list) };
      } catch {
        return null;
      }
    };
    const res = await resolveAbiWith(req.address);
    const v = attempt(res.abi);
    if (v) return { ...base, ...v, decodedWith: res.source === "verified" ? "verified-abi" : res.source === "implementation" ? "implementation-abi" : "partial-abi" };
    const k = attempt(KNOWN_ABI);
    if (k) return { ...base, ...k, decodedWith: "known-signature" };
    return { ...base, decodedWith: "unknown", event: null, signature: null, args: [] };
  }

  async function interfaces(address: Address): Promise<{ support: InterfaceSupport; token: ContractIdentity["token"] }> {
    const supports = async (id: Hex) => {
      const out = await tryCall(address, encodeFunctionData({ abi: SUPPORTS, functionName: "supportsInterface", args: [id] }));
      if (!out) return null;
      try {
        return decodeFunctionResult({ abi: SUPPORTS, functionName: "supportsInterface", data: out }) as boolean;
      } catch {
        return null;
      }
    };
    const method: string[] = [];
    const [s165, sNone] = await Promise.all([supports("0x01ffc9a7"), supports("0xffffffff")]);
    const erc165 = s165 === true && sNone === false;
    method.push(erc165 ? "ERC-165: supportsInterface(0x01ffc9a7)=true and (0xffffffff)=false" : "ERC-165: not supported (probe failed or answered wrongly)");
    const [s721, s1155] = erc165 ? await Promise.all([supports("0x80ac58cd"), supports("0xd9b67a26")]) : [null, null];
    if (erc165) method.push("ERC-721 / ERC-1155 from supportsInterface(0x80ac58cd / 0xd9b67a26)");
    const read = async (fn: "totalSupply" | "decimals" | "name" | "symbol" | "balanceOf") => {
      const data = encodeFunctionData({ abi: ERC20_PROBES, functionName: fn, args: fn === "balanceOf" ? [ZERO] : undefined } as never);
      const out = await tryCall(address, data);
      if (!out) return null;
      try {
        return decodeFunctionResult({ abi: ERC20_PROBES, functionName: fn, data: out } as never) as unknown;
      } catch {
        return null;
      }
    };
    const [supply, decimals, bal, name, symbol] = await Promise.all([read("totalSupply"), read("decimals"), read("balanceOf"), read("name"), read("symbol")]);
    const erc20Heuristic = s721 !== true && supply !== null && decimals !== null && bal !== null;
    method.push("ERC-20 is a heuristic: ERC-20 has no ERC-165 id, so this means totalSupply(), decimals() and balanceOf() all answered");
    const token =
      name !== null || symbol !== null || decimals !== null
        ? { name: typeof name === "string" ? name : null, symbol: typeof symbol === "string" ? symbol : null, decimals: typeof decimals === "number" ? decimals : null }
        : null;
    return { support: { erc165, erc721: s721 === true, erc1155: s1155 === true, erc20Heuristic, method }, token };
  }

  async function identify(address: Address): Promise<ContractIdentity> {
    const c = await code(address);
    const isContract = c !== "0x";
    if (!isContract) {
      return {
        address,
        isContract: false,
        codeSize: 0,
        codeHash: null,
        label: deps.label(address),
        verification: { status: "unverified", contractName: null, compilerVersion: null },
        proxy: { isProxy: false, kind: null, implementation: null, admin: null, beacon: null, evidence: [] },
        interfaces: { erc165: false, erc721: false, erc1155: false, erc20Heuristic: false, method: ["no code"] },
        token: null,
        note: "Externally-owned account (EOA): no contract code.",
      };
    }
    const [v, proxy, ifs] = await Promise.all([deps.verified(address), detectProxy(address, c), interfaces(address)]);
    return {
      address,
      isContract: true,
      codeSize: (c.length - 2) / 2,
      codeHash: keccak256(c),
      label: deps.label(address),
      verification: { status: v.status, contractName: v.contractName, compilerVersion: v.compilerVersion },
      proxy,
      interfaces: ifs.support,
      token: ifs.token,
      note: proxy.isProxy ? `Proxy (${proxy.kind}) to ${proxy.implementation ?? "an unreadable implementation"}. ${v.note}` : v.note,
    };
  }

  async function read(req: { address: Address; function: string; args: unknown[]; block?: bigint | "latest" }): Promise<ContractReadResult> {
    const res = await resolveAbiWith(req.address);
    let frag = pickFunction(res.abi, req.function);
    let source: AbiSource = res.source;
    if (!frag) {
      frag = fragmentFromSignature(req.function);
      source = "signature";
    }
    if (!frag) {
      throw new PublicError(
        res.abi
          ? `no function "${req.function}" in this contract's ABI`
          : `this contract has no verified ABI; pass a full signature such as "balanceOf(address) returns (uint256)"`,
      );
    }
    const args = coerceArgs(frag.inputs ?? [], req.args);
    const data = encodeFunctionData({ abi: [frag] as Abi, functionName: frag.name!, args } as never);
    const blockNumber = req.block === undefined || req.block === "latest" ? await r.getBlockNumber() : req.block;
    const out = await r.call({ to: req.address, data, blockNumber });
    const raw = out.data ?? "0x";
    if ((frag.outputs ?? []).length > 0 && raw === "0x") throw new PublicError("the call returned no data (wrong ABI, or not a contract at that block)");
    const decoded = (frag.outputs ?? []).length ? decodeFunctionResult({ abi: [frag] as Abi, functionName: frag.name!, data: raw } as never) : [];
    return { address: req.address, function: frag.name!, signature: fnSig(frag), abiSource: source, block: blockNumber.toString(), result: decodedValues(frag.outputs, decoded) };
  }

  async function relayEligibility(to: Address, valueWei: bigint, gas: bigint | null): Promise<RelayEligibility> {
    if (!deps.relayConfigured()) return { eligible: false, reason: "the gasless relay is not provisioned on this deployment", gas: null };
    const signedGas = gas ? (gas * 13n) / 10n : 300_000n;
    const verdict = deps.relayPolicy({ value: valueWei.toString(), to, gas: signedGas.toString() });
    return verdict.ok ? { eligible: true, reason: null, gas: signedGas.toString() } : { eligible: false, reason: verdict.error, gas: null };
  }

  async function prepareWrite(req: PrepareWriteRequest): Promise<PreparedWrite> {
    if (!ADDRESS_RE.test(req.address)) throw new PublicError("expected a 0x-prefixed 20-byte target address");
    const to = checksum(req.address.toLowerCase()) as Address;
    const from = req.from ? (ADDRESS_RE.test(req.from) ? (checksum(req.from.toLowerCase()) as Address) : null) : null;
    if (req.from && !from) throw new PublicError("expected a 0x-prefixed 20-byte sender address");

    const c = await code(to);
    const isContract = c !== "0x";
    const res = isContract
      ? await resolveAbiWith(to, c)
      : ({ address: to, source: "none", status: "unverified", abi: null, contractName: null, implementation: null, proxy: { isProxy: false, kind: null, implementation: null, admin: null, beacon: null, evidence: [] }, note: "" } satisfies ResolvedAbi);

    let frag = pickFunction(res.abi, req.function);
    let abiSource: AbiSource = res.source;
    if (!frag) {
      frag = fragmentFromSignature(req.function);
      abiSource = "signature";
    }
    if (!frag || !frag.name) {
      throw new PublicError(
        res.abi ? `no function "${req.function}" in this contract's ABI` : `no verified ABI here; pass a full signature such as "transfer(address,uint256)"`,
      );
    }
    if (frag.stateMutability === "view" || frag.stateMutability === "pure") {
      throw new PublicError(`${frag.name} is read-only (${frag.stateMutability}); use contract_read instead`);
    }
    const payable = frag.stateMutability === "payable";

    let valueWei: bigint;
    try {
      valueWei = parseEther(req.value && req.value.trim() !== "" ? req.value.trim() : "0");
    } catch {
      throw new PublicError(`value must be a decimal SALT amount, got "${req.value}"`);
    }
    if (valueWei < 0n) throw new PublicError("value cannot be negative");
    if (valueWei > 0n && !payable) throw new PublicError(`${frag.name} is not payable, so it cannot be sent SALT`);

    const args = coerceArgs(frag.inputs ?? [], req.args ?? []);
    const data = encodeFunctionData({ abi: [frag] as Abi, functionName: frag.name, args } as never);

    // Simulate from the sender against the current head.
    const blockNumber = await r.getBlockNumber().catch(() => null);
    let ok = false;
    let reason: string | null = null;
    try {
      await r.call({ account: from ?? undefined, to, data, value: valueWei, blockNumber: blockNumber ?? undefined });
      ok = true;
    } catch (e) {
      reason = revertReason(e, res.abi);
    }
    let gasEstimate: bigint | null = null;
    if (ok) gasEstimate = await r.estimateGas({ account: from ?? undefined, to, data, value: valueWei }).catch(() => null);
    const gasPrice = await r.getGasPrice().catch(() => null);
    const simulation: Simulation = {
      ok,
      from,
      revertReason: ok ? null : reason,
      gasEstimate: gasEstimate?.toString() ?? null,
      gasPriceWei: gasPrice?.toString() ?? null,
      feeSalt: gasEstimate !== null && gasPrice !== null ? formatEther(gasEstimate * gasPrice) : null,
      blockNumber: blockNumber?.toString() ?? null,
      simulatedAt: deps.now().toISOString(),
    };

    const risk = assessRisk({
      functionName: frag.name,
      selector: data.slice(0, 10),
      args,
      valueWei,
      target: { isContract, verification: abiSource === "signature" ? (res.status === "partial-match" ? "partial-match" : "unverified") : res.status, abiSource, proxy: res.proxy },
      simulation,
      thresholdWei: deps.payableThresholdWei(),
    });

    return {
      id: preparedWriteId({ from, to, data, valueWei }),
      chainId: CITRATE_WRITE_CHAIN_ID,
      network: "citrate",
      from,
      target: { address: to, label: deps.label(to), isContract, verification: res.status, contractName: res.contractName, abiSource, proxy: res.proxy },
      call: { function: frag.name, signature: fnSig(frag), selector: data.slice(0, 10) as Hex, stateMutability: payable ? "payable" : "nonpayable", args: decodedValues(frag.inputs, args), data },
      value: { wei: valueWei.toString(), salt: formatEther(valueWei) },
      simulation,
      risk,
      relay: await relayEligibility(to, valueWei, gasEstimate),
      origin: req.origin,
      executable: false,
      createdAt: deps.now().toISOString(),
    };
  }

  return {
    identify,
    resolveAbi: (a) => resolveAbiWith(a),
    detectProxy: (a) => detectProxy(a),
    read,
    decodeCalldata,
    decodeLog,
    prepareWrite,
    decodeWith,
  };
}

/** The module wired to live RPC, the verification store and the relay policy. */
export async function defaultContractModule(): Promise<ContractModule> {
  const [{ harnessClient }, { getVerifiedSource }, { knownLabel, PROJECT_ADDRESSES }, { checkSponsorPolicy }] = await Promise.all([
    import("@/lib/harness/client"),
    import("@/lib/verify/verifiedSource"),
    import("@/lib/citrate/addresses"),
    import("@/lib/relay/policy"),
  ]);
  const client = harnessClient();
  return createContractModule({
    reader: client as unknown as ChainReader,
    verified: (a) => getVerifiedSource(a),
    label: (a) => knownLabel(a),
    relayPolicy: (q) => checkSponsorPolicy(q),
    relayConfigured: () => Boolean(PROJECT_ADDRESSES.forwarder),
    payableThresholdWei: () => payableThresholdWei(),
    now: () => new Date(),
  });
}
