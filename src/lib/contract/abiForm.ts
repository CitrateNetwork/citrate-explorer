/**
 * ABI-driven form model (EXP-S3): turns ABI parameters into form fields, parses
 * what a person (or the agent) typed into viem-ready arguments, and formats decoded
 * outputs for display. Pure; no I/O.
 *
 * A form value is a string for a scalar, and an array of child values for a tuple
 * (one per component, in order) or an array (one per element).
 */
import { getAddress, isAddress, isHex, type AbiParameter } from "viem";

export type FormValue = string | FormValue[];

export type ParseResult = { ok: true; value: unknown } | { ok: false; error: string; path: string };

type TupleParam = AbiParameter & { components?: readonly AbiParameter[] };

const components = (p: AbiParameter): readonly AbiParameter[] => (p as TupleParam).components ?? [];

/** The outer array dimension of a type (`T[]`, `T[n]`), or null for a non-array. */
export function arrayInfo(p: AbiParameter): { inner: AbiParameter; length: number | null } | null {
  const m = /^(.*)\[(\d*)\]$/.exec(p.type);
  if (!m) return null;
  // The element carries no name of its own; tuple components are kept.
  const inner = { ...p, name: "", type: m[1] } as AbiParameter;
  return { inner, length: m[2] === "" ? null : Number(m[2]) };
}

/** Canonical type text, with tuples expanded: `(address,uint64,bytes32[])[]`. */
export function typeLabel(p: AbiParameter): string {
  if (p.type.startsWith("tuple")) return `(${components(p).map(typeLabel).join(",")})${p.type.slice(5)}`;
  return p.type;
}

/** The empty form value for a parameter. */
export function emptyValue(p: AbiParameter): FormValue {
  const arr = arrayInfo(p);
  if (arr) return arr.length === null ? [] : Array.from({ length: arr.length }, () => emptyValue(arr.inner));
  if (p.type === "tuple") return components(p).map(emptyValue);
  return "";
}

function fail(path: string, error: string): ParseResult {
  return { ok: false, error, path };
}

function parseInteger(type: string, raw: string, path: string): ParseResult {
  const m = /^(u?)int(\d*)$/.exec(type)!;
  const signed = m[1] === "";
  const bits = m[2] === "" ? 256 : Number(m[2]);
  const s = raw.trim().replace(/_/g, "");
  if (s === "") return fail(path, "enter a number");
  let v: bigint;
  if (/^-?0x[0-9a-fA-F]+$/.test(s)) v = s.startsWith("-") ? -BigInt(s.slice(1)) : BigInt(s);
  else if (/^-?\d+$/.test(s)) v = BigInt(s);
  else return fail(path, "enter a whole number (decimal, or hex with 0x)");
  const min = signed ? -(1n << BigInt(bits - 1)) : 0n;
  const max = signed ? (1n << BigInt(bits - 1)) - 1n : (1n << BigInt(bits)) - 1n;
  if (v < min || v > max) return fail(path, `out of range for ${type} (${min} to ${max})`);
  return { ok: true, value: v };
}

function parseScalar(p: AbiParameter, raw: FormValue, path: string): ParseResult {
  if (typeof raw !== "string") return fail(path, `expected a single ${p.type} value`);
  const t = p.type;
  if (/^u?int\d*$/.test(t)) return parseInteger(t, raw, path);
  const s = raw.trim();
  if (t === "bool") {
    if (s === "true" || s === "1") return { ok: true, value: true };
    if (s === "false" || s === "0") return { ok: true, value: false };
    return fail(path, "enter true or false");
  }
  if (t === "address") {
    if (!/^0x[0-9a-fA-F]{40}$/.test(s)) return fail(path, "enter a 0x address (40 hex characters)");
    // Mixed case must be a valid EIP-55 checksum; all-lowercase is accepted.
    if (!isAddress(s, { strict: true })) return fail(path, "the address checksum is wrong (check the letter case)");
    return { ok: true, value: getAddress(s) };
  }
  if (t === "string") return { ok: true, value: raw };
  if (t === "bytes") {
    if (!isHex(s) || s.length % 2 !== 0) return fail(path, "enter 0x-prefixed hex with an even number of digits");
    return { ok: true, value: s.toLowerCase() };
  }
  const fixed = /^bytes(\d+)$/.exec(t);
  if (fixed) {
    const n = Number(fixed[1]);
    if (!isHex(s) || s.length !== 2 + n * 2) return fail(path, `enter exactly ${n} bytes as 0x hex (${n * 2} digits)`);
    return { ok: true, value: s.toLowerCase() };
  }
  return fail(path, `unsupported type ${t}`);
}

/** Parse one form value into a viem argument. `path` names the field in errors. */
export function parseArg(p: AbiParameter, raw: FormValue, path: string = p.name || "arg"): ParseResult {
  const arr = arrayInfo(p);
  if (arr) {
    if (!Array.isArray(raw)) return fail(path, "expected a list");
    if (arr.length !== null && raw.length !== arr.length) return fail(path, `expected exactly ${arr.length} items`);
    const out: unknown[] = [];
    for (let i = 0; i < raw.length; i++) {
      const r = parseArg(arr.inner, raw[i], `${path}[${i}]`);
      if (!r.ok) return r;
      out.push(r.value);
    }
    return { ok: true, value: out };
  }
  if (p.type === "tuple") {
    const comps = components(p);
    if (!Array.isArray(raw) || raw.length !== comps.length) return fail(path, `expected ${comps.length} fields`);
    const named = comps.length > 0 && comps.every((c) => c.name);
    const obj: Record<string, unknown> = {};
    const list: unknown[] = [];
    for (let i = 0; i < comps.length; i++) {
      const c = comps[i];
      const r = parseArg(c, raw[i], `${path}.${c.name || i}`);
      if (!r.ok) return r;
      if (named) obj[c.name!] = r.value;
      else list.push(r.value);
    }
    return { ok: true, value: named ? obj : list };
  }
  return parseScalar(p, raw, path);
}

export type ParseArgsResult = { ok: true; args: unknown[] } | { ok: false; errors: { path: string; error: string }[] };

/** Parse a whole input list, collecting every error (one per top-level input). */
export function parseArgs(inputs: readonly AbiParameter[], values: readonly FormValue[]): ParseArgsResult {
  const args: unknown[] = [];
  const errors: { path: string; error: string }[] = [];
  inputs.forEach((p, i) => {
    const r = parseArg(p, values[i] ?? emptyValue(p), p.name || `arg${i}`);
    if (r.ok) args.push(r.value);
    else errors.push({ path: r.path, error: r.error });
  });
  return errors.length ? { ok: false, errors } : { ok: true, args };
}

/** Readable text for a decoded value: structs as `{ a: 1, b: [..] }`, lists as `[..]`. */
export function formatValue(p: AbiParameter, v: unknown): string {
  const arr = arrayInfo(p);
  if (arr && Array.isArray(v)) return `[${v.map((x) => formatValue(arr.inner, x)).join(", ")}]`;
  if (p.type === "tuple") {
    const comps = components(p);
    const get = (c: AbiParameter, i: number) =>
      Array.isArray(v) ? v[i] : (v as Record<string, unknown> | null)?.[c.name ?? String(i)];
    return `{ ${comps.map((c, i) => `${c.name || i}: ${formatValue(c, get(c, i))}`).join(", ")} }`;
  }
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v === null || v === undefined) return "";
  return String(v);
}
