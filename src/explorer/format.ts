/** Formatting for the direction-B screens. Tabular figures; no em-dashes in copy. */

export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "n/a";
  return Math.round(n).toLocaleString("en-US");
}

export function shortHash(h: string | null | undefined, head = 6, tail = 4): string {
  if (!h) return "";
  if (h.length <= head + tail + 1) return h;
  return `${h.slice(0, head)}…${h.slice(-tail)}`;
}

/** Siblings share a height, so a block is named by height plus a hash prefix. */
export function heightRef(height: number, hash: string): { height: string; prefix: string; text: string } {
  const prefix = hash.slice(0, 6);
  const h = fmtNum(height);
  return { height: h, prefix, text: `${h} ${prefix}` };
}

/** Age of a unix-seconds timestamp. */
export function fmtAge(tsSeconds: number, nowMs: number = Date.now()): string {
  const s = Math.floor(nowMs / 1000 - tsSeconds);
  if (s < 1) return "just now";
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function fmtPct(share: number, digits = 0): string {
  return (share * 100).toFixed(digits);
}

/** A decimal SALT string (from formatEther), trimmed to 9 significant decimals. */
export function fmtSalt(salt: string | null | undefined): string {
  if (!salt) return "0 SALT";
  const [i, f = ""] = salt.split(".");
  const int = Number(i).toLocaleString("en-US");
  let frac = f.slice(0, 9).replace(/0+$/, "");
  if (!frac && /[1-9]/.test(f)) frac = f.replace(/0+$/, "");
  return frac ? `${int}.${frac} SALT` : `${int} SALT`;
}

export function isoTime(tsSeconds: number): string {
  return new Date(tsSeconds * 1000).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}
