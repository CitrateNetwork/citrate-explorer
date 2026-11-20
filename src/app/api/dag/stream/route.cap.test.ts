import { describe, it, expect, vi } from "vitest";

// /api/dag/stream: the per-instance concurrent-stream cap must refuse a stream
// beyond the cap (503) and free a slot when a stream ends, and the open-rate
// bucket must key on the trusted client hop. The RPC is replaced by a promise
// the test controls, so opened streams stay "live" until released.
vi.hoisted(() => {
  process.env.CITRATE_DAG_MAX_STREAMS = "2";
});
const pending: Array<(e: Error) => void> = [];
const mode = { hold: true };
vi.mock("@/lib/harness/client", () => ({
  harnessClient: () => ({
    getBlockNumber: () =>
      mode.hold
        ? new Promise((_, reject) => pending.push(reject))
        : Promise.reject(new Error("no rpc in test")),
  }),
}));
vi.mock("@/lib/citrate/rpc", () => ({
  getDagBlock: async () => null,
  dagStats: async () => null,
}));

import { GET } from "./route";

let n = 0;
const xff = () => `198.51.100.${++n}`;
const open = (headers: Record<string, string>) => GET(new Request("http://x/api/dag/stream", { headers }));
const tick = () => new Promise((r) => setTimeout(r, 5));

async function releaseAll() {
  pending.splice(0).forEach((reject) => reject(new Error("released")));
  await tick();
}

describe("/api/dag/stream concurrent-stream cap", () => {
  it("refuses a stream beyond the cap with 503 and frees the slot when a stream ends", async () => {
    mode.hold = true;
    const a = await open({ "x-forwarded-for": xff() });
    const b = await open({ "x-forwarded-for": xff() });
    expect([a.status, b.status]).toEqual([200, 200]);
    await tick();

    const c = await open({ "x-forwarded-for": xff() });
    expect(c.status).toBe(503);

    await releaseAll(); // both live streams end → both slots are released
    for (const r of [a, b]) await r.body?.cancel().catch(() => {});

    const d = await open({ "x-forwarded-for": xff() });
    expect(d.status).toBe(200);
    await tick();
    await releaseAll();
    await d.body?.cancel().catch(() => {});
  });
});

describe("/api/dag/stream open-rate identity", () => {
  it("rotating x-real-ip behind one trusted hop still hits 429", async () => {
    mode.hold = false; // streams close immediately, so the cap is not the limiter
    const trusted = xff();
    const statuses: number[] = [];
    for (let i = 0; i < 14; i++) {
      const res = await open({ "x-forwarded-for": trusted, "x-real-ip": `10.1.2.${i}` });
      statuses.push(res.status);
      await res.body?.cancel().catch(() => {});
      await tick();
    }
    expect(statuses.at(-1)).toBe(429);
  });
});
