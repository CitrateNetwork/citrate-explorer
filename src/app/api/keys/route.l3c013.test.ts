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
