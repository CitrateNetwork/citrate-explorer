/**
 * FUA-EXPLORER-04 (SECREM-02 WP 7.1) — bearer/OIDC tokens must NEVER live in
 * localStorage/sessionStorage. They are httpOnly cookies set by the server
 * (`/api/auth/session`); any injected script (the XSS the CSP migration also
 * narrows) must not be able to read a long-lived bearer credential.
 *
 * This is a source-level tripwire over the auth seam: it fails if anyone
 * re-introduces a web-storage read/write of the OIDC id/access token. The PKCE
 * `verifier` and CSRF `state` in sessionStorage are explicitly ALLOWED — they
 * are one-shot, non-bearer flow artifacts consumed by the callback. The mock
 * adapter's dev identity (MOCK_KEY) is also allowed: it is not an
 * authority-issued credential and the server hard-disables mock auth in
 * production (WEB-1).
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name) && !name.includes(".test.")) out.push(p);
  }
  return out;
}

/** localStorage/sessionStorage touching an OIDC token key (constant or literal). */
const TOKEN_STORAGE = /(localStorage|sessionStorage)\s*\.\s*(get|set|remove)Item\(\s*(OIDC_TOKEN_KEY|OIDC_ACCESS_KEY|["'`]citrate\.auth\.oidc\.(idtoken|accesstoken))/;

describe("FUA-EXPLORER-04 — no OIDC bearer tokens in web storage", () => {
  it("no source file reads/writes an OIDC id/access token via web storage", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const text = readFileSync(file, "utf8");
      if (TOKEN_STORAGE.test(text)) offenders.push(file.slice(SRC.length + 1));
    }
    expect(offenders).toEqual([]);
  });

  it("the OIDC callback page never touches localStorage (tokens go to the httpOnly cookie route)", () => {
    const page = readFileSync(
      join(SRC, "app", "auth", "callback", "page.tsx"),
      "utf8",
    );
    expect(page.includes("localStorage")).toBe(false);
    // The tokens must be handed to the server, which sets httpOnly cookies.
    expect(page).toMatch(/\/api\/auth\/session/);
  });

  it("the oidc client adapter never persists tokens to localStorage", () => {
    const client = readFileSync(join(SRC, "lib", "auth", "client.tsx"), "utf8");
    // Token-key constants for web storage must be gone entirely.
    expect(client.includes("citrate.auth.oidc.idtoken")).toBe(false);
    expect(client.includes("citrate.auth.oidc.accesstoken")).toBe(false);
  });
});
