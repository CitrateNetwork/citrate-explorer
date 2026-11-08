/**
 * Testnet reset notice (r1007, owner-approved developer notice 2026-11-07).
 * The banner copy and the reset date come from one pure module so the copy
 * rules (no em-dashes, no token or rewards language, no overstatement) are
 * checked here and the date is a config value, "to be announced" until set.
 */
import { describe, it, expect } from "vitest";
import {
  testnetResetNotice,
  parseResetDate,
  TESTNET_RESET_DOCS_URL,
} from "./testnetReset";

describe("parseResetDate", () => {
  it("accepts a calendar date (YYYY-MM-DD) and labels it in UTC", () => {
    expect(parseResetDate("2026-12-01")).toEqual({ iso: "2026-12-01", label: "December 1, 2026" });
  });
  it("trims whitespace", () => {
    expect(parseResetDate("  2027-01-15 ")?.iso).toBe("2027-01-15");
  });
  it("returns null when unset, empty or malformed", () => {
    for (const v of [undefined, "", "   ", "soon", "2026-13-01", "2026-02-30", "12/01/2026", "2026-12-01T00:00:00Z"]) {
      expect(parseResetDate(v)).toBeNull();
    }
  });
});

describe("testnetResetNotice", () => {
  it("says 'to be announced' when no date is configured", () => {
    const n = testnetResetNotice(undefined);
    expect(n.dateLabel).toBe("to be announced");
    expect(n.dateIso).toBeNull();
    expect(n.dismissKey).toBe("citrate.notice.testnet-reset.tba");
  });

  it("shows the configured date and keys dismissal to it, so a new date shows again", () => {
    const a = testnetResetNotice("2026-12-01");
    const b = testnetResetNotice("2026-12-08");
    expect(a.dateLabel).toBe("December 1, 2026");
    expect(a.dateIso).toBe("2026-12-01");
    expect(a.dismissKey).not.toBe(b.dismissKey);
    expect(a.dismissKey).not.toBe(testnetResetNotice(undefined).dismissKey);
  });

  it("keeps the approved facts: chain ID 40204 stays, fresh genesis, nothing carries over", () => {
    const n = testnetResetNotice(undefined);
    const all = `${n.title} ${n.body}`;
    expect(all).toContain("40204");
    expect(all).toMatch(/fresh genesis/i);
    expect(all).toMatch(/will not carry over/i);
    expect(all).toMatch(/source code and deploy scripts/i);
  });

  it("links to the docs notice", () => {
    expect(TESTNET_RESET_DOCS_URL).toMatch(/^https:\/\/docs\.citrate\.ai\//);
    expect(testnetResetNotice(undefined).href).toBe(TESTNET_RESET_DOCS_URL);
  });

  it("follows the owner copy rules", () => {
    const n = testnetResetNotice("2026-12-01");
    const all = `${n.title} ${n.body} ${n.dateLabel} ${n.linkLabel} ${n.dismissLabel}`;
    expect(all).not.toMatch(/[—–]/); // no em or en dashes
    expect(all).not.toMatch(/!/);
    expect(all).not.toMatch(/\b(SALT|token|tokens|reward|rewards|earn|earnings|airdrop|dogfood)\b/i);
    expect(all).not.toMatch(/\b(guarantee|guaranteed|soon|revolutionary)\b/i);
  });
});
