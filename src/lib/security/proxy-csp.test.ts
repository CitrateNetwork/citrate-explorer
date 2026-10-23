/**
 * The per-request CSP is emitted ONLY by src/proxy.ts: it must reach the browser
 * on the response and reach SSR on the forwarded request (Next stamps the nonce
 * from that request header). Also pins the non-script directives that close
 * plugin, base-tag, form and framing injection.
 */
import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import proxy from "@/proxy";
import { buildCsp } from "./csp";

const directive = (csp: string, name: string) =>
  csp
    .split(";")
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(`${name} `));

describe("proxy emits the nonce'd CSP", () => {
  it("sets the same per-request policy on the response and the forwarded request", () => {
    const res = proxy(new NextRequest("http://localhost/address/0x1"));
    const sent = res.headers.get("content-security-policy");
    expect(sent).toBeTruthy();
    const nonce = /'nonce-([^']+)'/.exec(sent!)?.[1];
    expect(nonce).toBeTruthy();
    expect(directive(sent!, "script-src")).toContain("'strict-dynamic'");
    // NextResponse.next({ request: { headers } }) forwards overrides as x-middleware-request-*.
    expect(res.headers.get("x-middleware-request-content-security-policy")).toBe(sent);
    expect(res.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
  });

  it("mints a fresh nonce per request", () => {
    const a = proxy(new NextRequest("http://localhost/")).headers.get("content-security-policy");
    const b = proxy(new NextRequest("http://localhost/")).headers.get("content-security-policy");
    expect(a).not.toBe(b);
  });
});

describe("CSP non-script directives", () => {
  const csp = buildCsp("n");
  it.each([
    ["object-src", "object-src 'none'"],
    ["base-uri", "base-uri 'self'"],
    ["form-action", "form-action 'self'"],
    ["frame-ancestors", "frame-ancestors 'none'"],
    ["default-src", "default-src 'self'"],
  ])("%s is locked down", (name, want) => {
    expect(directive(csp, name)).toBe(want);
  });
});
