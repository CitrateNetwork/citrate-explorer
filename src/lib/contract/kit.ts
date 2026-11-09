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
import { assessRisk, payableThresholdWei, type RiskCode, type RiskFlag } from "./risk";
import { isSponsorableTarget } from "@/lib/relay/policy";
import type { BlockSelector, ChainReader, ContractInfo, ContractInfoSource, VerificationStatus } from "./types";

export { detectProxy } from "./proxy";
export type { ProxyInfo } from "./proxy";
export type { RiskCode, RiskFlag, RiskSeverity } from "./risk";
export { assessRisk, payableThresholdWei } from "./risk";

/* ------------------------------------------------------------------ ABI */

export type AbiSource =
  | "verified"
  | "partial-match"
  | "similar-match"
  | "proxy-implementation"
  | "signature-subset"
  /** built from a function signature the caller supplied (the agent); nothing verified it */
  | "signature"
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

export type SimulationOutcome =
  | { status: "ok"; returnData: Hex }
  | { status: "reverted"; revert: RevertInfo | null; error: string }
  /** The simulation could not run (RPC unreachable, not a revert): the outcome is unknown. */
  | { status: "unavailable"; error: string }
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
  /** What is known about the target when it was prepared. */
  target: { isContract: boolean; verification: VerificationStatus; proxy: ProxyInfo | null };
  simulation: SimulationOutcome;
  gas: { estimate: bigint | null; error: string | null };
  risks: RiskFlag[];
  /** True when any risk is high: approval then needs every high risk acknowledged AND the typed confirmation. */
  elevated: boolean;
  /** What the user types to confirm an elevated write (the function name); null when not elevated. */
  confirmPhrase: string | null;
  gasless: { eligible: boolean; reason: string };
  /** ms since epoch. A preparation older than PREPARED_WRITE_TTL_MS must be prepared again. */
  preparedAt: number;
  /** Always false: a PreparedWrite is a proposal. Only approveWrite (a user click) + executeWrite sends it. */
  executable: false;
}

/** A simulation is only as fresh as the state it ran on. */
export const PREPARED_WRITE_TTL_MS = 120_000;
/** The gas the explorer's gasless client signs (use-sponsored-write.ts). */
export const GASLESS_GAS = 300_000n;

/** Map a simulation outcome to the risk input's shape. */
function simulationForRisk(sim: SimulationOutcome | undefined, from: Address | null): { ok: boolean; from: string | null; revertReason: string | null } {
  if (!sim || sim.status === "ok" || sim.status === "skipped") return { ok: true, from, revertReason: null };
  if (sim.status === "reverted") return { ok: false, from, revertReason: sim.revert?.message ?? sim.error };
  return { ok: false, from, revertReason: null };
}

/**
 * Risk flags for one call: the shared assessment in risk.ts, fed with the kit's
 * facts. Pure. `verification` defaults from `abiVerified`; `hasCode` defaults to
 * true (the kit is only handed calls against code it resolved).
 */
export function riskFlags(input: {
  fn: AbiFunction;
  args: readonly unknown[];
  value: bigint;
  abiSource: AbiSource;
  abiVerified: boolean;
  viaProxy?: boolean;
  proxy?: ProxyInfo | null;
  simulation?: SimulationOutcome;
  verification?: VerificationStatus;
  hasCode?: boolean;
  from?: Address | null;
  thresholdWei?: bigint;
}): RiskFlag[] {
  return assessWrite(input).flags;
}

function assessWrite(input: Parameters<typeof riskFlags>[0]) {
  const { fn } = input;
  const proxy = input.proxy ?? null;
  return assessRisk({
    functionName: fn.name,
    selector: functionSelector(fn),
    stateMutability: fn.stateMutability,
    args: input.args,
    valueWei: input.value,
    target: {
      isContract: input.hasCode ?? true,
      verification: input.verification ?? (input.abiVerified ? "verified" : "unverified"),
      abiSource: input.abiSource,
      proxy: { isProxy: !!(proxy || input.viaProxy), kind: proxy?.kind ?? null, implementation: proxy?.implementation ?? null },
    },
    // `from` undefined = the caller did not say (pure risk check): do not flag a missing sender.
    simulation: { ...simulationForRisk(input.simulation, input.from === undefined ? ("0x" as Address) : input.from) },
    thresholdWei: input.thresholdWei ?? payableThresholdWei(),
  });
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
  if (value !== 0n) return { eligible: false, reason: "The gasless relay does not sponsor calls that send SALT (the value must be 0)." };
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
  /** The target's verification status (from resolveAbi's info). Defaults from abiVerified. */
  verification?: VerificationStatus;
  /** Whether the target has code (resolveAbi's hasCode). Defaults to true. */
  hasCode?: boolean;
  /** The proxy the call goes through, when known (resolveAbi's proxy). */
  proxy?: ProxyInfo | null;
  /** Payable value above this is a high risk. Defaults to AGENT_PAYABLE_WARN_SALT or 1 SALT. */
  payableThresholdWei?: bigint;
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
    simulation = revert || mentionsRevert(e)
      ? { status: "reverted", revert, error: revert ? revert.message : errorText(e) }
      : { status: "unavailable", error: errorText(e) };
  }
  let gas: PreparedWrite["gas"];
  if (simulation.status === "reverted") gas = { estimate: null, error: "Not estimated: the simulation reverted." };
  else if (simulation.status === "unavailable") gas = { estimate: null, error: "Not estimated: the simulation could not run." };
  else {
    try {
      gas = { estimate: await opts.reader.estimateGas({ to, data, value, from: from ?? undefined }), error: null };
    } catch (e) {
      gas = { estimate: null, error: errorText(e) };
    }
  }
  const abiVerified = opts.abiVerified ?? (opts.abiSource === "verified" || opts.abiSource === "proxy-implementation");
  const verification: VerificationStatus = opts.verification ?? (abiVerified ? "verified" : "unverified");
  const hasCode = opts.hasCode ?? true;
  const risk = assessWrite({
    fn,
    args: opts.args,
    value,
    abiSource: opts.abiSource,
    abiVerified,
    viaProxy: opts.viaProxy,
    proxy: opts.proxy ?? null,
    simulation,
    verification,
    hasCode,
    from,
    thresholdWei: opts.payableThresholdWei,
  });
  const gasless = simulation.status === "reverted" || simulation.status === "unavailable"
    ? { eligible: false, reason: `Not offered: the simulation ${simulation.status === "reverted" ? "reverted" : "could not run"}.` }
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
    target: { isContract: hasCode, verification, proxy: opts.proxy ?? null },
    simulation,
    gas,
    risks: risk.flags,
    elevated: risk.elevated,
    confirmPhrase: risk.confirmPhrase,
    gasless,
    preparedAt,
    executable: false as const,
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
  choice: { path: WritePath; acknowledged: readonly RiskCode[]; confirmation?: string },
  env: ApprovalEnv = browserEnv,
): WriteApproval {
  if (!env.hasUserActivation()) throw new Error("A write can only be approved from a user gesture in the approval dialog.");
  if ((prepared as { executable?: unknown }).executable !== false) throw new Error("This is not a prepared write the kit produced.");
  const missing = prepared.risks.filter((r) => r.severity === "high" && !choice.acknowledged.includes(r.code)).map((r) => r.code);
  if (missing.length) throw new Error(`Acknowledge these risks before approving: ${missing.join(", ")}`);
  if (prepared.elevated && (choice.confirmation ?? "").trim() !== (prepared.confirmPhrase ?? "")) {
    throw new Error(`This call is flagged: type "${prepared.confirmPhrase}" to confirm.`);
  }
  const a: WriteApproval = Object.freeze({ preparedId: prepared.id, path: choice.path, acknowledged: Object.freeze([...choice.acknowledged]), approvedAt: Date.now() });
  issued.add(a);
  return a;
}

function mentionsRevert(err: unknown): boolean {
  let e: unknown = err;
  for (let depth = 0; e && typeof e === "object" && depth < 8; depth++) {
    const o = e as { shortMessage?: unknown; message?: unknown; details?: unknown; cause?: unknown };
    const m = [o.shortMessage, o.message, o.details].filter((x) => typeof x === "string").join(" ");
    if (/revert|out of gas|invalid opcode/i.test(m)) return true;
    e = o.cause;
  }
  return false;
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
