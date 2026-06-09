import { describe, it, expect } from "vitest";
import { resolveAmount, resolveTimeRange, amountRange } from "./resolvers";

const G = 10n ** 18n;

describe("research/amountRange", () => {
  it("maps comparators to grain bounds", () => {
    expect(amountRange(100n, "atleast")).toEqual({ minGrains: 100n });
    expect(amountRange(100n, "atmost")).toEqual({ maxGrains: 100n });
    expect(amountRange(100n, "exact")).toEqual({ minGrains: 100n, maxGrains: 100n });
  });
  it("'about' (default) is ±1%", () => {
    expect(amountRange(30000n * G)).toEqual({ minGrains: 29700n * G, maxGrains: 30300n * G });
  });
});

describe("research/resolveAmount", () => {
  it("parses k/m/b suffixes and commas to grains", () => {
    expect(resolveAmount("30k SALT")).toMatchObject({ ok: true, grains: 30000n * G });
    expect(resolveAmount("30,000 SALT")).toMatchObject({ ok: true, grains: 30000n * G });
    expect(resolveAmount("1.5m")).toMatchObject({ ok: true, grains: 1_500_000n * G });
    expect(resolveAmount("2b SALT")).toMatchObject({ ok: true, grains: 2_000_000_000n * G });
  });

  it("parses fractional SALT exactly (no float error)", () => {
    expect(resolveAmount("0.5 SALT")).toMatchObject({ ok: true, grains: 5n * 10n ** 17n });
    expect(resolveAmount("1.25 SALT")).toMatchObject({ ok: true, grains: 1_250_000_000_000_000_000n });
  });

  it("ordering holds across magnitudes (256-bit-safe)", () => {
    const a = resolveAmount("3000 SALT");
    const b = resolveAmount("30000 SALT");
    const c = resolveAmount("300000 SALT");
    if (a.ok && b.ok && c.ok) {
      expect(a.grains < b.grains && b.grains < c.grains).toBe(true);
    } else throw new Error("parse failed");
  });

  it("handles raw grains", () => {
    expect(resolveAmount("1000 grains")).toMatchObject({ ok: true, grains: 1000n });
    expect(resolveAmount("30k grains")).toMatchObject({ ok: true, grains: 30000n });
    expect(resolveAmount("1.5 grains")).toMatchObject({ ok: false });
  });

  it("honest error on unparseable input", () => {
    expect(resolveAmount("").ok).toBe(false);
    expect(resolveAmount("a lot of SALT").ok).toBe(false);
    expect(resolveAmount("thirty thousand").ok).toBe(false);
  });
});

describe("research/resolveTimeRange", () => {
  const NOW = 1_780_000_000; // fixed reference

  it("resolves named aliases", () => {
    expect(resolveTimeRange("last week", NOW)).toMatchObject({ ok: true, fromTs: NOW - 604800, toTs: NOW });
    expect(resolveTimeRange("yesterday", NOW)).toMatchObject({ ok: true, fromTs: NOW - 86400 });
  });

  it("resolves 'last N <unit>' and shorthand", () => {
    expect(resolveTimeRange("the last 24 hours", NOW)).toMatchObject({ ok: true, fromTs: NOW - 24 * 3600 });
    expect(resolveTimeRange("past 7 days", NOW)).toMatchObject({ ok: true, fromTs: NOW - 7 * 86400 });
    expect(resolveTimeRange("30 minutes", NOW)).toMatchObject({ ok: true, fromTs: NOW - 1800 });
  });

  it("resolves a single ISO date to that UTC day", () => {
    const r = resolveTimeRange("2026-06-01", NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.toTs - r.fromTs).toBe(86400);
  });

  it("empty -> all time; gibberish -> error", () => {
    expect(resolveTimeRange("", NOW)).toMatchObject({ ok: true, fromTs: 0, toTs: NOW });
    expect(resolveTimeRange("whenever-ish", NOW).ok).toBe(false);
  });
});
