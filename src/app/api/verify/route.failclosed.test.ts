/**
 * /api/verify is the expensive path, so both of its shared-store guards fail
 * CLOSED: if the store is configured but erroring, the per-IP rate limit and
 * the global concurrent-compile gate each refuse the request instead of
 * degrading to a per-instance counter. The store is reached through a stubbed
 * `fetch`; the compiler is replaced with a recorder. No network is touched.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

const submitted = vi.hoisted(() => ({ n: 0 }));
vi.mock("@/lib/verify", () => ({
  submitVerification: async () => {
    submitted.n += 1;
    return { status: "pass", guid: "test-guid" };
  },
}));

const VALID = { address: "0x" + "a".repeat(40), compilerVersion: "0.8.26", source: "contract X {}" };
let ip = 0;
function verifyReq(): Request {
  ip += 1;
  return new Request("http://x/api/verify", {
    method: "POST",
    body: JSON.stringify(VALID),
    headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${(ip % 250) + 1}` },
  });
}

/** Store that answers rate-limit pipelines but fails (or answers) compile-slot ones. */
function store(opts: { rateLimit: "ok" | "error"; compileGate: "ok" | "error" }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const cmds = JSON.parse(String(init?.body)) as Array<[string, string]>;
      const isRateLimit = cmds.some(([op]) => op === "INCRBY");
      const mode = isRateLimit ? opts.rateLimit : opts.compileGate;
      if (mode === "error") throw new Error("store unreachable");
      return new Response(JSON.stringify(cmds.map(() => ({ result: 1 }))), { status: 200 });
    }),
  );
}

async function loadRoute() {
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://store.invalid");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token");
  vi.resetModules();
  return await import("./route");
}

beforeEach(() => {
  submitted.n = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("/api/verify fails closed on shared-store errors", () => {
  it("positive control: a healthy store lets the request through to the compiler", async () => {
    store({ rateLimit: "ok", compileGate: "ok" });
    const { POST } = await loadRoute();
    expect((await POST(verifyReq())).status).toBe(200);
    expect(submitted.n).toBe(1);
  });

  it("a rate-limit store error refuses the request before any compile", async () => {
    store({ rateLimit: "error", compileGate: "ok" });
    const { POST } = await loadRoute();
    const res = await POST(verifyReq());
    expect(res.status).toBe(429);
    expect(submitted.n).toBe(0);
  });

  it("a compile-gate store error refuses the slot before any compile", async () => {
    store({ rateLimit: "ok", compileGate: "error" });
    const { POST } = await loadRoute();
    const res = await POST(verifyReq());
    expect(res.status).toBe(503);
    expect(submitted.n).toBe(0);
  });
});
