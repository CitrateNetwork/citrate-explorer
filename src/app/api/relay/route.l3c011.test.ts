/**
 * PBA-L3c-011: /api/relay was unauthenticated, forwarded any `gas`, and keyed its
 * only per-user cap on the caller-chosen `request.from` (a fresh address per
 * request walks straight past it), leaving a per-instance in-memory 60/h per IP.
 *
 * Now: a session is required (401), gas is capped (400), the hourly cap keys on
 * the verified subject (rotating `from` does not help), and when the shared
 * store is configured the cap is enforced there and fails CLOSED.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { AA_STACK, CONTRACT_ADDRESSES } from "@/lib/citrate/addresses";

vi.mock("@/lib/auth/session", () => ({
  requireOwner: vi.fn(async (req: Request) => req.headers.get("x-test-sub")),
}));

const KNOWN = Object.values(CONTRACT_ADDRESSES)[0] as string;
const SIG = "0x" + "1".repeat(130);
let n = 0;

function relayReq(opts: { sub?: string | null; gas?: string; from?: string; to?: string; ip?: string } = {}) {
  n += 1;
  const from = opts.from ?? "0x" + (0xa000 + n).toString(16).padStart(40, "0");
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": opts.ip ?? `203.0.113.${(n % 250) + 1}`,
  };
  if (opts.sub !== null) headers["x-test-sub"] = opts.sub ?? `sub-${n}`;
  return new Request("http://x/api/relay", {
    method: "POST",
    headers,
    body: JSON.stringify({
      request: { from, to: opts.to ?? KNOWN, value: "0", gas: opts.gas ?? "300000", nonce: "0", deadline: 9999999999, data: "0x" },
      signature: SIG,
    }),
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("/api/relay hardening (PBA-L3c-011)", () => {
  it("401 without a session, before any policy or chain work", async () => {
    const { POST } = await import("./route");
    const res = await POST(relayReq({ sub: null }));
    expect(res.status).toBe(401);
  });

  it("400 when gas exceeds the sponsor cap (audit PoC: gas=1e12 to EntryPoint)", async () => {
    const { POST } = await import("./route");
    const res = await POST(relayReq({ gas: "1000000000000", to: AA_STACK.EntryPoint }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/gas/);
  });

  it("accepts gas exactly at the cap and refuses one above it", async () => {
    const { POST } = await import("./route");
    const { relayMaxGas } = await import("@/lib/relay/policy");
    const max = relayMaxGas();
    expect((await POST(relayReq({ gas: max.toString() }))).status).toBe(503); // policy passed; unprovisioned
    expect((await POST(relayReq({ gas: (max + 1n).toString() }))).status).toBe(400);
  });

  it("rotating `from` under one session hits the per-subject hourly cap", async () => {
    const { POST } = await import("./route");
    const { DEFAULT_MAX_PER_FROM_PER_HOUR } = await import("@/lib/relay/rateLimit");
    const sub = `rotator-${Math.random()}`;
    for (let i = 0; i < DEFAULT_MAX_PER_FROM_PER_HOUR; i++) {
      expect((await POST(relayReq({ sub }))).status).toBe(503);
    }
    const res = await POST(relayReq({ sub }));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/per-subject/);
  });

  it("the subject key is case-sensitive (SR-0): a differently-cased sub is a different owner", async () => {
    const { POST } = await import("./route");
    const { DEFAULT_MAX_PER_FROM_PER_HOUR } = await import("@/lib/relay/rateLimit");
    const sub = `CaseSub-${Math.random()}`;
    for (let i = 0; i < DEFAULT_MAX_PER_FROM_PER_HOUR; i++) await POST(relayReq({ sub }));
    expect((await POST(relayReq({ sub }))).status).toBe(429);
    expect((await POST(relayReq({ sub: sub.toLowerCase() }))).status).toBe(503);
  });

  it("with the shared store configured, a store error fails CLOSED (429)", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://upstash.invalid");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "t");
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("store down");
    }));
    vi.resetModules();
    const { POST } = await import("./route");
    const res = await POST(relayReq());
    expect(res.status).toBe(429);
  });

  it("with the shared store configured, the per-subject cap is enforced there", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://upstash.invalid");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "t");
    const counts = new Map<string, number>();
    const keys: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      const cmds = JSON.parse(String(init.body)) as unknown[][];
      const key = String(cmds[0][1]);
      keys.push(key);
      const v = (counts.get(key) ?? 0) + Number(cmds[0][2] ?? 1);
      counts.set(key, v);
      return new Response(JSON.stringify([{ result: v }, { result: 1 }]), { status: 200 });
    }));
    vi.resetModules();
    const { POST } = await import("./route");
    const sub = `shared-${Math.random()}`;
    await POST(relayReq({ sub }));
    expect(keys.some((k) => k.startsWith(`rl:relay:sub:${sub}:`))).toBe(true);
    expect(keys.some((k) => k.startsWith("rl:relay:ip:"))).toBe(true);
    // Pretend another instance already spent the subject's hourly budget.
    for (const k of counts.keys()) if (k.startsWith(`rl:relay:sub:${sub}:`)) counts.set(k, 1_000);
    const res = await POST(relayReq({ sub }));
    expect(res.status).toBe(429);
  });
});
