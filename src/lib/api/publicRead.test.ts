/**
 * PBA-L3c-019: the public read routes (address, contract, tx, blocks, search,
 * latest, dag, health, verify status) had no rate limit, so each anonymous
 * request fanned out to live RPC unbounded. They now share one per-IP budget.
 */
import { describe, it, expect, vi } from "vitest";

// Never reach a real node from this suite (red runs would otherwise hit it).
vi.mock("@/lib/harness/client", () => ({
  HARNESS_TIMEOUT_MS: 9_000,
  harnessClient: () =>
    new Proxy({}, { get: () => async () => { throw new Error("offline test client"); } }),
}));
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { checkRateLimit } from "@/lib/api/ratelimit";
import { PUBLIC_READ_PER_SEC, PUBLIC_READ_BURST, publicReadBucket } from "./publicRead";

const ADDR = "0x1111111111111111111111111111111111111111";
const HASH = `0x${"ab".repeat(32)}`;
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
let seq = 0;

async function exhausted(): Promise<string> {
  seq += 1;
  const ip = `198.18.${Math.floor(seq / 250)}.${seq % 250}`;
  for (let i = 0; i < PUBLIC_READ_BURST; i++) await checkRateLimit(publicReadBucket(ip), PUBLIC_READ_PER_SEC, PUBLIC_READ_BURST);
  return ip;
}
const r = (url: string, ip: string) => new Request(url, { headers: { "x-forwarded-for": ip } });

const cases: Array<[string, (ip: string) => Promise<Response>]> = [
  ["/api/address/[addr]", async (ip) => (await import("@/app/api/address/[addr]/route")).GET(r("http://x", ip), params({ addr: ADDR }))],
  ["/api/contract/[addr]", async (ip) => (await import("@/app/api/contract/[addr]/route")).GET(r("http://x", ip), params({ addr: ADDR }))],
  ["/api/tx/[hash]", async (ip) => (await import("@/app/api/tx/[hash]/route")).GET(r("http://x", ip), params({ hash: HASH }))],
  ["/api/blocks/[id]", async (ip) => (await import("@/app/api/blocks/[id]/route")).GET(r("http://x", ip), params({ id: "1" }))],
  ["/api/blocks", async (ip) => (await import("@/app/api/blocks/route")).GET(r("http://x/api/blocks", ip))],
  ["/api/search", async (ip) => (await import("@/app/api/search/route")).GET(r(`http://x/api/search?q=${ADDR}`, ip))],
  ["/api/latest", async (ip) => (await import("@/app/api/latest/route")).GET(r("http://x/api/latest", ip))],
  ["/api/dag", async (ip) => (await import("@/app/api/dag/route")).GET(r("http://x/api/dag", ip))],
  ["/api/health", async (ip) => (await import("@/app/api/health/route")).GET(r("http://x/api/health", ip))],
  ["/api/verify/[guid]", async (ip) => (await import("@/app/api/verify/[guid]/route")).GET(r("http://x", ip), params({ guid: "g" }))],
];

describe("public read routes are rate-limited per IP (PBA-L3c-019)", () => {
  for (const [name, call] of cases) {
    it(`${name} answers 429 once the IP's read budget is spent`, async () => {
      // Warm the module import first so the bucket does not refill while it loads.
      await call("203.0.113.254").catch(() => undefined);
      const ip = await exhausted();
      const res = await call(ip);
      expect(res.status).toBe(429);
      expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    });
  }
});

describe("source tripwire: every RPC/DB-backed public GET calls limitPublicRead", () => {
  it("no unguarded GET that reaches the harness, indexer or DB", () => {
    const API = join(__dirname, "..", "..", "app", "api");
    const walk = (d: string, out: string[] = []): string[] => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (n === "route.ts") out.push(p);
      }
      return out;
    };
    // Routes with their own limiter or an auth gate, or no backend call.
    const EXEMPT = new Set([
      "v1/route.ts", // key/IP limiter
      "mcp/route.ts", // GET is a static manifest; POST is limited
      "dag/stream/route.ts", // per-IP stream cap
      "region/route.ts", // header echo, no backend
      "version/route.ts", // static build info
      "auth/session/route.ts", // decodes the caller's own cookie
    ]);
    const offenders: string[] = [];
    for (const f of walk(API)) {
      const rel = relative(API, f).replaceAll("\\", "/");
      if (EXEMPT.has(rel)) continue;
      const src = readFileSync(f, "utf8");
      if (!/export (async )?function GET/.test(src)) continue;
      if (/requireOwner\(|verifySession\(/.test(src)) continue; // authenticated, per-owner data
      if (!/limitPublicRead\(req/.test(src)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
