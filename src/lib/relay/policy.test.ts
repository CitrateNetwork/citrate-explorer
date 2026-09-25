import { describe, it, expect, afterEach, vi } from "vitest";
import {
  checkSponsorPolicy,
  isSponsorableGas,
  relayMaxGas,
  DEFAULT_RELAY_MAX_GAS,
  isZeroValue,
  isSponsorableTarget,
  sponsorableTargets,
} from "./policy";
import { CONTRACT_ADDRESSES, AA_STACK } from "@/lib/citrate/addresses";

// CIT-EXP-01 (RM-Q, 2026-09-06): red-then-green coverage for the fail-closed
// gasless-relay sponsorship policy. The bug being encoded-against is: the relay
// sponsored an ARBITRARY `to` with an ARBITRARY `value` from the relayer's own
// balance. Each fixture below asserts the INVERSE (RC-8) — value must be zero,
// target must be an allowlisted federation contract, and every malformed input
// fails closed.

const KNOWN_CONTRACT = Object.values(CONTRACT_ADDRESSES)[0] as string;
const KNOWN_AA = AA_STACK.EntryPoint as string;
// An arbitrary EOA the attacker controls (the drain-target in the finding).
const ATTACKER_EOA = "0x" + "a".repeat(40);

afterEach(() => {
  delete process.env.RELAY_TARGET_ALLOWLIST;
});

describe("isZeroValue — fail-closed value guard", () => {
  it("accepts only a strictly-zero decimal string", () => {
    expect(isZeroValue("0")).toBe(true);
    expect(isZeroValue("00")).toBe(true); // 0 in decimal, still zero
  });
  it("rejects any non-zero value (the drain vector)", () => {
    expect(isZeroValue("1")).toBe(false);
    expect(isZeroValue("1000000000000000000")).toBe(false);
  });
  it("rejects malformed / non-decimal values (fail closed)", () => {
    expect(isZeroValue("0x0")).toBe(false);
    expect(isZeroValue("")).toBe(false);
    expect(isZeroValue(" 0")).toBe(false);
    // @ts-expect-error — defends against a non-string slipping through
    expect(isZeroValue(0)).toBe(false);
  });
});

describe("isSponsorableTarget — fail-closed target allowlist", () => {
  it("accepts a canonical federation contract (any case)", () => {
    expect(isSponsorableTarget(KNOWN_CONTRACT)).toBe(true);
    expect(isSponsorableTarget(KNOWN_CONTRACT.toUpperCase().replace("0X", "0x"))).toBe(true);
  });
  it("accepts an AA-stack address", () => {
    expect(isSponsorableTarget(KNOWN_AA)).toBe(true);
  });
  it("rejects an arbitrary attacker EOA (not on the allowlist)", () => {
    expect(isSponsorableTarget(ATTACKER_EOA)).toBe(false);
  });
  it("rejects malformed addresses (fail closed)", () => {
    expect(isSponsorableTarget("0xdeadbeef")).toBe(false);
    expect(isSponsorableTarget("")).toBe(false);
    // @ts-expect-error — non-string must not pass
    expect(isSponsorableTarget(undefined)).toBe(false);
  });
  it("honours RELAY_TARGET_ALLOWLIST only for well-formed addresses", () => {
    process.env.RELAY_TARGET_ALLOWLIST = `${ATTACKER_EOA}, not-an-addr`;
    expect(sponsorableTargets().has(ATTACKER_EOA.toLowerCase())).toBe(true);
    expect(sponsorableTargets().has("not-an-addr")).toBe(false);
  });
});

describe("checkSponsorPolicy — combined gate", () => {
  it("allows value=0 to an allowlisted federation contract", () => {
    expect(checkSponsorPolicy({ value: "0", to: KNOWN_CONTRACT, gas: "300000" })).toEqual({ ok: true });
  });

  it("DENIES the drain: non-zero value to attacker EOA", () => {
    const r = checkSponsorPolicy({ value: "1000000000000000000", to: ATTACKER_EOA });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/value must be 0/);
  });

  it("DENIES non-zero value even to a known contract (value is never sponsored)", () => {
    const r = checkSponsorPolicy({ value: "1", to: KNOWN_CONTRACT });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/value must be 0/);
  });

  it("DENIES value=0 to a non-allowlisted target (arbitrary-target sponsorship)", () => {
    const r = checkSponsorPolicy({ value: "0", to: ATTACKER_EOA });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/allowlisted federation contract/);
  });
});

describe("gas cap (PBA-L3c-011)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("refuses a request with no gas field (fail closed)", () => {
    const r = checkSponsorPolicy({ value: "0", to: KNOWN_CONTRACT });
    expect(r.ok).toBe(false);
  });

  it("accepts gas in (0, cap] and refuses 0, cap+1 and junk", () => {
    const cap = relayMaxGas();
    expect(cap).toBe(DEFAULT_RELAY_MAX_GAS);
    expect(isSponsorableGas("1")).toBe(true);
    expect(isSponsorableGas(cap.toString())).toBe(true);
    expect(isSponsorableGas((cap + 1n).toString())).toBe(false);
    expect(isSponsorableGas("0")).toBe(false);
    expect(isSponsorableGas("1e6")).toBe(false);
    expect(isSponsorableGas("-1")).toBe(false);
    expect(isSponsorableGas("9".repeat(31))).toBe(false);
    expect(checkSponsorPolicy({ value: "0", to: KNOWN_CONTRACT, gas: (cap + 1n).toString() })).toEqual({
      ok: false,
      error: `relay sponsors at most ${cap} gas per call`,
    });
  });

  it("RELAY_MAX_GAS overrides only with a positive integer", () => {
    vi.stubEnv("RELAY_MAX_GAS", "100000");
    expect(relayMaxGas()).toBe(100_000n);
    for (const bad of ["", "0", "-5", "abc", "1.5", "01"]) {
      vi.stubEnv("RELAY_MAX_GAS", bad);
      expect(relayMaxGas()).toBe(DEFAULT_RELAY_MAX_GAS);
    }
  });
});
