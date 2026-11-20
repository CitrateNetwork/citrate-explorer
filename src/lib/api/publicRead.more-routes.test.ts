/**
 * Per-IP public-read budget at two more GET entry points: the verified-source
 * lookup and the agent listing. Both reach the indexer/DB, so a spent budget
 * must answer 429 before any backend work.
 */
import { describe, it, expect, vi } from "vitest";

// Never reach a real node or database from this suite.
vi.mock("@/lib/harness/client", () => ({
  HARNESS_TIMEOUT_MS: 9_000,
  harnessClient: () =>
    new Proxy({}, { get: () => async () => { throw new Error("offline test client"); } }),
}));
const backend = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/db/client", () => ({
  getDb: () => {
    backend.calls += 1;
    return null;
  },
}));

import { checkRateLimit } from "@/lib/api/ratelimit";
import { PUBLIC_READ_PER_SEC, PUBLIC_READ_BURST, publicReadBucket } from "./publicRead";

const ADDR = "0x2222222222222222222222222222222222222222";
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
let seq = 0;

async function exhausted(): Promise<string> {
  seq += 1;
  const ip = `198.19.7.${seq}`;
  for (let i = 0; i < PUBLIC_READ_BURST; i++) await checkRateLimit(publicReadBucket(ip), PUBLIC_READ_PER_SEC, PUBLIC_READ_BURST);
  return ip;
}
const r = (url: string, ip: string) => new Request(url, { headers: { "x-forwarded-for": ip } });

const cases: Array<[string, (ip: string) => Promise<Response>]> = [
  [
    "/api/contract/[addr]/source",
    async (ip) => (await import("@/app/api/contract/[addr]/source/route")).GET(r(`http://x/api/contract/${ADDR}/source`, ip), params({ addr: ADDR })),
  ],
  ["/api/agents", async (ip) => (await import("@/app/api/agents/route")).GET(r("http://x/api/agents", ip))],
];

describe("public read budget at the source lookup and agent listing", () => {
  for (const [name, call] of cases) {
    it(`${name} answers 429 without touching the backend once the IP's budget is spent`, async () => {
      await call("203.0.113.253").catch(() => undefined); // warm the import
      const ip = await exhausted();
      const before = backend.calls;
      const res = await call(ip);
      expect(res.status).toBe(429);
      expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
      expect(backend.calls).toBe(before);
    });

    it(`${name} still serves a caller with budget left`, async () => {
      const res = await call(`198.19.8.${++seq}`).catch(() => null);
      expect(res?.status).not.toBe(429);
    });
  }
});
