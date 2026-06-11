/**
 * FUA-EXPLORER-04 / CSP migration (SECREM-02 WP 7.1) — the production CSP must
 * be nonce-based: `script-src` carries a per-request nonce + 'strict-dynamic'
 * and NEVER 'unsafe-inline'. The nonce is generated per request in the Next.js
 * proxy (src/proxy.ts) and threaded to the inline theme-bootstrap script via
 * the `x-nonce` request header.
 *
 * Source-level tripwire: fails if 'unsafe-inline' creeps back into script-src
 * anywhere CSP is built, or if the CSP moves back to a static next.config
 * header (which cannot carry a per-request nonce).
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..");

/** Extract every script-src directive value from a source file's CSP strings. */
function scriptSrcValues(text: string): string[] {
  const out: string[] = [];
  const re = /["'`]script-src["'`]\s*:\s*([^,\n]+)|script-src ([^;"'`]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push((m[1] ?? m[2] ?? "").trim());
  return out;
}

describe("CSP nonce migration — script-src has no 'unsafe-inline'", () => {
  it("a per-request nonce proxy exists (src/proxy.ts)", () => {
    expect(existsSync(join(ROOT, "src", "proxy.ts"))).toBe(true);
  });

  it("next.config.ts no longer ships a static Content-Security-Policy", () => {
    const cfg = readFileSync(join(ROOT, "next.config.ts"), "utf8");
    expect(cfg.includes("Content-Security-Policy")).toBe(false);
  });

  it("no script-src in any CSP source contains 'unsafe-inline'", () => {
    const files = [
      join(ROOT, "next.config.ts"),
      join(ROOT, "src", "proxy.ts"),
      join(ROOT, "src", "lib", "security", "csp.ts"),
    ].filter((f) => existsSync(f));
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const v of scriptSrcValues(text)) {
        expect(v, `${file} script-src must not allow 'unsafe-inline'`).not.toContain(
          "unsafe-inline",
        );
      }
    }
  });

  it("the CSP builder emits a nonce'd, strict-dynamic script-src", async () => {
    const { buildCsp } = await import("./csp");
    const csp = buildCsp("test-nonce-123");
    const scriptSrc = csp
      .split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith("script-src"));
    expect(scriptSrc).toBeDefined();
    expect(scriptSrc).toContain("'nonce-test-nonce-123'");
    expect(scriptSrc).toContain("'strict-dynamic'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });
});
