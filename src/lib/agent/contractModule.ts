/**
 * The agent's `ContractModule` (src/lib/contracts/types.ts), as an ADAPTER over
 * the contract kit (src/lib/contract/). There is one implementation of ABI
 * resolution, proxy detection, reads, write preparation, simulation, gas,
 * gasless eligibility and the risk assessment: the kit's. This file only
 *   - feeds the kit a server ChainReader and the verification store,
 *   - turns the agent's loosely-typed arguments into ABI values
 *     (src/lib/contract/request.ts, shared with the approval dialog), and
 *   - maps the kit's results to the JSON-safe shapes the chat/MCP tools return
 *     (the wire `PreparedWrite`, always `executable: false`).
 *
 * Interface identification (ERC-165 probes, the ERC-20 heuristic) and decoding of
 * calldata and logs for explanations are agent features with no kit equivalent;
 * they read through the same kit reader and the kit-resolved ABI.
 *
 * Data sources (Rule 11):
 *   - live Citrate RPC through the kit's read-only reader (createRpcReader over
 *     the harness client): eth_getCode, eth_getStorageAt, eth_call,
 *     eth_estimateGas, eth_blockNumber; eth_gasPrice for the fee estimate;
 *   - verified ABIs from the `contract_verifications` table via getVerifiedSource
 *     (createStoreInfoSource);
 *   - the relay sponsor policy and the forwarder (kit gasless eligibility).
 * No signer is reachable from here: the reader has no account and no send method.
 */
import {
  decodeEventLog,
  decodeFunctionData,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress as checksum,
  parseAbi,
  toEventSignature,
  toFunctionSelector,
  type Abi,
  type AbiEvent,
  type AbiFunction,
} from "viem";
import { PublicError } from "@/lib/api/errors";
import {
  type AbiItem,
  type AbiSource,
  type Address,
  type ContractIdentity,
  type ContractModule,
  type ContractReadResult,
  type DecodedCall,
  type DecodedLog,
  type Hex,
  type InterfaceSupport,
  type PreparedWrite,
  type PrepareWriteRequest,
  type ProxyInfo,
  type ResolvedAbi,
  type VerificationStatus,
} from "@/lib/contracts/types";
import { detectProxy as kitDetectProxy, readCall, resolveAbi as kitResolveAbi, type ResolvedAbi as KitResolvedAbi } from "@/lib/contract/kit";
import { EIP1822_PROXIABLE_SLOT, EIP1967_ADMIN_SLOT, EIP1967_BEACON_SLOT, EIP1967_IMPLEMENTATION_SLOT } from "@/lib/contract/proxy";
import { createStoreInfoSource } from "@/lib/contract/infoSources";
import type { VerifiedSource } from "@/lib/verify/verifiedSource";
import { coerceArgs, decodedValues, fragmentFromSignature, pickFunction as pickKitFunction, prepareFromRequest, verificationOf } from "@/lib/contract/request";
import { payableThresholdWei } from "@/lib/contract/risk";
import type { ChainReader, ContractInfoSource } from "@/lib/contract/types";

import { NO_PROXY, toWirePrepared, wireAbiSource, wireProxy, wireVerification } from "./wire";

export { coerceArg, coerceArgs, decodedValues, fragmentFromSignature, jsonValue } from "@/lib/contract/request";
// Kit → wire mapping lives in ./wire.ts (pure; the approval dialog uses it too).
export { preparedWriteId, toWirePrepared, wireAbiSource, wireProxy } from "./wire";

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface ContractModuleDeps {
  /** The kit's read-only chain access (no account, no send). */
  reader: ChainReader;
  /** The verification store's record for an address (getVerifiedSource). */
  verified: (address: string) => Promise<VerifiedSource>;
  label: (address: string) => string | null;
  /** The EIP-2771 forwarder for gasless writes (PROJECT_ADDRESSES.forwarder); null when not provisioned. */
  forwarder: () => Address | null;
  /** eth_gasPrice, for the fee shown next to the gas estimate. Null when unknown. */
  gasPrice: () => Promise<bigint | null>;
  payableThresholdWei: () => bigint;
  now: () => Date;
}

/** EIP-1967 storage slots and the EIP-1822 PROXIABLE slot (the kit's constants). */
export const PROXY_SLOTS = {
  implementation: EIP1967_IMPLEMENTATION_SLOT,
  admin: EIP1967_ADMIN_SLOT,
  beacon: EIP1967_BEACON_SLOT,
  eip1822: EIP1822_PROXIABLE_SLOT,
} as const;

const ZERO = "0x0000000000000000000000000000000000000000";
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

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
// The module
// ---------------------------------------------------------------------------

const SUPPORTS = parseAbi(["function supportsInterface(bytes4) view returns (bool)"]);
const ERC20_PROBES = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
]);

const asAbi = (a: Abi): AbiItem[] => a as unknown as AbiItem[];

/** Pick a function from an agent ABI by name or signature (overloads need the signature). */
export function pickFunction(abi: AbiItem[] | null, ref: string): AbiItem | null {
  return (pickKitFunction(abi as unknown as Abi | null, ref) as unknown as AbiItem | null) ?? null;
}

export function createContractModule(deps: ContractModuleDeps): ContractModule & {
  decodeWith(abi: AbiItem[] | null, data: Hex): DecodedCall | null;
} {
  const r = deps.reader;
  const info: ContractInfoSource = createStoreInfoSource((a) => deps.verified(a));

  const tryCall = async (to: Address, data: Hex): Promise<Hex | null> => {
    try {
      const res = await r.call({ to, data });
      return res && res !== "0x" ? res : null;
    } catch {
      return null;
    }
  };

  const resolveKit = (address: Address) => kitResolveAbi({ address, reader: r, info });

  /** The kit's resolution in the agent's shape. A selector-only guess is reported as "no ABI". */
  function wireResolved(k: KitResolvedAbi): ResolvedAbi {
    const source = wireAbiSource(k.abiSource);
    const status: VerificationStatus = k.hasCode ? wireVerification(verificationOf(k)) : "unverified";
    const proxy = wireProxy(k.proxy);
    if (source === "none") {
      return {
        address: k.address,
        source,
        status,
        abi: null,
        contractName: null,
        implementation: k.proxy?.implementation ?? null,
        proxy,
        note: !k.hasCode
          ? "No contract code at this address."
          : status === "unavailable"
            ? "The verification store is unavailable, so no ABI could be loaded. Pass a full function signature to read or prepare a call."
            : "Not verified: no ABI. Pass a full function signature to read or prepare a call; nothing confirms what the function does.",
      };
    }
    const own = k.abiSource === "proxy-implementation" ? k.implementationInfo : k.info;
    // Behind a proxy, the proxy's own functions (if it has a verified ABI) are kept too.
    const extra = k.abiSource === "proxy-implementation" && k.info.abi ? asAbi(k.info.abi).filter((x) => x.type !== "constructor") : [];
    return {
      address: k.address,
      source,
      status,
      abi: [...asAbi(k.abi), ...extra],
      contractName: own?.contractName ?? null,
      implementation: k.abiSource === "proxy-implementation" ? (k.proxy?.implementation ?? null) : null,
      proxy,
      note:
        k.abiSource === "proxy-implementation"
          ? `Proxy (${k.proxy?.kind}); decoded with the ${status === "verified" ? "verified" : "partially matched"} implementation ${k.proxy?.implementation}.`
          : (own?.note ?? ""),
    };
  }

  async function resolveAbi(address: Address): Promise<ResolvedAbi> {
    return wireResolved(await resolveKit(address));
  }

  async function detectProxy(address: Address): Promise<ProxyInfo> {
    return wireProxy(await kitDetectProxy(r, address));
  }

  function decodeWith(abi: AbiItem[] | null, data: Hex): DecodedCall | null {
    if (!abi) return null;
    try {
      const d = decodeFunctionData({ abi: abi as unknown as Abi, data });
      const frag = abi.find((f) => f.type === "function" && f.name === d.functionName && toFunctionSelector(f as never) === data.slice(0, 10).toLowerCase());
      if (!frag) return null;
      return { selector: data.slice(0, 10) as Hex, decodedWith: "", function: d.functionName, signature: toFunctionSelectorSig(frag), args: decodedValues((frag.inputs ?? []) as never, d.args ?? []), note: "" };
    } catch {
      return null;
    }
  }

  async function decodeCalldata(req: { data: Hex; address?: Address }): Promise<DecodedCall> {
    const selector = (req.data.length >= 10 ? req.data.slice(0, 10) : req.data) as Hex;
    if (req.data.length < 10) return { selector, decodedWith: "unknown", function: null, signature: null, args: [], note: "Calldata shorter than a 4-byte selector (a plain value transfer or fallback call)." };
    if (req.address) {
      const res = await resolveAbi(req.address);
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
        const d = decodeEventLog({ abi: abi as unknown as Abi, topics: req.topics as [Hex, ...Hex[]], data: req.data });
        const frag = abi.find((x) => x.type === "event" && x.name === d.eventName);
        if (!frag) return null;
        const args = d.args as unknown;
        const list = Array.isArray(args) ? args : (frag.inputs ?? []).map((p, i) => (args as Record<string, unknown>)[p.name ?? String(i)]);
        return { event: d.eventName ?? null, signature: toEventSignature(frag as unknown as AbiEvent), args: decodedValues((frag.inputs ?? []) as never, list) };
      } catch {
        return null;
      }
    };
    const res = await resolveAbi(req.address);
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
    const k = await resolveKit(address);
    if (!k.hasCode) {
      return {
        address,
        isContract: false,
        codeSize: 0,
        codeHash: null,
        label: deps.label(address),
        verification: { status: "unverified", contractName: null, compilerVersion: null },
        proxy: NO_PROXY,
        interfaces: { erc165: false, erc721: false, erc1155: false, erc20Heuristic: false, method: ["no code"] },
        token: null,
        note: "Externally-owned account (EOA): no contract code.",
      };
    }
    const ifs = await interfaces(address);
    const proxy = wireProxy(k.proxy);
    return {
      address,
      isContract: true,
      codeSize: (k.runtimeCode.length - 2) / 2,
      codeHash: k.codeHash,
      label: deps.label(address),
      verification: { status: wireVerification(k.info.status), contractName: k.info.contractName, compilerVersion: k.info.compilerVersion },
      proxy,
      interfaces: ifs.support,
      token: ifs.token,
      note: proxy.isProxy ? `Proxy (${proxy.kind}) to ${proxy.implementation ?? "an unreadable implementation"}. ${k.info.note}` : k.info.note,
    };
  }

  async function read(req: { address: Address; function: string; args: unknown[]; block?: bigint | "latest" }): Promise<ContractReadResult> {
    const res = await resolveAbi(req.address);
    let frag = pickFunction(res.abi, req.function) as unknown as AbiFunction | null;
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
    const args = coerceArgs(frag.inputs, req.args);
    const blockNumber = req.block === undefined || req.block === "latest" ? await r.blockNumber() : req.block;
    const out = await readCall({ reader: r, address: req.address, abi: (res.abi as unknown as Abi | null) ?? [frag], fn: frag, args, block: req.block === undefined || req.block === "latest" ? "latest" : req.block });
    if (!out.ok) {
      if ((frag.outputs ?? []).length > 0 && /no data/.test(out.error)) throw new PublicError("the call returned no data (wrong ABI, or not a contract at that block)");
      throw new PublicError(out.revert ? `the call reverted: ${out.revert.message}` : "the call failed");
    }
    return { address: req.address, function: frag.name, signature: out.function, abiSource: source, block: blockNumber.toString(), result: decodedValues(frag.outputs, frag.outputs.length === 1 ? out.decoded[0] : out.decoded) };
  }

  async function prepareWrite(req: PrepareWriteRequest): Promise<PreparedWrite> {
    if (!ADDRESS_RE.test(req.address)) throw new PublicError("expected a 0x-prefixed 20-byte target address");
    if (req.from && !ADDRESS_RE.test(req.from)) throw new PublicError("expected a 0x-prefixed 20-byte sender address");
    const from = req.from ? (checksum(req.from.toLowerCase()) as Address) : null;
    // The same preparation the approval dialog and the contract page run (kit).
    const { prepared, resolved, fn } = await prepareFromRequest({
      reader: r,
      info,
      request: { address: req.address, function: req.function, args: req.args ?? [], value: req.value },
      from,
      forwarder: deps.forwarder(),
      payableThresholdWei: deps.payableThresholdWei(),
      now: () => deps.now().getTime(),
    });
    const [gasPriceWei, blockNumber] = await Promise.all([deps.gasPrice().catch(() => null), r.blockNumber().catch(() => null)]);
    return toWirePrepared(prepared, { resolved, fn, label: deps.label(prepared.to), origin: req.origin, gasPriceWei, blockNumber, now: deps.now() });
  }

  return {
    identify,
    resolveAbi,
    detectProxy,
    read,
    decodeCalldata,
    decodeLog,
    prepareWrite,
    decodeWith,
  };
}

function toFunctionSelectorSig(f: AbiItem): string {
  return `${f.name}(${(f.inputs ?? []).map(canonicalType).join(",")})`;
}
function canonicalType(p: { type: string; components?: readonly { type: string; components?: unknown }[] }): string {
  if (p.type.startsWith("tuple")) return `(${(p.components ?? []).map((c) => canonicalType(c as never)).join(",")})${p.type.slice(5)}`;
  return p.type;
}

/** The module wired to live RPC (kit reader), the verification store and the relay policy. */
export async function defaultContractModule(): Promise<ContractModule> {
  const [{ harnessClient }, { getVerifiedSource }, { knownLabel, PROJECT_ADDRESSES }, { createRpcReader }] = await Promise.all([
    import("@/lib/harness/client"),
    import("@/lib/verify/verifiedSource"),
    import("@/lib/citrate/addresses"),
    import("@/lib/contract/rpcReader"),
  ]);
  const client = harnessClient();
  return createContractModule({
    reader: createRpcReader(client),
    verified: (a) => getVerifiedSource(a),
    label: (a) => knownLabel(a),
    forwarder: () => (PROJECT_ADDRESSES.forwarder as Address | undefined) ?? null,
    gasPrice: () => client.getGasPrice(),
    payableThresholdWei: () => payableThresholdWei(),
    now: () => new Date(),
  });
}
