import { describe, it, expect, vi, beforeEach } from "vitest";

// /api/verify entry-point pins: the per-IP limiter must bucket on the TRUSTED
// client hop (not a raw header the caller sets), and the global compile gate's
// verdict must be honoured and its slot always given back. The compiler is
// replaced by a controllable stub so the test can hold compiles "in flight".
const inflight: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
const mode = { autoResolve: false };
vi.mock("@/lib/verify", () => ({
  submitVerification: () =>
    new Promise((resolve, reject) => {
      if (mode.autoResolve) return resolve({ status: "pass", guid: "g" });
      inflight.push({
        resolve: () => resolve({ status: "pass", guid: "g" }),
        reject,
      });
    }),
}));

import { POST } from "./route";

const VALID = { address: "0x" + "b".repeat(40), compilerVersion: "0.8.26", source: "contract Y {}" };

function req(headers: Record<string, string>): Request {
  return new Request("http://x/api/verify", {
    method: "POST",
    body: JSON.stringify(VALID),
    headers: { "content-type": "application/json", ...headers },
  });
}

/** Wait until `n` stubbed compiles are in flight (the route awaits the gate first). */
async function untilInflight(n: number) {
  for (let i = 0; i < 200 && inflight.length < n; i++) await new Promise((r) => setTimeout(r, 1));
  expect(inflight.length).toBe(n);
}

let ipSeq = 0;
const freshIp = () => `203.0.113.${++ipSeq}`;

beforeEach(() => {
  inflight.length = 0;
  mode.autoResolve = false;
  delete process.env.CITRATE_TRUST_X_REAL_IP;
});

describe("/api/verify limiter identity", () => {
  it("a caller rotating x-real-ip behind one trusted hop still hits 429", async () => {
    mode.autoResolve = true; // admitted compiles finish at once: the gate is not the limiter here
    const trusted = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      statuses.push((await POST(req({ "x-forwarded-for": trusted, "x-real-ip": `10.9.8.${i}` }))).status);
    }
    expect(statuses).toContain(429);
    expect(statuses.at(-1)).toBe(429);
  });
});

describe("/api/verify global compile gate", () => {
  it("refuses a compile beyond the concurrent cap with 503, and frees slots afterwards", async () => {
    // Default cap is 3 concurrent compiles; each request uses its own IP bucket.
    const held = [1, 2, 3].map(() => POST(req({ "x-forwarded-for": freshIp() })));
    await untilInflight(3);

    const over = await POST(req({ "x-forwarded-for": freshIp() }));
    expect(over.status).toBe(503);
    expect(inflight.length).toBe(3); // the refused request never reached the compiler

    inflight.splice(0).forEach((c) => c.resolve());
    expect((await Promise.all(held)).map((r) => r.status)).toEqual([200, 200, 200]);

    // All three slots were released: three new compiles are admitted again.
    const again = [1, 2, 3].map(() => POST(req({ "x-forwarded-for": freshIp() })));
    await untilInflight(3);
    inflight.splice(0).forEach((c) => c.resolve());
    expect((await Promise.all(again)).map((r) => r.status)).toEqual([200, 200, 200]);
  });

  it("gives the slot back when the compile throws", async () => {
    const failing = [1, 2, 3].map(() => POST(req({ "x-forwarded-for": freshIp() })));
    await untilInflight(3);
    inflight.splice(0).forEach((c) => c.reject(new Error("boom")));
    expect((await Promise.all(failing)).map((r) => r.status)).toEqual([500, 500, 500]);

    const next = POST(req({ "x-forwarded-for": freshIp() }));
    await untilInflight(1);
    inflight.splice(0).forEach((c) => c.resolve());
    expect((await next).status).toBe(200);
  });
});
