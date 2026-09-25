/**
 * PBA-L3c-016 tripwire: raw upstream error text (viem errors embed the RPC URL,
 * including the server-only CITRATE_RPC_FALLBACK node) must never reach an
 * anonymous caller. Every public route that talks to the RPC is driven against
 * a node that always fails; the secret path must not appear in any response.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SECRET = "PRIVATE-NODE-SECRET-PATH";
let server: http.Server;
let port = 0;

beforeAll(async () => {
  server = http.createServer((_req, res) => {
    // 400 (not 5xx) so viem fails fast without its retry/backoff loop.
    res.statusCode = 400;
    res.end("bad request");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => server.close());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function withFailingRpc<T>(load: () => Promise<T>): Promise<T> {
  vi.stubEnv("NEXT_PUBLIC_CITRATE_RPC_URL", `http://127.0.0.1:${port}/public`);
  vi.stubEnv("CITRATE_RPC_FALLBACK", `http://127.0.0.1:${port}/${SECRET}`);
  vi.resetModules();
  return load();
}

const ADDR = "0x1111111111111111111111111111111111111111";
const HASH = `0x${"ab".repeat(32)}`;
const ip = { "x-forwarded-for": "9.9.9.9" };
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

const cases: Array<[string, () => Promise<Response>]> = [
  ["GET /api/v1 gasoracle", async () => (await import("@/app/api/v1/route")).GET(new Request("http://x/api/v1?module=gastracker&action=gasoracle", { headers: ip }))],
  ["GET /api/v1 proxy eth_blockNumber", async () => (await import("@/app/api/v1/route")).GET(new Request("http://x/api/v1?module=proxy&action=eth_blockNumber", { headers: ip }))],
  ["GET /api/blocks", async () => (await import("@/app/api/blocks/route")).GET()],
  ["GET /api/blocks/[id]", async () => (await import("@/app/api/blocks/[id]/route")).GET(new Request("http://x"), params({ id: "5" }))],
  ["GET /api/latest", async () => (await import("@/app/api/latest/route")).GET(new Request("http://x/api/latest"))],
  ["GET /api/dag", async () => (await import("@/app/api/dag/route")).GET()],
  ["GET /api/address/[addr]", async () => (await import("@/app/api/address/[addr]/route")).GET(new Request("http://x"), params({ addr: ADDR }))],
  ["GET /api/contract/[addr]", async () => (await import("@/app/api/contract/[addr]/route")).GET(new Request("http://x"), params({ addr: ADDR }))],
  ["GET /api/tx/[hash]", async () => (await import("@/app/api/tx/[hash]/route")).GET(new Request("http://x"), params({ hash: HASH }))],
  ["GET /api/search", async () => (await import("@/app/api/search/route")).GET(new Request(`http://x/api/search?q=${ADDR}`))],
  ["GET /api/health", async () => (await import("@/app/api/health/route")).GET()],
  [
    "POST /api/mcp tools/call getChainStatus",
    async () =>
      (await import("@/app/api/mcp/route")).POST(
        new Request("http://x/api/mcp", {
          method: "POST",
          headers: { "content-type": "application/json", ...ip },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "getChainStatus", arguments: {} } }),
        }),
      ),
  ],
];

describe("no upstream error text reaches callers (PBA-L3c-016)", () => {
  for (const [name, call] of cases) {
    it(`${name} does not reflect the RPC URL`, async () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await withFailingRpc(call);
      const body = await res.text();
      errSpy.mockRestore();
      expect(body).not.toContain(SECRET);
      expect(body).not.toContain(`127.0.0.1:${port}`);
    }, 60_000);
  }
});

describe("source tripwire: API routes never serialize a raw error message", () => {
  const API = join(__dirname, "..", "..", "app", "api");
  const walk = (d: string, out: string[] = []): string[] => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (n === "route.ts") out.push(p);
    }
    return out;
  };
  it("no `(err as Error).message` inside a Response/send payload", () => {
    const offenders: string[] = [];
    for (const f of walk(API)) {
      const lines = readFileSync(f, "utf8").split("\n");
      lines.forEach((l, i) => {
        if (/\(\s*(err|e|error)\s+as\s+Error\s*\)\??\.message/.test(l) && !/log\.(error|warn|info)\(/.test(l)) {
          offenders.push(`${relative(API, f)}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
