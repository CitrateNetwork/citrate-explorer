import { describe, it, expect } from "vitest";
import { cachedRead } from "./cache";

describe("cachedRead — stale-on-error read cache", () => {
  it("caches a successful read and serves it within TTL without re-calling", async () => {
    let calls = 0;
    const fn = async () => {
      calls += 1;
      return { v: calls };
    };
    const a = await cachedRead("k1", 1000, fn);
    expect(a).toMatchObject({ data: { v: 1 }, stale: false, ageMs: 0 });

    const b = await cachedRead("k1", 1000, fn);
    expect(b.data).toEqual({ v: 1 }); // same cached value
    expect(b.stale).toBe(false);
    expect(calls).toBe(1); // fn NOT called again within the TTL
  });

  it("serves the last-known-good value (stale) when the live read fails", async () => {
    let mode: "ok" | "fail" = "ok";
    const fn = async () => {
      if (mode === "fail") throw new Error("rpc 502");
      return { v: 42 };
    };
    await cachedRead("k2", 0, fn); // ttl 0 → always re-fetch; seeds the cache
    mode = "fail";
    const r = await cachedRead("k2", 0, fn);
    expect(r.stale).toBe(true);
    expect(r.data).toEqual({ v: 42 }); // the flap is invisible — last good served
  });

  it("rethrows when the read fails and nothing was ever cached", async () => {
    const fn = async () => {
      throw new Error("rpc 502");
    };
    await expect(cachedRead("k3-unique", 0, fn)).rejects.toThrow("rpc 502");
  });
});
