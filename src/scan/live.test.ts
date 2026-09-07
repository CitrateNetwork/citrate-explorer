import { describe, it, expect } from "vitest";
import { demoEnabled } from "./live";

/**
 * EX-B-007 (RM-Q, 2026-09-07): fabricated sample data must NOT be the default
 * fallback. Demo mode is fail-closed — enabled only when NEXT_PUBLIC_DEMO is
 * exactly "1". Any other value (including unset) keeps live surfaces honest:
 * a failed read degrades to empty, never to invented chain data.
 */
describe("demoEnabled — fail-closed sample-data gate (EX-B-007)", () => {
  it("is OFF when the flag is unset (production default)", () => {
    expect(demoEnabled(undefined)).toBe(false);
  });

  it('is OFF for "0" and any non-"1" value', () => {
    expect(demoEnabled("0")).toBe(false);
    expect(demoEnabled("")).toBe(false);
    expect(demoEnabled("true")).toBe(false);
    expect(demoEnabled("2")).toBe(false);
  });

  it('is ON only for the explicit opt-in "1"', () => {
    expect(demoEnabled("1")).toBe(true);
  });
});
