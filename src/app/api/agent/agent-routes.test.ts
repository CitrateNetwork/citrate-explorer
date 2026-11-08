/**
 * POST /api/agent/prepare and POST /api/agent/write-events: gates, shapes and
 * the thread history log (prepared, edited, approved, rejected, executed).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  session: { required: false, authenticated: true, sub: "sub-1" as string | undefined },
  rateOk: true,
  threads: new Map<string, { owner: string; msgs: Array<{ role: string; content: string }> }>(),
  tx: { to: "0x1000000000000000000000000000000000000001" as string | null, status: "success" },
}));

vi.mock("@/lib/auth/session", () => ({ verifySession: async () => h.session }));
vi.mock("@/lib/api/ratelimit", () => ({ checkRateLimit: async () => (h.rateOk ? { ok: true } : { ok: false, retryAfter: 4 }) }));
vi.mock("@/lib/db/conversations", () => ({
  ownsThread: async (o: string, id: string) => h.threads.get(id)?.owner === o,
  createThread: async (o: string) => {
    const id = `t-${h.threads.size + 1}`;
    h.threads.set(id, { owner: o, msgs: [] });
    return id;
  },
  appendMessage: async (o: string, id: string, role: string, content: string) => {
    const t = h.threads.get(id);
    if (t && t.owner === o) t.msgs.push({ role, content });
  },
}));
vi.mock("@/lib/harness/ops", () => ({ getTransaction: async () => h.tx }));
vi.mock("@/lib/agent/contractModule", async (orig) => {
  const real = await orig<typeof import("@/lib/agent/contractModule")>();
  const { fakeChain } = await import("@/lib/agent/tests/fakeChain");
  return { ...real, defaultContractModule: async () => real.createContractModule(fakeChain().deps) };
});

import { POST as prepare } from "./prepare/route";
import { POST as writeEvents } from "./write-events/route";
import { parseWriteEvent, writeEventFrom } from "@/lib/agent/writeLog";
import { ALICE, MALLORY, TOKEN } from "@/lib/agent/tests/fakeChain";

const req = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${url}`, { method: "POST", headers: { "content-type": "application/json", "x-real-ip": "192.0.2.9", ...headers }, body: JSON.stringify(body) });

beforeEach(() => {
  h.session = { required: false, authenticated: true, sub: "sub-1" };
  h.rateOk = true;
  h.threads.clear();
  h.tx = { to: TOKEN, status: "success" };
});

describe("POST /api/agent/prepare", () => {
  it("prepares from the connected wallet and logs 'prepared' into a new history thread", async () => {
    const res = await prepare(req("/api/agent/prepare", { v: 1, address: TOKEN, function: "transfer(address,uint256)", args: [MALLORY, "1"], from: ALICE, origin: "mcp" }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.prepared).toMatchObject({ executable: false, chainId: 40204, origin: "mcp" });
    expect(j.prepared.simulation.from.toLowerCase()).toBe(ALICE.toLowerCase());
    expect(j.explanation.summary).toMatch(/transfer/);
    const t = h.threads.get(j.threadId)!;
    expect(t.owner).toBe("sub-1");
    expect(parseWriteEvent(t.msgs[0].content)).toMatchObject({ kind: "prepared", origin: "mcp" });
  });

  it("logs 'edited' into the given thread on a re-simulation after an edit; 'refresh' logs nothing", async () => {
    h.threads.set("mine", { owner: "sub-1", msgs: [] });
    await prepare(req("/api/agent/prepare", { address: TOKEN, function: "transfer(address,uint256)", args: [MALLORY, "2"], from: ALICE, threadId: "mine", reason: "edited" }));
    await prepare(req("/api/agent/prepare", { address: TOKEN, function: "transfer(address,uint256)", args: [MALLORY, "2"], from: ALICE, threadId: "mine", reason: "refresh" }));
    expect(h.threads.get("mine")!.msgs.map((m) => parseWriteEvent(m.content)?.kind)).toEqual(["edited"]);
  });

  it("never writes into someone else's thread", async () => {
    h.threads.set("theirs", { owner: "sub-2", msgs: [] });
    const j = await (await prepare(req("/api/agent/prepare", { address: TOKEN, function: "transfer(address,uint256)", args: [MALLORY, "1"], from: ALICE, threadId: "theirs" }))).json();
    expect(h.threads.get("theirs")!.msgs).toHaveLength(0);
    expect(j.threadId).not.toBe("theirs");
  });

  it("400s on a malformed request and 422s with a caller-facing reason on a bad call", async () => {
    expect((await prepare(req("/api/agent/prepare", { address: "0x1", function: "x", args: [] }))).status).toBe(400);
    const bad = await prepare(req("/api/agent/prepare", { address: TOKEN, function: "balanceOf", args: [ALICE] }));
    expect(bad.status).toBe(422);
    expect((await bad.json()).error).toMatch(/read-only/);
  });

  it("is rate limited", async () => {
    h.rateOk = false;
    expect((await prepare(req("/api/agent/prepare", { address: TOKEN, function: "transfer(address,uint256)", args: [MALLORY, "1"] }))).status).toBe(429);
  });

  it("refuses a cross-site request", async () => {
    expect((await prepare(req("/api/agent/prepare", { address: TOKEN, function: "f()", args: [] }, { origin: "https://evil.example" }))).status).toBe(403);
  });
});

describe("POST /api/agent/write-events", () => {
  const prepared = async () => (await (await prepare(req("/api/agent/prepare", { address: TOKEN, function: "transfer(address,uint256)", args: [MALLORY, "1"], from: ALICE, reason: "refresh" }))).json()).prepared;

  it("records approved → submitted → executed with the tx hash, outcome read from the chain", async () => {
    const p = await prepared();
    h.threads.set("t", { owner: "sub-1", msgs: [] });
    const hash = "0x" + "ab".repeat(32);
    for (const kind of ["approved", "submitted", "executed"] as const) {
      const res = await writeEvents(req("/api/agent/write-events", { threadId: "t", event: writeEventFrom(kind, p, { path: "wallet", ...(kind !== "approved" ? { txHash: hash } : {}) }) }));
      expect(res.status).toBe(200);
    }
    const events = h.threads.get("t")!.msgs.map((m) => parseWriteEvent(m.content)!);
    expect(events.map((e) => e.kind)).toEqual(["approved", "executed", "executed"]);
    expect(events[2]).toMatchObject({ txHash: hash, outcome: "on-chain status: success" });
  });

  it("records the chain's verdict, not the client's: a reverted tx is logged failed", async () => {
    const p = await prepared();
    h.tx = { to: TOKEN, status: "reverted" };
    const j = await (await writeEvents(req("/api/agent/write-events", { event: writeEventFrom("executed", p, { txHash: "0x" + "ab".repeat(32) }) }))).json();
    expect(j.event.kind).toBe("failed");
  });

  it("flags a tx whose target does not match the prepared target", async () => {
    const p = await prepared();
    h.tx = { to: MALLORY, status: "success" };
    const j = await (await writeEvents(req("/api/agent/write-events", { event: writeEventFrom("executed", p, { path: "wallet", txHash: "0x" + "ab".repeat(32) }) }))).json();
    expect(j.event.outcome).toMatch(/does not match/);
  });

  it("records a rejection", async () => {
    const p = await prepared();
    const j = await (await writeEvents(req("/api/agent/write-events", { event: writeEventFrom("rejected", p) }))).json();
    expect(parseWriteEvent(h.threads.get(j.threadId)!.msgs[0].content)?.kind).toBe("rejected");
  });

  it("refuses client-written 'prepared' events, anonymous callers and cross-site posts", async () => {
    const p = await prepared();
    expect((await writeEvents(req("/api/agent/write-events", { event: writeEventFrom("prepared", p) }))).status).toBe(400);
    h.session = { required: false, authenticated: false, sub: undefined };
    expect((await writeEvents(req("/api/agent/write-events", { event: writeEventFrom("rejected", p) }))).status).toBe(401);
    h.session = { required: false, authenticated: true, sub: "sub-1" };
    expect((await writeEvents(req("/api/agent/write-events", { event: writeEventFrom("rejected", p) }, { origin: "https://evil.example" }))).status).toBe(403);
  });
});
