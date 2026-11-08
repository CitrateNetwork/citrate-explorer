/**
 * Calldata encoding, result decoding and revert decoding for the contract pages and
 * the contract kit (EXP-S3). Pure; no I/O.
 */
import {
  decodeErrorResult,
  decodeFunctionResult,
  encodeFunctionData,
  isHex,
  toFunctionSelector,
  type Abi,
  type AbiFunction,
  type Hex,
} from "viem";

type AbiError = Extract<Abi[number], { type: "error" }>;
import { formatValue } from "./abiForm";
import { canonicalSignature, lookupError } from "./signatures";

/** `name(type,...)` for a function. */
export function functionSignature(fn: AbiFunction): string {
  return canonicalSignature(fn);
}

export function functionSelector(fn: AbiFunction): Hex {
  return toFunctionSelector(functionSignature(fn));
}

/** Find a function by name (first overload) or by full signature. */
export function findFunction(abi: Abi, nameOrSignature: string): AbiFunction | null {
  const fns = abi.filter((x): x is AbiFunction => x.type === "function");
  if (nameOrSignature.includes("(")) return fns.find((f) => functionSignature(f) === nameOrSignature.replace(/\s+/g, "")) ?? null;
  return fns.find((f) => f.name === nameOrSignature) ?? null;
}

export function encodeCallData(fn: AbiFunction, args: readonly unknown[]): Hex {
  return encodeFunctionData({ abi: [fn], functionName: fn.name, args: args as unknown[] });
}

/** Decoded outputs as a list (one entry per output), whatever the output count. */
export function decodeCallResult(fn: AbiFunction, data: Hex): unknown[] {
  if (fn.outputs.length === 0) return [];
  const v = decodeFunctionResult({ abi: [fn], functionName: fn.name, data });
  return fn.outputs.length === 1 ? [v] : (v as unknown[]);
}

/** Display text per output. */
export function displayOutputs(fn: AbiFunction, decoded: unknown[]): string[] {
  return fn.outputs.map((o, i) => formatValue(o, decoded[i]));
}

/**
 * The revert data in an RPC error, or null when there is none.
 *
 * Standard nodes put it in `error.data`; viem nests it under `cause`. Citrate
 * nodes (40204, 2026-11) put it only in the message text
 * ("... Contract call reverted: 0x08c379a0... (gas used: N)"), so the message is
 * read too. CNV-RPC tracks moving it into `data`.
 */
export function revertDataOf(err: unknown): Hex | null {
  const seen = new Set<unknown>();
  const messages: string[] = [];
  let cur: unknown = err;
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const o = cur as { data?: unknown; message?: unknown; details?: unknown; cause?: unknown };
    if (typeof o.data === "string" && isHex(o.data)) return o.data as Hex;
    if (o.data && typeof o.data === "object") {
      const inner = (o.data as { data?: unknown }).data;
      if (typeof inner === "string" && isHex(inner)) return inner as Hex;
    }
    if (typeof o.message === "string") messages.push(o.message);
    if (typeof o.details === "string") messages.push(o.details);
    cur = o.cause;
  }
  for (const m of messages) {
    const hit = /reverted:\s*(0x[0-9a-fA-F]*)/g;
    let last: string | null = null;
    for (let r = hit.exec(m); r; r = hit.exec(m)) last = r[1];
    if (last !== null && last.length % 2 === 0) return last as Hex;
  }
  return null;
}

/** The node's plain-text reason when an error carries no revert data. */
export function errorText(err: unknown): string {
  const o = err as { shortMessage?: unknown; details?: unknown; message?: unknown; cause?: unknown };
  const cause = o?.cause as { message?: unknown } | undefined;
  for (const v of [o?.details, cause?.message, o?.shortMessage, o?.message]) if (typeof v === "string" && v) return v;
  return String(err);
}

export type RevertInfo =
  | { kind: "error-string"; message: string; data: Hex }
  | { kind: "panic"; code: number; message: string; data: Hex }
  | { kind: "custom"; name: string; signature: string; args: unknown[]; message: string; data: Hex; fromSignatureSubset: boolean }
  | { kind: "empty"; message: string; data: Hex }
  | { kind: "unknown"; selector: Hex; message: string; data: Hex };

const PANIC: Record<number, string> = {
  0x00: "generic compiler panic",
  0x01: "assertion failed",
  0x11: "arithmetic overflow or underflow",
  0x12: "division or modulo by zero",
  0x21: "invalid enum value",
  0x22: "invalid storage byte array encoding",
  0x31: "pop on an empty array",
  0x32: "array index out of bounds",
  0x41: "out of memory",
  0x51: "call to an uninitialized function",
};

const BUILTIN_ERRORS: Abi = [
  { type: "error", name: "Error", inputs: [{ name: "message", type: "string" }] },
  { type: "error", name: "Panic", inputs: [{ name: "code", type: "uint256" }] },
];

function customMessage(err: AbiError, args: readonly unknown[]): string {
  return `${err.name}(${err.inputs.map((p, i) => `${p.name ? p.name + ": " : ""}${formatValue(p, args[i])}`).join(", ")})`;
}

/** Decode revert data: Error(string), Panic(uint256), a custom error from the ABI, or the signature subset. */
export function decodeRevert(data: Hex, abi: Abi | null): RevertInfo {
  if (data === "0x" || data.length < 10) return { kind: "empty", message: "Reverted without a reason.", data };
  const selector = data.slice(0, 10).toLowerCase() as Hex;
  try {
    const d = decodeErrorResult({ abi: BUILTIN_ERRORS, data });
    if (d.errorName === "Error") return { kind: "error-string", message: String(d.args?.[0]), data };
    if (d.errorName === "Panic") {
      const code = Number((d.args?.[0] ?? 0n) as bigint);
      return { kind: "panic", code, message: `Panic 0x${code.toString(16).padStart(2, "0")}: ${PANIC[code] ?? "unknown panic code"}`, data };
    }
  } catch {
    /* not a builtin error */
  }
  const candidates: Array<{ err: AbiError; subset: boolean }> = [
    ...((abi ?? []).filter((x): x is AbiError => x.type === "error").map((err) => ({ err, subset: false }))),
    ...lookupError(selector).map((err) => ({ err, subset: true })),
  ];
  for (const { err, subset } of candidates) {
    if (toFunctionSelector(canonicalSignature(err)) !== selector) continue;
    try {
      const d = decodeErrorResult({ abi: [err], data });
      const args = ((d as { args?: readonly unknown[] }).args ?? []) as unknown[];
      return { kind: "custom", name: err.name, signature: canonicalSignature(err), args, message: customMessage(err, args), data, fromSignatureSubset: subset };
    } catch {
      /* selector collision with different params; try the next */
    }
  }
  return { kind: "unknown", selector, message: `Reverted with unknown error ${selector}.`, data };
}
