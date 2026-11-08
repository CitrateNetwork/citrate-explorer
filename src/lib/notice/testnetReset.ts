/**
 * Testnet reset notice (r1007). Owner-approved developer notice, 2026-11-07
 * (source text: the federation's DEV_NOTICE_r1007 draft).
 *
 * DATA SOURCE: the reset date is a deploy config value, the server env var
 * CITRATE_TESTNET_RESET_DATE (YYYY-MM-DD, UTC). Unset or malformed means the
 * date shows as "to be announced". Nothing here reads the chain.
 *
 * Copy rules (owner): no em-dashes, no overstatement, no token or rewards
 * language. testnetReset.test.ts enforces them.
 */

export const TESTNET_RESET_DOCS_URL = "https://docs.citrate.ai/start/testnet-reset";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TBA = "to be announced";

export interface ResetDate {
  iso: string;
  label: string;
}

/** Parse a YYYY-MM-DD calendar date. Returns null for anything else, including impossible dates. */
export function parseResetDate(raw: string | undefined | null): ResetDate | null {
  const v = (raw ?? "").trim();
  const m = DATE_RE.exec(v);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  const label = dt.toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" });
  return { iso: v, label };
}

export interface TestnetResetNotice {
  title: string;
  body: string;
  dateLabel: string;
  dateIso: string | null;
  href: string;
  linkLabel: string;
  dismissLabel: string;
  /** localStorage key. It includes the date, so announcing a date shows the notice again. */
  dismissKey: string;
}

export function testnetResetNotice(rawDate: string | undefined | null): TestnetResetNotice {
  const date = parseResetDate(rawDate);
  return {
    title: "Testnet reset",
    body:
      "The Citrate testnet will restart from a fresh genesis block before mainnet. Chain ID 40204 stays the same. " +
      "Contracts, balances and transaction history will not carry over, so keep your source code and deploy scripts.",
    dateLabel: date ? date.label : TBA,
    dateIso: date ? date.iso : null,
    href: TESTNET_RESET_DOCS_URL,
    linkLabel: "Read the notice",
    dismissLabel: "Dismiss testnet reset notice",
    dismissKey: `citrate.notice.testnet-reset.${date ? date.iso : "tba"}`,
  };
}
