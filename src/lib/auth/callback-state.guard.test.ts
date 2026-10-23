/**
 * Source tripwire for the OIDC callback page (a client component, so it is
 * checked at source level like the nonce tripwire): the returned `state` must
 * be compared against the stored one and the flow aborted on a mismatch BEFORE
 * the code is exchanged; the stored verifier/state/nonce are cleared afterwards.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const page = readFileSync(join(__dirname, "..", "..", "app", "auth", "callback", "page.tsx"), "utf8");

describe("OIDC callback state check", () => {
  it("aborts on a missing or mismatched state", () => {
    const guard = /if\s*\(\s*!returnedState\s*\|\|\s*returnedState\s*!==\s*expectedState\s*\)\s*\{[^}]*return;/s;
    expect(page).toMatch(guard);
  });

  it("checks state before the token exchange", () => {
    const stateAt = page.search(/returnedState\s*!==\s*expectedState/);
    const exchangeAt = page.indexOf("grant_type");
    expect(stateAt).toBeGreaterThan(-1);
    expect(exchangeAt).toBeGreaterThan(-1);
    expect(stateAt).toBeLessThan(exchangeAt);
  });

  it("reads state from the namespaced session key and clears it after use", () => {
    expect(page).toMatch(/expectedState\s*=\s*sessionStorage\.getItem\("citrate\.auth\.oidc\.state"\)/);
    expect(page).toMatch(/sessionStorage\.removeItem\("citrate\.auth\.oidc\.state"\)/);
  });
});
