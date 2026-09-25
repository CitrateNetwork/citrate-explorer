/**
 * PBA-L3c-013: API keys could be minted without limit (each with its own 5/s
 * bucket, multiplying the caller's budget and amplifying EX-B-003/004),
 * `quotaPerDay` was stored but never enforced, and `label` was unvalidated.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/** Minimal Drizzle stand-in: every chain step is awaitable and answers from a queue. */
const db = vi.hoisted(() => {
  // Fixed, non-secret pepper so hashApiKey works in this unit test.
  process.env.API_KEY_PEPPER ??= "unit-test-pepper-not-a-secret-0000000000";
  const state = {
    selectResults: [] as unknown[][],
    inserts: [] as Array<Record<string, unknown>>,
  };
  const chain = (result: () => unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where", "limit", "set", "orderBy"]) c[m] = () => c;
    c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
    c.catch = (rej: (e: unknown) => unknown) => Promise.resolve(result()).catch(rej);
    return c;
  };
  const fake = {
    select: () => chain(() => state.selectResults.shift() ?? []),
    update: () => chain(() => undefined),
    delete: () => chain(() => undefined),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        state.inserts.push(v);
        return Promise.resolve();
      },
    }),
  };
  return { state, fake };
});

vi.mock("@/lib/db/client", () => ({ getDb: () => db.fake, isDbEnabled: () => true }));
vi.mock("@/lib/auth/session", () => ({
  requireOwner: vi.fn(async (req: Request) => req.headers.get("x-test-sub")),
}));

import { POST } from "./route";
import { validateApiKey } from "@/lib/api/keys";
import { MAX_ACTIVE_KEYS_PER_SUBJECT } from "@/lib/api/keys";

function mint(sub: string, body: unknown = { label: "ci" }) {
  return POST(
    new Request("http://x/api/keys", {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-sub": sub },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  db.state.selectResults = [];
  db.state.inserts = [];
});

describe("API-key minting limits (PBA-L3c-013)", () => {
  it("refuses a new key once the subject holds the active-key cap", async () => {
    db.state.selectResults.push([{ n: MAX_ACTIVE_KEYS_PER_SUBJECT }]);
    const res = await mint(`capped-${Math.random()}`);
    expect(res.status).toBe(409);
    expect(db.state.inserts).toHaveLength(0);
  });

  it("allows a key below the cap", async () => {
    db.state.selectResults.push([{ n: MAX_ACTIVE_KEYS_PER_SUBJECT - 1 }]);
    const res = await mint(`below-${Math.random()}`);
    expect(res.status).toBe(201);
    expect(db.state.inserts).toHaveLength(1);
    expect(db.state.inserts[0].label).toBe("ci");
  });

  it("rate-limits minting per subject (burst of 3, then 429)", async () => {
    const sub = `burst-${Math.random()}`;
    for (let i = 0; i < 3; i++) {
      db.state.selectResults.push([{ n: 0 }]);
      expect((await mint(sub)).status).toBe(201);
    }
    db.state.selectResults.push([{ n: 0 }]);
    expect((await mint(sub)).status).toBe(429);
  });

  it.each([
    ["an object label", { label: { $gt: "" } }],
    ["an over-long label", { label: "x".repeat(65) }],
    ["a label with control characters", { label: "a\u0000b" }],
    ["an empty label", { label: "" }],
  ])("400 for %s", async (_n, body) => {
    const res = await mint(`label-${Math.random()}`, body);
    expect(res.status).toBe(400);
    expect(db.state.inserts).toHaveLength(0);
  });

  it("defaults a missing label", async () => {
    db.state.selectResults.push([{ n: 0 }]);
    expect((await mint(`nolabel-${Math.random()}`, {})).status).toBe(201);
    expect(db.state.inserts[0].label).toBe("default");
  });
});

describe("validateApiKey enforcement (PBA-L3c-013)", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 7,
    subject: "owner-A",
    userAddress: "owner-A",
    rateLimitPerSec: 5,
    quotaPerDay: 3,
    revoked: false,
    ...over,
  });

  it("rate-limits by OWNER, not by key: two keys of one owner share a bucket id", async () => {
    db.state.selectResults.push([row({ id: 1, quotaPerDay: 100 })], [row({ id: 2, quotaPerDay: 100 })]);
    const a = await validateApiKey("k1", "1.1.1.1");
    const b = await validateApiKey("k2", "1.1.1.1");
    expect(a.valid && b.valid).toBe(true);
    expect(a.id).toBe(b.id);
    expect(a.id).toBe("owner:owner-A");
  });

  it("enforces quotaPerDay: the (quota+1)th call in a day is refused", async () => {
    const r = row({ id: 900 + Math.floor(Math.random() * 1e6), subject: `q-${Math.random()}` });
    for (let i = 0; i < 3; i++) {
      db.state.selectResults.push([r]);
      expect((await validateApiKey("k", "1.1.1.1")).quotaExceeded).toBeFalsy();
    }
    db.state.selectResults.push([r]);
    const over = await validateApiKey("k", "1.1.1.1");
    expect(over.quotaExceeded).toBe(true);
    expect(over.valid).toBe(false);
  });
});

describe("keys route edges (mutation kills)", () => {
  it("401 without a session", async () => {
    const res = await POST(new Request("http://x/api/keys", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("an unparseable body mints with the default label (not a 400)", async () => {
    db.state.selectResults.push([{ n: 0 }]);
    const res = await POST(new Request("http://x/api/keys", { method: "POST", headers: { "x-test-sub": `nb-${Math.random()}` }, body: "not json" }));
    expect(res.status).toBe(201);
    expect(db.state.inserts[0].label).toBe("default");
  });

  it("400 / 409 / 429 bodies say why", async () => {
    const bad = await mint(`m-${Math.random()}`, { label: "" });
    expect(await bad.json()).toEqual({ error: "label must be 1-64 printable characters" });
    db.state.selectResults.push([{ n: MAX_ACTIVE_KEYS_PER_SUBJECT }]);
    const full = await mint(`m-${Math.random()}`);
    expect(await full.json()).toEqual({ error: `at most ${MAX_ACTIVE_KEYS_PER_SUBJECT} active API keys; revoke one first` });
    const sub = `m429-${Math.random()}`;
    for (let i = 0; i < 3; i++) {
      db.state.selectResults.push([{ n: 0 }]);
      await mint(sub);
    }
    const limited = await mint(sub);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "too many keys created recently" });
    expect(limited.headers.get("retry-after")).toBe("10"); // memory bucket clamps the rate at 0.1/s for the hint
  });

  it("the mint budget refills at one per minute, not faster", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T00:00:00Z"));
    try {
      const sub = `slow-${Math.random()}`;
      for (let i = 0; i < 3; i++) {
        db.state.selectResults.push([{ n: 0 }]);
        expect((await mint(sub)).status).toBe(201);
      }
      vi.setSystemTime(Date.now() + 10_000);
      db.state.selectResults.push([{ n: 0 }]);
      expect((await mint(sub)).status).toBe(429);
      vi.setSystemTime(Date.now() + 60_000);
      db.state.selectResults.push([{ n: 0 }]);
      expect((await mint(sub)).status).toBe(201);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("validateApiKey edges (mutation kills)", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 11, subject: "owner-B", userAddress: "owner-B", rateLimitPerSec: 7, quotaPerDay: 100, revoked: false, ...over,
  });

  it("no key → anonymous per-IP identity, no DB read", async () => {
    expect(await validateApiKey(null, "2.2.2.2")).toEqual({ valid: false, anonymous: true, id: "anon:2.2.2.2", perSec: 2 });
    expect(db.state.selectResults).toEqual([]);
  });

  it("an unknown key → bad:<ip>", async () => {
    db.state.selectResults.push([]);
    expect(await validateApiKey("nope", "3.3.3.3")).toEqual({ valid: false, anonymous: false, id: "bad:3.3.3.3", perSec: 0 });
  });

  it("a valid key → owner identity, its rate, its subject", async () => {
    db.state.selectResults.push([row({ id: 900_001 })]);
    expect(await validateApiKey("k", "4.4.4.4")).toEqual({
      valid: true, anonymous: false, id: "owner:owner-B", perSec: 7, keyId: 900_001, subject: "owner-B",
    });
  });

  it("legacy rows fall back to userAddress and the default 5/s", async () => {
    db.state.selectResults.push([row({ id: 900_002, subject: null, userAddress: "0xlegacy", rateLimitPerSec: null })]);
    const k = await validateApiKey("k", "4.4.4.4");
    expect(k.id).toBe("owner:0xlegacy");
    expect(k.subject).toBe("0xlegacy");
    expect(k.perSec).toBe(5);
  });

  it("an exhausted daily quota reports quotaExceeded with the key id", async () => {
    const r = row({ id: 900_003, quotaPerDay: 1 });
    db.state.selectResults.push([r], [r]);
    await validateApiKey("k", "5.5.5.5");
    expect(await validateApiKey("k", "5.5.5.5")).toEqual({
      valid: false, anonymous: false, id: "quota:900003", perSec: 0, keyId: 900_003, quotaExceeded: true,
    });
  });

  it("the daily quota does not refill within the day", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T00:00:00Z"));
    try {
      const r = row({ id: 900_004, quotaPerDay: 2 });
      for (let i = 0; i < 2; i++) {
        db.state.selectResults.push([r]);
        expect((await validateApiKey("k", "6.6.6.6")).valid).toBe(true);
      }
      vi.setSystemTime(Date.now() + 3_600_000); // an hour later: 2/day refills 1/12 of a call
      db.state.selectResults.push([r]);
      expect((await validateApiKey("k", "6.6.6.6")).quotaExceeded).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("quota and bad keys at the API surfaces (mutation kills)", () => {
  const spent = (id: number) => ({ id, subject: `s-${id}`, userAddress: `s-${id}`, rateLimitPerSec: 5, quotaPerDay: 0, revoked: false });

  it("/api/v1: invalid key → 'Invalid API Key'; exhausted quota → 429", async () => {
    const { GET } = await import("@/app/api/v1/route");
    db.state.selectResults.push([]);
    const bad = await GET(new Request("http://x/api/v1?module=foo&action=bar&apikey=bogus", { headers: { "x-forwarded-for": "8.8.1.1" } }));
    expect(await bad.json()).toEqual({ status: "0", message: "Invalid API Key", result: null });
    db.state.selectResults.push([spent(900_010)]);
    const q = await GET(new Request("http://x/api/v1?module=foo&action=bar&apikey=k", { headers: { "x-forwarded-for": "8.8.1.2" } }));
    expect(q.status).toBe(429);
    expect(await q.json()).toEqual({ status: "0", message: "Daily API key quota exceeded", result: null });
    expect(q.headers.get("retry-after")).toBe("3600");
  });

  it("/api/v1: a keyed caller gets its own (larger) burst", async () => {
    const { GET } = await import("@/app/api/v1/route");
    const r = { id: 900_020, subject: `burst-${Math.random()}`, userAddress: "x", rateLimitPerSec: 5, quotaPerDay: 1000, revoked: false };
    let ok = 0;
    for (let i = 0; i < 11; i++) {
      db.state.selectResults.push([r]);
      const res = await GET(new Request("http://x/api/v1?module=foo&action=bar&apikey=k", { headers: { "x-forwarded-for": "8.8.2.1" } }));
      if (res.status !== 429) ok++;
    }
    expect(ok).toBe(10); // perSec 5 → burst 10
  });

  it("/api/v1: anonymous callers are limited (burst 5) with a JSON 429", async () => {
    const { GET } = await import("@/app/api/v1/route");
    let last: Response | null = null;
    for (let i = 0; i < 6; i++) last = await GET(new Request("http://x/api/v1?module=foo&action=bar", { headers: { "x-forwarded-for": "8.8.3.1" } }));
    expect(last!.status).toBe(429);
    expect(await last!.json()).toEqual({ status: "0", message: "Max rate limit reached", result: null });
    expect(Number(last!.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
  });

  it("/api/v1: unknown module/action → Unsupported (not the logs branch)", async () => {
    const { GET } = await import("@/app/api/v1/route");
    for (const [m, a] of [["foo", "bar"], ["stats", "getLogs"], ["logs", "other"]]) {
      const res = await GET(new Request(`http://x/api/v1?module=${m}&action=${a}`, { headers: { "x-forwarded-for": `8.8.4.${m.length}${a.length}` } }));
      expect((await res.json()).message).toBe(`Unsupported or not-yet-implemented module/action: ${m}/${a}`);
    }
  });

  it("/api/mcp: exhausted quota via the header → 429; the same key in ?apikey= is ignored", async () => {
    const { POST: MCP } = await import("@/app/api/mcp/route");
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
    db.state.selectResults.push([spent(900_030)]);
    const viaHeader = await MCP(new Request("http://x/api/mcp", { method: "POST", headers: { authorization: "Bearer k", "x-forwarded-for": "8.8.5.1" }, body }));
    expect(viaHeader.status).toBe(429);
    expect((await viaHeader.json()).error).toEqual({ code: -32000, message: "Daily API key quota exceeded" });
    expect(viaHeader.headers.get("retry-after")).toBe("3600");
    db.state.selectResults.push([spent(900_031)]);
    const viaQuery = await MCP(new Request("http://x/api/mcp?apikey=k", { method: "POST", headers: { "x-forwarded-for": "8.8.5.2" }, body }));
    expect(viaQuery.status).toBe(200);
    expect(db.state.selectResults).toHaveLength(1); // the query key was never looked up
  });
});
