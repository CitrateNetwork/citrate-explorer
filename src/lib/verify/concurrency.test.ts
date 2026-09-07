import { describe, it, expect, beforeEach } from "vitest";
import { CompileGate } from "./concurrency";

/**
 * FWA-C12-04 (second half): the concurrent-compile cap must be a GLOBAL bound,
 * not a per-instance one. A module-level counter caps each serverless instance
 * independently, so the real ceiling is `cap × instances`. A shared store makes
 * the cap hold across the whole fleet.
 *
 * CompileGate takes a pluggable store so we can prove the global bound without a
 * live Redis: a single shared store instance models the cross-instance counter.
 */
describe("CompileGate — global concurrent-compile cap (FWA-C12-04)", () => {
  // One shared store models the distributed counter every instance talks to.
  let shared: Map<string, number>;
  const store = {
    async incr(key: string) {
      const n = (shared.get(key) ?? 0) + 1;
      shared.set(key, n);
      return n;
    },
    async decr(key: string) {
      const n = Math.max(0, (shared.get(key) ?? 0) - 1);
      shared.set(key, n);
      return n;
    },
  };

  beforeEach(() => {
    shared = new Map();
  });

  it("enforces the cap GLOBALLY across multiple instances sharing the store", async () => {
    const cap = 3;
    // Two independent "instances" — separate gates, same shared store.
    const a = new CompileGate(cap, store);
    const b = new CompileGate(cap, store);

    // Acquire across both instances; the 4th acquire anywhere must be refused.
    expect((await a.acquire()).ok).toBe(true); // 1
    expect((await b.acquire()).ok).toBe(true); // 2
    expect((await a.acquire()).ok).toBe(true); // 3
    expect((await b.acquire()).ok).toBe(false); // 4 → global cap hit
    expect((await a.acquire()).ok).toBe(false); // still over the cap

    // Releasing one frees exactly one global slot.
    await a.release();
    expect((await b.acquire()).ok).toBe(true);
  });

  it("never lets the released counter go negative", async () => {
    const g = new CompileGate(2, store);
    await g.release(); // release without acquire
    expect(shared.get("verify:active") ?? 0).toBe(0);
    expect((await g.acquire()).ok).toBe(true);
    expect((await g.acquire()).ok).toBe(true);
    expect((await g.acquire()).ok).toBe(false);
  });

  it("fail-open (default): a store ERROR degrades to the per-instance counter", async () => {
    const throwing = {
      async incr(): Promise<number> {
        throw new Error("upstash 500");
      },
      async decr(): Promise<number> {
        throw new Error("upstash 500");
      },
    };
    const g = new CompileGate(2, throwing); // no failClosed → degrade
    expect((await g.acquire()).ok).toBe(true);
    expect((await g.acquire()).ok).toBe(true);
    expect((await g.acquire()).ok).toBe(false); // local cap still holds
  });

  it("EX-B-008: fail-closed REFUSES the slot when the store errors", async () => {
    const throwing = {
      async incr(): Promise<number> {
        throw new Error("upstash 500");
      },
      async decr(): Promise<number> {
        throw new Error("upstash 500");
      },
    };
    const g = new CompileGate(3, throwing, { failClosed: true });
    // A Redis blip must NOT drop the global cap to a fresh per-instance counter;
    // every acquire is refused while the store is unreachable.
    expect((await g.acquire()).ok).toBe(false);
    expect((await g.acquire()).ok).toBe(false);
  });

  it("falls back to a per-instance counter when no shared store is configured", async () => {
    // No store ⇒ in-memory; documented as a per-instance bound (the global cap is
    // cap×instances under this fallback — acceptable for single-instance/dev).
    const g = new CompileGate(2, null);
    expect((await g.acquire()).ok).toBe(true);
    expect((await g.acquire()).ok).toBe(true);
    expect((await g.acquire()).ok).toBe(false);
    expect(g.distributed).toBe(false);
    await g.release();
    expect((await g.acquire()).ok).toBe(true);
  });
});
