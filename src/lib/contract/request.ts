/**
 * A write REQUEST (target, function name or signature, loosely-typed args, value
 * in SALT) turned into the kit's PreparedWrite. This is the single preparation
 * path for every write the explorer can make:
 *
 *   - the contract page's Write tab (typed args from the ABI form),
 *   - the approval dialog opened from a chat "Prepared transaction" card or an
 *     MCP `#/approve/<request>` link (it re-prepares in the browser from the
 *     connected wallet),
 *   - the agent's `prepare_write` tool and POST /api/agent/prepare (server).
 *
 * All of them go through `prepareFromRequest` → kit `resolveAbi` + kit
 * `prepareWrite`, so ABI resolution, simulation, gas, gasless eligibility and the
 * risk assessment are one code path. Only `approveWrite` (a user click in the
 * dialog) and `executeWrite` can send the result; nothing here signs.
 *
 * Data sources (Rule 7): the Citrate RPC through a ChainReader and the
 * verification store through a ContractInfoSource.
 */
import { getAddress, parseAbiItem, parseEther, type Abi, type AbiFunction, type AbiParameter, type Address } from "viem";
import { PublicError } from "@/lib/api/errors";
import { functionSignature } from "./codec";
import { prepareWrite, resolveAbi, type AbiSource, type PreparedWrite, type ResolvedAbi } from "./kit";
import type { ChainReader, ContractInfoSource, VerificationStatus } from "./types";

export interface WriteRequestInput {
  address: string;
  /** A function name, or a full signature such as "transfer(address,uint256)". */
  function: string;
  /** Decimal strings, numbers, booleans, hex, arrays/tuples (or JSON text for them), or already-typed values. */
  args: readonly unknown[];
  /** Native value in SALT, decimal ("0.5"). */
  value?: string;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

// ---------------------------------------------------------------------------
// Function lookup
// ---------------------------------------------------------------------------

const fns = (abi: Abi) => abi.filter((x): x is AbiFunction => x.type === "function" && !!x.name);

/** Pick one function by name or full signature. Throws a caller-facing error on ambiguity. */
export function pickFunction(abi: Abi | null, ref: string): AbiFunction | null {
  if (!abi) return null;
  const want = ref.trim().replace(/^function\s+/, "");
  const list = fns(abi);
  if (want.includes("(")) {
    const norm = want.replace(/\s+/g, "").replace(/\)(view|pure|payable|nonpayable|returns.*)$/i, ")");
    const exact = list.find((f) => functionSignature(f) === norm);
    if (exact) return exact;
    const parsed = fragmentFromSignature(want);
    return parsed ? (list.find((f) => functionSignature(f) === functionSignature(parsed)) ?? null) : null;
  }
  const byName = list.filter((f) => f.name === want);
  if (byName.length > 1) throw new PublicError(`"${want}" is overloaded; pass one of: ${byName.map(functionSignature).join(", ")}`);
  return byName[0] ?? null;
}

/** Parse a caller-supplied function signature into an ABI function (no verified ABI). */
export function fragmentFromSignature(ref: string): AbiFunction | null {
  const s = ref.trim();
  if (!s.includes("(")) return null;
  try {
    const item = parseAbiItem((s.startsWith("function ") ? s : `function ${s}`) as never) as unknown as AbiFunction;
    return item.type === "function" ? item : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Argument coercion and JSON-safe decoding
// ---------------------------------------------------------------------------

type Param = Pick<AbiParameter, "name" | "type"> & { components?: readonly Param[] };

function fail(param: Param, why: string): never {
  throw new PublicError(`argument ${param.name || "(unnamed)"} (${param.type}): ${why}`);
}

export function coerceArg(param: Param, v: unknown): unknown {
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
    if (typeof v === "string" && ADDRESS_RE.test(v)) return getAddress(v.toLowerCase());
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

export function coerceArgs(inputs: readonly Param[], args: readonly unknown[]): unknown[] {
  if (args.length !== inputs.length) {
    throw new PublicError(`expected ${inputs.length} argument(s) (${inputs.map((i) => `${i.type} ${i.name ?? ""}`.trim()).join(", ")}), got ${args.length}`);
  }
  return inputs.map((p, i) => coerceArg(p, args[i]));
}

/** JSON-safe view of a decoded value, typed by its ABI param (bigints → decimal strings). */
export function jsonValue(param: Param, v: unknown): unknown {
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

export interface DecodedValue {
  name: string;
  type: string;
  value: unknown;
}

export function decodedValues(params: readonly Param[] = [], values: readonly unknown[] | unknown): DecodedValue[] {
  const list = params.length === 1 && !Array.isArray(values) ? [values] : ((values as readonly unknown[]) ?? []);
  return params.map((p, i) => ({ name: p.name ?? "", type: p.type === "tuple" ? "tuple" : p.type, value: jsonValue(p, (list as unknown[])[i]) }));
}

// ---------------------------------------------------------------------------
// Request → PreparedWrite
// ---------------------------------------------------------------------------

/** The verification status of the code whose ABI encodes the call (the implementation's, behind a proxy). */
export function verificationOf(r: ResolvedAbi): VerificationStatus {
  if (!r.hasCode) return "unverified";
  if (r.abiSource === "proxy-implementation" && r.implementationInfo) return r.implementationInfo.status;
  return r.info.status;
}

export interface PreparedFromRequest {
  prepared: PreparedWrite;
  resolved: ResolvedAbi;
  fn: AbiFunction;
}

/**
 * Resolve the target's ABI and prepare the call. The ABI is the kit's resolved
 * ABI (verified, proxy implementation, partial/similar match). A selector-only
 * guess is never used for a request: the caller must then pass a full
 * signature, and the call is labelled "signature" (a high risk).
 */
export async function prepareFromRequest(opts: {
  reader: ChainReader;
  info: ContractInfoSource;
  request: WriteRequestInput;
  from: Address | null;
  forwarder?: Address | null;
  payableThresholdWei?: bigint;
  /** Reuse a resolution the caller already made for this address. */
  resolved?: ResolvedAbi;
  now?: () => number;
}): Promise<PreparedFromRequest> {
  const req = opts.request;
  if (!ADDRESS_RE.test(req.address)) throw new PublicError("expected a 0x-prefixed 20-byte target address");
  const address = getAddress(req.address.toLowerCase());
  if (opts.from !== null && !ADDRESS_RE.test(opts.from)) throw new PublicError("expected a 0x-prefixed 20-byte sender address");
  const from = opts.from ? getAddress(opts.from.toLowerCase()) : null;

  const resolved = opts.resolved && opts.resolved.address.toLowerCase() === address.toLowerCase()
    ? opts.resolved
    : await resolveAbi({ address, reader: opts.reader, info: opts.info });
  const trusted = resolved.abiSource === "signature-subset" || resolved.abiSource === "none" ? null : resolved.abi;

  let fn = pickFunction(trusted, req.function);
  let abiSource: AbiSource = resolved.abiSource;
  if (!fn) {
    fn = fragmentFromSignature(req.function);
    abiSource = "signature";
  }
  if (!fn) {
    throw new PublicError(
      trusted ? `no function "${req.function}" in this contract's ABI` : `no verified ABI here; pass a full signature such as "transfer(address,uint256)"`,
    );
  }
  if (fn.stateMutability === "view" || fn.stateMutability === "pure") {
    throw new PublicError(`${fn.name} is read-only (${fn.stateMutability}); use contract_read instead`);
  }
  let valueWei: bigint;
  try {
    valueWei = parseEther(req.value && req.value.trim() !== "" ? req.value.trim() : "0");
  } catch {
    throw new PublicError(`value must be a decimal SALT amount, got "${req.value}"`);
  }
  if (valueWei < 0n) throw new PublicError("value cannot be negative");
  if (valueWei > 0n && fn.stateMutability !== "payable") throw new PublicError(`${fn.name} is not payable, so it cannot be sent SALT`);
  const args = coerceArgs(fn.inputs, req.args);

  const prepared = await prepareWrite({
    reader: opts.reader,
    address,
    // The whole trusted ABI, so custom errors decode in the revert reason.
    abi: trusted ?? [fn],
    abiSource,
    abiVerified: abiSource === "signature" ? false : resolved.abiVerified,
    fn,
    args,
    value: valueWei,
    from,
    viaProxy: !!resolved.proxy,
    proxy: resolved.proxy,
    forwarder: opts.forwarder ?? null,
    verification: verificationOf(resolved),
    hasCode: resolved.hasCode,
    payableThresholdWei: opts.payableThresholdWei,
    now: opts.now,
  });
  return { prepared, resolved, fn };
}
