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

describe("/api/relay edges (mutation kills)", () => {
  it("400 on an unparseable body, before the session check", async () => {
    const { POST } = await import("./route");
    const res = await POST(new Request("http://x/api/relay", { method: "POST", headers: { "x-test-sub": "s" }, body: "{" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid ForwardRequest");
  });

  it("the 401 says to sign in", async () => {
    const { POST } = await import("./route");
    expect(await (await POST(relayReq({ sub: null }))).json()).toEqual({ error: "sign in to use the gasless relay" });
  });

  it("a subject-cap 429 carries the sliding-window retry (minutes, not a 60 s default)", async () => {
    const { POST } = await import("./route");
    const { DEFAULT_MAX_PER_FROM_PER_HOUR } = await import("@/lib/relay/rateLimit");
    const sub = `retry-${Math.random()}`;
    for (let i = 0; i < DEFAULT_MAX_PER_FROM_PER_HOUR; i++) await POST(relayReq({ sub }));
    const res = await POST(relayReq({ sub }));
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(3000);
  });

  it("rotating subjects on one `from` still hits the per-from cap", async () => {
    const { POST } = await import("./route");
    const { DEFAULT_MAX_PER_FROM_PER_HOUR } = await import("@/lib/relay/rateLimit");
    const from = "0x" + Math.floor(Math.random() * 1e12).toString(16).padStart(40, "b");
    for (let i = 0; i < DEFAULT_MAX_PER_FROM_PER_HOUR; i++) expect((await POST(relayReq({ from }))).status).toBe(503);
    const res = await POST(relayReq({ from }));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/per-from/);
  });
});

describe("checkRelayQuota shared store (mutation kills)", () => {
  function fakeStore(preset: (key: string) => number | undefined = () => undefined) {
    const calls: unknown[][][] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      const cmds = JSON.parse(String(init.body)) as unknown[][];
      calls.push(cmds);
      const k = String(cmds[0][1]);
      return new Response(JSON.stringify([{ result: preset(k) ?? 1 }, { result: 1 }]), { status: 200 });
    }));
    return calls;
  }

  it("uses hour-long windows with the configured caps, fail-closed", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://upstash.invalid");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "t");
    const calls = fakeStore();
    vi.resetModules();
    const { checkRelayQuota } = await import("@/lib/relay/rateLimit");
    expect(await checkRelayQuota(`w-${Math.random()}`, "0x" + "c".repeat(40), "9.9.9.1")).toEqual({ ok: true });
    const expires = calls.map((c) => c[1]);
    expect(expires).toHaveLength(2);
    for (const e of expires) expect(e[2]).toBe(3600);
  });

  it("an IP over its shared cap → 429 scoped to ip", async () => {
    // Pin the clock to the start of an hour-aligned window so the retry is deterministic.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-25T10:00:05Z"));
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://upstash.invalid");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "t");
    fakeStore((k) => (k.startsWith("rl:relay:ip:") ? 61 : 1));
    vi.resetModules();
    const { checkRelayQuota } = await import("@/lib/relay/rateLimit");
    const r = await checkRelayQuota(`ip-${Math.random()}`, "0x" + "d".repeat(40), "9.9.9.2");
    expect(r.ok).toBe(false);
    expect(r.scope).toBe("ip");
    expect(r.retryAfter).toBe(3595);
    vi.useRealTimers();
  });

  it("a subject over its shared cap → 429 scoped to subject with the window's retry", async () => {
    // Pin the clock to the start of an hour-aligned window so the retry is deterministic.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-25T10:00:05Z"));
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://upstash.invalid");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "t");
    fakeStore((k) => (k.startsWith("rl:relay:sub:") ? 31 : 1));
    vi.resetModules();
    const { checkRelayQuota } = await import("@/lib/relay/rateLimit");
    const r = await checkRelayQuota(`s-${Math.random()}`, "0x" + "e".repeat(40), "9.9.9.3");
    expect(r).toMatchObject({ ok: false, scope: "subject", retryAfter: 3595 });
    vi.useRealTimers();
  });

  it("with no store configured the shared path is skipped (no fetch)", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    vi.resetModules();
    const { checkRelayQuota } = await import("@/lib/relay/rateLimit");
    expect(await checkRelayQuota(`n-${Math.random()}`, "0x" + "f".repeat(40), "9.9.9.4")).toEqual({ ok: true });
    expect(f).not.toHaveBeenCalled();
  });
});

describe("checkRelayQuota fails closed on a store error (mutation kill)", () => {
  it("a store error denies (subject scope first)", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://upstash.invalid");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "t");
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("store down");
    }));
    vi.resetModules();
    const { checkRelayQuota } = await import("@/lib/relay/rateLimit");
    const r = await checkRelayQuota(`fc-${Math.random()}`, "0x" + "9".repeat(40), "9.9.9.9");
    expect(r).toMatchObject({ ok: false, scope: "subject" });
  });

  it("a store error on the IP check denies too", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://upstash.invalid");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "t");
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      n += 1;
      if (n === 1) return new Response(JSON.stringify([{ result: 1 }, { result: 1 }]), { status: 200 });
      throw new Error("store down");
    }));
    vi.resetModules();
    const { checkRelayQuota } = await import("@/lib/relay/rateLimit");
    const r = await checkRelayQuota(`fc2-${Math.random()}`, "0x" + "8".repeat(40), "9.9.9.8");
    expect(r).toMatchObject({ ok: false, scope: "ip" });
  });
});
