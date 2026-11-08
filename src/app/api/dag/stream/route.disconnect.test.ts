/**
 * #48 found `ReferenceError: Cannot access 'timer' before initialization` in
 * /api/dag/stream: close() cleared `timer`, a const declared only after the
 * snapshot, so a client that disconnected (or a snapshot that failed) before the
 * poll interval existed crashed the stream. It must close cleanly instead, and
 * never start a poller for a stream that is already closed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const head: { next: () => Promise<bigint> } = { next: async () => 1n };

vi.mock("@/lib/harness/client", () => ({ harnessClient: () => ({ getBlockNumber: () => head.next() }) }));
vi.mock("@/lib/citrate/rpc", () => ({ getDagBlock: async () => null }));
vi.mock("@/lib/citrate/sharedDagStats", () => ({ sharedDagStats: async () => { throw new Error("no stats in test"); } }));
vi.mock("@/lib/api/ratelimit", () => ({ checkRateLimit: async () => ({ ok: true }) }));

import { GET } from "./route";

const req = (signal?: AbortSignal) => new Request("http://x/api/dag/stream", { headers: { "x-real-ip": "198.51.100.7" }, signal });

async function readAll(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out;
    out += dec.decode(value);
  }
}

let intervals: { mock: { calls: unknown[][] }; mockRestore(): void };
beforeEach(() => {
  intervals = vi.spyOn(globalThis, "setInterval") as unknown as typeof intervals;
});
afterEach(() => {
  intervals.mockRestore();
});

describe("/api/dag/stream early close", () => {
  it("a failed snapshot sends an error event and closes cleanly (no ReferenceError)", async () => {
    head.next = async () => {
      throw new Error("rpc down");
    };
    const body = await readAll(await GET(req()));
    expect(body).toContain("event: error");
    expect(intervals).not.toHaveBeenCalled();
  });

  it("a client that disconnects before the first poll closes the stream and starts no poller", async () => {
    let resolveHead!: (v: bigint) => void;
    head.next = () => new Promise<bigint>((r) => (resolveHead = r));
    const ac = new AbortController();
    const res = await GET(req(ac.signal));
    const reading = readAll(res);
    await new Promise((r) => setTimeout(r, 0));
    expect(() => ac.abort()).not.toThrow();
    resolveHead(10n);
    await expect(reading).resolves.toBeTypeOf("string");
    await new Promise((r) => setTimeout(r, 0));
    expect(intervals.mock.calls.filter((c: unknown[]) => c[1] === 2500)).toHaveLength(0);
  });
});
