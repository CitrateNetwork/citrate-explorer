/**
 * The contract kit (EXP-S3 + EXP-AGENT): one code path for the contract pages and
 * the explorer agent.
 *
 *   resolveAbi      verified ABI, proxy implementation ABI, or the signature subset
 *   readCall        encode, eth_call, decode (or a decoded revert reason)
 *   prepareWrite    calldata, value, simulation, gas, risk flags -> PreparedWrite
 *   approveWrite    records an explicit user approval (UI gesture only)
 *   executeWrite    sends a PreparedWrite through the user's wallet or the gasless
 *                   relay, and only with a matching, unused approval
 *   detectProxy     re-exported from proxy.ts
 *
 * The kit never holds keys and never signs. Every send goes through a
 * WriteExecutor that asks the user's wallet to sign (eth_sendTransaction, or the
 * EIP-712 ForwardRequest for the relay), so the wallet prompt is a second,
 * independent approval.
 *
 * Data source (Rule 7): the Citrate RPC through a ChainReader, and the
 * verification store through a ContractInfoSource.
 */
import {
  concat,
  encodeAbiParameters,
  keccak256,
  maxUint256,
  numberToHex,
  type Abi,
  type AbiFunction,
  type Address,
  type Hex,
} from "viem";
import { formatValue } from "./abiForm";
import { guessAbi, type AbiGuess } from "./abiGuess";
import {
  decodeCallResult,
  decodeRevert,
  displayOutputs,
  encodeCallData,
  errorText,
  findFunction,
  functionSelector,
  functionSignature,
  revertDataOf,
  type RevertInfo,
} from "./codec";
import { detectProxy, type ProxyInfo } from "./proxy";
import { isSponsorableTarget } from "@/lib/relay/policy";
import type { BlockSelector, ChainReader, ContractInfo, ContractInfoSource } from "./types";

export { detectProxy } from "./proxy";
export type { ProxyInfo } from "./proxy";

/* ------------------------------------------------------------------ ABI */

export type AbiSource =
  | "verified"
  | "partial-match"
  | "similar-match"
  | "proxy-implementation"
  | "signature-subset"
  | "none";

export interface ResolvedAbi {
  address: Address;
  hasCode: boolean;
  runtimeCode: Hex;
  codeHash: Hex | null;
  /** Verified-source facts for the address itself. */
  info: ContractInfo;
  proxy: ProxyInfo | null;
  /** Verified-source facts for the implementation, when this is a proxy. */
  implementationInfo: ContractInfo | null;
  /** The ABI to interact with (the implementation's, through a proxy). */
  abi: Abi;
  abiSource: AbiSource;
  /** True when `abi` comes from a full verified match (own or implementation). */
  abiVerified: boolean;
  /** The bytecode guess, when the ABI came from the signature subset. */
  guess: AbiGuess | null;
}

const usable = (i: ContractInfo | null) => !!i?.abi && (i.status === "verified" || i.status === "partial-match" || i.status === "similar-match");

export async function resolveAbi(opts: { address: string; reader: ChainReader; info: ContractInfoSource }): Promise<ResolvedAbi> {
  const address = opts.address as Address;
  const code = await opts.reader.getCode(address);
  const hasCode = !!code && code !== "0x";
  const [info, proxy] = await Promise.all([opts.info.load(address), hasCode ? detectProxy(opts.reader, address) : Promise.resolve(null)]);
  const base = { address, hasCode, runtimeCode: (code || "0x") as Hex, codeHash: hasCode ? keccak256(code) : null, info, proxy };
  if (!hasCode) return { ...base, implementationInfo: null, abi: [], abiSource: "none", abiVerified: false, guess: null };

  let implementationInfo: ContractInfo | null = null;
  if (proxy) {
    implementationInfo = await opts.info.load(proxy.implementation);
    if (usable(implementationInfo)) {
      return { ...base, implementationInfo, abi: implementationInfo.abi!, abiSource: "proxy-implementation", abiVerified: implementationInfo.verified, guess: null };
    }
  }
  if (usable(info)) {
    const abiSource: AbiSource = info.status === "verified" ? "verified" : (info.status as "partial-match" | "similar-match");
    return { ...base, implementationInfo, abi: info.abi!, abiSource, abiVerified: info.verified, guess: null };
  }
  const guessCode = proxy ? await opts.reader.getCode(proxy.implementation) : code;
  const guess = guessAbi(guessCode);
  return { ...base, implementationInfo, abi: guess.abi, abiSource: guess.abi.length ? "signature-subset" : "none", abiVerified: false, guess };
}

function pickFunction(abi: Abi, fn: string | AbiFunction): AbiFunction {
  const f = typeof fn === "string" ? findFunction(abi, fn) : fn;
  if (!f) throw new Error(`function ${String(fn)} is not in the ABI`);
  return f;
}

/* ------------------------------------------------------------------ reads */

export type ReadResult =
  | { ok: true; function: string; calldata: Hex; raw: Hex; decoded: unknown[]; display: string[] }
  | { ok: false; function: string; calldata: Hex; revert: RevertInfo | null; error: string };

export async function readCall(opts: {
  reader: ChainReader;
  address: string;
  abi: Abi;
  fn: string | AbiFunction;
  args: readonly unknown[];
  block?: BlockSelector;
  from?: Address;
}): Promise<ReadResult> {
  const fn = pickFunction(opts.abi, opts.fn);
  const calldata = encodeCallData(fn, opts.args);
  const sig = functionSignature(fn);
  try {
    const raw = await opts.reader.call({ to: opts.address as Address, data: calldata, from: opts.from, block: opts.block });
    try {
      const decoded = decodeCallResult(fn, raw);
      return { ok: true, function: sig, calldata, raw, decoded, display: displayOutputs(fn, decoded) };
    } catch {
      return { ok: false, function: sig, calldata, revert: null, error: `The call returned ${raw === "0x" ? "no data" : "data"} that does not decode as ${fn.outputs.map((o) => o.type).join(", ") || "()"}.` };
    }
  } catch (e) {
    const data = revertDataOf(e);
    const revert = data ? decodeRevert(data, opts.abi) : null;
    return { ok: false, function: sig, calldata, revert, error: revert ? revert.message : errorText(e) };
  }
}

export type RawCallResult = { ok: true; raw: Hex; words: Hex[] } | { ok: false; revert: RevertInfo | null; error: string };

/**
 * eth_call with caller-supplied calldata, for selectors with no known signature.
 * The result is raw 32-byte words; nothing is decoded or trusted.
 */
export async function rawCall(opts: { reader: ChainReader; address: string; data: Hex; block?: BlockSelector; from?: Address }): Promise<RawCallResult> {
  if (!/^0x([0-9a-fA-F]{2}){4,}$/.test(opts.data)) return { ok: false, revert: null, error: "Calldata must be 0x hex with at least a 4-byte selector." };
  try {
    const raw = await opts.reader.call({ to: opts.address as Address, data: opts.data, from: opts.from, block: opts.block });
    const words = (raw.slice(2).match(/.{1,64}/g) ?? []).map((w) => ("0x" + w) as Hex);
    return { ok: true, raw, words };
  } catch (e) {
    const data = revertDataOf(e);
    const revert = data ? decodeRevert(data, null) : null;
    return { ok: false, revert, error: revert ? revert.message : errorText(e) };
  }
}

/**
 * How far below the tip the historical-state probe reads. 40204 nodes execute
 * behind the tip (about 1,000 blocks on 2026-11-07) and answer for any block above
 * their executed head with executed-head state, so a probe close to the tip
 * proves nothing.
 */
export const HISTORICAL_PROBE_DEPTH = 4096n;

/** Whether the node serves state at a past block (eth_getStorageAt well below the tip). */
export async function supportsHistoricalState(reader: ChainReader, address: string): Promise<{ supported: boolean; reason: string | null }> {
  try {
    const head = await reader.blockNumber();
    await reader.getStorageAt(address as Address, numberToHex(0, { size: 32 }), head > HISTORICAL_PROBE_DEPTH ? head - HISTORICAL_PROBE_DEPTH : 0n);
    return { supported: true, reason: null };
  } catch (e) {
    return { supported: false, reason: errorText(e) };
  }
}

/* ------------------------------------------------------------------ writes */

export type RiskCode =
  | "payable"
  | "value-transfer"
  | "token-approval"
  | "unlimited-approval"
  | "operator-approval"
  | "ownership-transfer"
  | "ownership-renounce"
  | "upgrade"
  | "unverified-target"
  | "guessed-abi"
  | "proxy-target"
  | "simulation-reverted";

export interface RiskFlag {
  code: RiskCode;
  severity: "info" | "warn" | "high";
  message: string;
}

export type SimulationOutcome =
  | { status: "ok"; returnData: Hex }
  | { status: "reverted"; revert: RevertInfo | null; error: string }
  | { status: "skipped"; reason: string };

export interface PreparedWrite {
  /** Unique per preparation; an approval is bound to it. */
  id: Hex;
  chainId: number;
  from: Address | null;
  to: Address;
  data: Hex;
  value: bigint;
  method: { name: string; signature: string; selector: Hex; stateMutability: AbiFunction["stateMutability"] };
  args: { name: string; type: string; value: unknown; display: string }[];
  abiSource: AbiSource;
  simulation: SimulationOutcome;
  gas: { estimate: bigint | null; error: string | null };
  risks: RiskFlag[];
  gasless: { eligible: boolean; reason: string };
  /** ms since epoch. A preparation older than PREPARED_WRITE_TTL_MS must be prepared again. */
  preparedAt: number;
}

/** A simulation is only as fresh as the state it ran on. */
export const PREPARED_WRITE_TTL_MS = 120_000;
/** The gas the explorer's gasless client signs (use-sponsored-write.ts). */
export const GASLESS_GAS = 300_000n;

const HALF_MAX = maxUint256 / 2n;

/** Risk flags for one call. Pure. */
export function riskFlags(input: {
  fn: AbiFunction;
  args: readonly unknown[];
  value: bigint;
  abiSource: AbiSource;
  abiVerified: boolean;
  viaProxy?: boolean;
  simulation?: SimulationOutcome;
}): RiskFlag[] {
  const { fn, args, value } = input;
  const out: RiskFlag[] = [];
  const sig = functionSignature(fn);
  if (fn.stateMutability === "payable") out.push({ code: "payable", severity: "info", message: "This function accepts SALT with the call." });
  if (value > 0n) out.push({ code: "value-transfer", severity: "warn", message: "This call sends SALT from your wallet to the contract." });
  if (sig === "approve(address,uint256)" || sig === "increaseAllowance(address,uint256)") {
    out.push({ code: "token-approval", severity: "warn", message: "This lets another address spend your tokens." });
    const amount = args[1];
    if (typeof amount === "bigint" && amount >= HALF_MAX) out.push({ code: "unlimited-approval", severity: "high", message: "The approval amount is effectively unlimited." });
  }
  if (sig === "setApprovalForAll(address,bool)" && args[1] === true) {
    out.push({ code: "operator-approval", severity: "high", message: "This lets another address move ALL of your tokens in this collection." });
  }
  if (sig === "transferOwnership(address)" || sig === "changeAdmin(address)") {
    out.push({ code: "ownership-transfer", severity: "high", message: "This hands control of the contract to another address." });
  }
  if (sig === "renounceOwnership()") out.push({ code: "ownership-renounce", severity: "high", message: "This removes the owner permanently. It cannot be undone." });
  if (sig === "upgradeTo(address)" || sig === "upgradeToAndCall(address,bytes)") {
    out.push({ code: "upgrade", severity: "high", message: "This replaces the contract's code with a new implementation." });
  }
  if (!input.abiVerified) out.push({ code: "unverified-target", severity: "warn", message: "The contract's source is not verified, so what this call does cannot be checked." });
  if (input.abiSource === "signature-subset") out.push({ code: "guessed-abi", severity: "warn", message: "The function was identified from its selector only; argument meaning is a guess." });
  if (input.viaProxy) out.push({ code: "proxy-target", severity: "info", message: "The call goes through a proxy to its current implementation." });
  if (input.simulation?.status === "reverted") {
    out.push({ code: "simulation-reverted", severity: "high", message: `The simulation reverted: ${input.simulation.revert?.message ?? input.simulation.error}` });
  }
  return out;
}

function randomHex(bytes: number): Hex {
  const b = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(b);
  return ("0x" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")) as Hex;
}

const IS_TRUSTED_FORWARDER: Hex = "0x572b6c05";

async function gaslessEligibility(
  reader: ChainReader,
  to: Address,
  value: bigint,
  gas: bigint | null,
  from: Address | null,
  forwarder: Address | null | undefined,
): Promise<{ eligible: boolean; reason: string }> {
  if (!forwarder) return { eligible: false, reason: "The gasless forwarder is not deployed on this network yet." };
  if (!from) return { eligible: false, reason: "Connect a wallet to sign a gasless request." };
  if (value !== 0n) return { eligible: false, reason: "The gasless relay does not sponsor calls that send SALT." };
  if (!isSponsorableTarget(to)) return { eligible: false, reason: "The gasless relay only sponsors calls to Citrate federation contracts." };
  if (gas !== null && gas > GASLESS_GAS) return { eligible: false, reason: `The call needs more gas than the relay sponsors (${GASLESS_GAS}).` };
  try {
    const ret = await reader.call({ to, data: concat([IS_TRUSTED_FORWARDER, encodeAbiParameters([{ type: "address" }], [forwarder])]) });
    if (BigInt(ret.slice(0, 66) || "0x0") !== 1n) throw new Error("not trusted");
  } catch {
    return { eligible: false, reason: "This contract does not accept the Citrate forwarder (ERC-2771), so a relayed call would not come from your address." };
  }
  return { eligible: true, reason: "The Citrate Foundation relayer pays the gas. You sign a typed request in your wallet." };
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

export async function prepareWrite(opts: {
  reader: ChainReader;
  address: string;
  abi: Abi;
  abiSource: AbiSource;
  /** Defaults to abiSource being "verified" or "proxy-implementation". */
  abiVerified?: boolean;
  fn: string | AbiFunction;
  args: readonly unknown[];
  value?: bigint;
  from?: Address | null;
  viaProxy?: boolean;
  /** The EIP-2771 forwarder, when gasless writes are configured (PROJECT_ADDRESSES.forwarder). */
  forwarder?: Address | null;
  now?: () => number;
}): Promise<PreparedWrite> {
  const fn = pickFunction(opts.abi, opts.fn);
  const value = opts.value ?? 0n;
  if (value < 0n) throw new Error("value cannot be negative");
  if (value > 0n && fn.stateMutability !== "payable") throw new Error(`${fn.name} is not payable; it cannot receive SALT`);
  if (fn.stateMutability === "view" || fn.stateMutability === "pure") throw new Error(`${fn.name} is a read-only function; use readCall`);
  const to = opts.address as Address;
  const from = opts.from ?? null;
  const data = encodeCallData(fn, opts.args);

  let simulation: SimulationOutcome;
  try {
    const returnData = await opts.reader.call({ to, data, value, from: from ?? undefined });
    simulation = { status: "ok", returnData };
  } catch (e) {
    const rd = revertDataOf(e);
    const revert = rd ? decodeRevert(rd, opts.abi) : null;
    simulation = { status: "reverted", revert, error: revert ? revert.message : errorText(e) };
  }
  let gas: PreparedWrite["gas"];
  if (simulation.status === "reverted") gas = { estimate: null, error: "Not estimated: the simulation reverted." };
  else {
    try {
      gas = { estimate: await opts.reader.estimateGas({ to, data, value, from: from ?? undefined }), error: null };
    } catch (e) {
      gas = { estimate: null, error: errorText(e) };
    }
  }
  const abiVerified = opts.abiVerified ?? (opts.abiSource === "verified" || opts.abiSource === "proxy-implementation");
  const risks = riskFlags({ fn, args: opts.args, value, abiSource: opts.abiSource, abiVerified, viaProxy: opts.viaProxy, simulation });
  const gasless = simulation.status === "reverted"
    ? { eligible: false, reason: "Not offered: the simulation reverted." }
    : await gaslessEligibility(opts.reader, to, value, gas.estimate, from, opts.forwarder);
  const preparedAt = (opts.now ?? Date.now)();
  const id = keccak256(
    concat([
      encodeAbiParameters(
        [{ type: "uint256" }, { type: "address" }, { type: "bytes" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }],
        [BigInt(opts.reader.chainId), to, data, value, from ?? "0x0000000000000000000000000000000000000000", BigInt(preparedAt)],
      ),
      randomHex(16),
    ]),
  );
  return deepFreeze({
    id,
    chainId: opts.reader.chainId,
    from,
    to,
    data,
    value,
    method: { name: fn.name, signature: functionSignature(fn), selector: functionSelector(fn), stateMutability: fn.stateMutability },
    args: fn.inputs.map((p, i) => ({ name: p.name ?? `arg${i}`, type: p.type, value: opts.args[i], display: formatValue(p, opts.args[i]) })),
    abiSource: opts.abiSource,
    simulation,
    gas,
    risks,
    gasless,
    preparedAt,
  });
}

/* ------------------------------------------------------------------ approval + execution */

export type WritePath = "wallet" | "gasless";

export interface WriteApproval {
  readonly preparedId: Hex;
  readonly path: WritePath;
  readonly acknowledged: readonly RiskCode[];
  readonly approvedAt: number;
}

/** Sends an approved write. The UI builds these from the user's wallet; the kit never signs. */
export interface WriteExecutor {
  readonly path: WritePath;
  send(prepared: PreparedWrite): Promise<Hex>;
}

export interface ApprovalEnv {
  /** True only while a real user gesture is active (navigator.userActivation.isActive). */
  hasUserActivation(): boolean;
}

const browserEnv: ApprovalEnv = {
  hasUserActivation: () => {
    const ua = (globalThis.navigator as (Navigator & { userActivation?: { isActive: boolean } }) | undefined)?.userActivation;
    return ua?.isActive === true;
  },
};

const issued = new WeakSet<WriteApproval>();
const used = new WeakSet<WriteApproval>();

/**
 * Record the user's approval of a PreparedWrite. Call it only from the approval
 * dialog's click handler: it refuses outside a user gesture, and every
 * high-severity risk must be in `acknowledged` (the dialog's checkboxes).
 */
export function approveWrite(
  prepared: PreparedWrite,
  choice: { path: WritePath; acknowledged: readonly RiskCode[] },
  env: ApprovalEnv = browserEnv,
): WriteApproval {
  if (!env.hasUserActivation()) throw new Error("A write can only be approved from a user gesture in the approval dialog.");
  const missing = prepared.risks.filter((r) => r.severity === "high" && !choice.acknowledged.includes(r.code)).map((r) => r.code);
  if (missing.length) throw new Error(`Acknowledge these risks before approving: ${missing.join(", ")}`);
  const a: WriteApproval = Object.freeze({ preparedId: prepared.id, path: choice.path, acknowledged: Object.freeze([...choice.acknowledged]), approvedAt: Date.now() });
  issued.add(a);
  return a;
}

/** Send a PreparedWrite. Requires an approval from approveWrite for this exact preparation; each approval works once. */
export async function executeWrite(
  prepared: PreparedWrite,
  approval: WriteApproval,
  executor: WriteExecutor,
  opts: { now?: () => number } = {},
): Promise<Hex> {
  if (!approval || !issued.has(approval)) throw new Error("An explicit user approval (approveWrite) is required before sending.");
  if (approval.preparedId !== prepared.id) throw new Error("This approval does not match the prepared write.");
  if (used.has(approval)) throw new Error("This approval was already used. Prepare and approve again.");
  if (approval.path !== executor.path) throw new Error(`The approval is for the ${approval.path} path, not ${executor.path}.`);
  if ((opts.now ?? Date.now)() - prepared.preparedAt > PREPARED_WRITE_TTL_MS) throw new Error("The prepared write is stale. Prepare it again so the simulation is current.");
  if (executor.path === "gasless" && !prepared.gasless.eligible) throw new Error(`The gasless relay cannot send this call: ${prepared.gasless.reason}`);
  const missing = prepared.risks.filter((r) => r.severity === "high" && !approval.acknowledged.includes(r.code));
  if (missing.length) throw new Error(`Unacknowledged risks: ${missing.map((r) => r.code).join(", ")}`);
  used.add(approval);
  return executor.send(prepared);
}
