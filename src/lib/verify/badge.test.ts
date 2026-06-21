import { describe, it, expect } from "vitest";
import { verificationBadge } from "./badge";

/**
 * FWA-C12-05 (RED→GREEN): a PARTIAL (metadata-stripped) bytecode match must NOT
 * grant the "verified" badge. A partial match means the metadata hash — which
 * commits to the exact source/settings — does NOT match, so the displayed source
 * may differ from what was deployed in ways the metadata would have caught.
 *
 * The badge is the single trust-decision point: `verified === true` is what the
 * UI green shield-checks on. It may ONLY be true for an exact (full) match.
 */
describe("verificationBadge (FWA-C12-05 — partial ≠ verified)", () => {
  it("grants the verified badge ONLY on a full (exact) match", () => {
    const b = verificationBadge("full");
    expect(b.verified).toBe(true);
    expect(b.matchType).toBe("full");
  });

  it("does NOT grant the verified badge on a partial (metadata-stripped) match", () => {
    const b = verificationBadge("partial");
    // The core regression guard: a partial match is never "verified".
    expect(b.verified).toBe(false);
    expect(b.matchType).toBe("partial");
    // …and it carries a distinct, clearly-labeled status that is NOT "verified".
    expect(b.status).toBe("partial-match");
    expect(b.status).not.toBe("verified");
    expect(b.label.toLowerCase()).toContain("partial");
  });

  it("treats a null/absent match (legacy pass rows) as partial, not verified", () => {
    // A pre-fix row may have status:"pass" with matchType null. Fail closed:
    // absent match-type is NOT a full match, so it must not be badged verified.
    const b = verificationBadge(null);
    expect(b.verified).toBe(false);
    expect(b.status).not.toBe("verified");
  });

  it("never reports verified for an unknown/none match type", () => {
    expect(verificationBadge("none").verified).toBe(false);
    expect(verificationBadge(undefined).verified).toBe(false);
  });
});
