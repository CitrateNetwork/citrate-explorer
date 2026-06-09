/**
 * Natural-language resolvers for the research tools (RA-2 WP-2.1).
 *
 * Turn the way people actually ask ("30k SALT", "last week") into the machine
 * ranges the query layer needs (grains; a unix-second time window). Pure functions
 * — no IO — so they are exhaustively unit-tested. Honest, typed errors on
 * unparseable input (never a silent default).
 */
import { parseUnits } from "viem";

export type AmountResult =
  | { ok: true; grains: bigint; normalized: string }
  | { ok: false; error: string };

const SUFFIX_EXP: Record<string, number> = { k: 3, m: 6, b: 9 };

/** Shift a decimal string's point right by `exp` places (exact, no float). */
function scaleDecimalString(s: string, exp: number): string {
  if (exp === 0) return s;
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  const [intRaw, fracRaw = ""] = body.split(".");
  const digits = intRaw + fracRaw;
  const pointFromRight = fracRaw.length - exp; // new fractional length
  let out: string;
  if (pointFromRight <= 0) {
    out = digits + "0".repeat(-pointFromRight);
  } else {
    out = digits.slice(0, digits.length - pointFromRight) + "." + digits.slice(digits.length - pointFromRight);
  }
  out = out.replace(/^0+(?=\d)/, "").replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  return (neg ? "-" : "") + (out || "0");
}

/**
 * Parse a human amount into grains (wei) for a token with `decimals`.
 * Accepts: "30k SALT", "30,000", "1.5m", "0.5 SALT", "1000 grains" (raw grains).
 */
export function resolveAmount(text: string, decimals = 18): AmountResult {
  if (typeof text !== "string" || !text.trim()) return { ok: false, error: "empty amount" };
  let s = text.trim().toLowerCase();

  // "grains" / "wei" means the number is already in base units.
  const rawUnit = /\b(grains?|wei)\b/.test(s);
  s = s.replace(/\b(salt|grains?|wei|tokens?)\b/g, "").trim();
  s = s.replace(/,/g, "");

  const m = s.match(/^([0-9]*\.?[0-9]+)\s*([kmb])?$/);
  if (!m) return { ok: false, error: `cannot parse amount from "${text}"` };
  const [, mantissa, suffix] = m;

  if (rawUnit) {
    if (mantissa.includes(".")) return { ok: false, error: "grains must be a whole number" };
    const scaled = scaleDecimalString(mantissa, suffix ? SUFFIX_EXP[suffix] : 0);
    return { ok: true, grains: BigInt(scaled), normalized: `${scaled} grains` };
  }

  const scaled = scaleDecimalString(mantissa, suffix ? SUFFIX_EXP[suffix] : 0);
  try {
    const grains = parseUnits(scaled, decimals);
    return { ok: true, grains, normalized: `${scaled} (×10^${decimals})` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type Comparator = "atleast" | "atmost" | "about" | "exact";

/**
 * Turn a single amount + a comparator into a [min, max] grain range.
 * A bare amount defaults to "about" (±1%) — "when was 30k SALT sent" rarely means
 * exactly 30000.000000000000000000.
 */
export function amountRange(grains: bigint, comparator: Comparator = "about"): { minGrains?: bigint; maxGrains?: bigint } {
  switch (comparator) {
    case "atleast":
      return { minGrains: grains };
    case "atmost":
      return { maxGrains: grains };
    case "exact":
      return { minGrains: grains, maxGrains: grains };
    case "about":
    default: {
      const tol = grains / 100n; // ±1%
      return { minGrains: grains - tol, maxGrains: grains + tol };
    }
  }
}

export type TimeRangeResult =
  | { ok: true; fromTs: number; toTs: number; label: string }
  | { ok: false; error: string };

const UNIT_SECONDS: Record<string, number> = {
  second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2592000, year: 31536000,
};

/**
 * Resolve a time phrase to a [fromTs, toTs] window in unix seconds, relative to
 * `nowSec`. Handles "last/past N <unit>", common aliases, and a single ISO date.
 */
export function resolveTimeRange(text: string, nowSec: number): TimeRangeResult {
  const now = Math.floor(nowSec);
  if (!text || !text.trim()) return { ok: true, fromTs: 0, toTs: now, label: "all time" };
  const s = text.trim().toLowerCase();

  const aliases: Record<string, number> = {
    "yesterday": 86400, "today": 86400, "past day": 86400, "last day": 86400,
    "past hour": 3600, "last hour": 3600,
    "past week": 604800, "last week": 604800,
    "past month": 2592000, "last month": 2592000,
    "past year": 31536000, "last year": 31536000,
  };
  for (const [phrase, secs] of Object.entries(aliases)) {
    if (s.includes(phrase)) return { ok: true, fromTs: now - secs, toTs: now, label: phrase };
  }

  // "last 24 hours", "past 7 days", "last 30 minutes", "24h", "7d"
  const m = s.match(/(?:last|past|in the last)?\s*(\d+)\s*(second|minute|hour|day|week|month|year|m|h|d|w)s?\b/);
  if (m) {
    const n = Number(m[1]);
    const unitKey =
      m[2] === "h" ? "hour" : m[2] === "d" ? "day" : m[2] === "w" ? "week" : m[2] === "m" ? "minute" : m[2];
    const secs = UNIT_SECONDS[unitKey];
    if (secs) return { ok: true, fromTs: now - n * secs, toTs: now, label: `last ${n} ${unitKey}${n === 1 ? "" : "s"}` };
  }

  // Single ISO date → that day (UTC).
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const start = Date.parse(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00Z`) / 1000;
    if (Number.isFinite(start)) return { ok: true, fromTs: start, toTs: start + 86400, label: s };
  }

  return { ok: false, error: `cannot parse a time range from "${text}"` };
}
