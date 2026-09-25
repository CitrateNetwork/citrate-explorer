import type { Address } from "viem";
import { CONTRACT_ADDRESSES, AA_STACK } from "@/lib/citrate/addresses";

/**
 * CIT-EXP-01 (RM-Q remediation, 2026-09-06) — fail-closed sponsorship policy
 * for the gasless relay (`/api/relay`).
 *
 * Threat: the relay pays gas AND (before this guard) forwarded
 * `msg.value = req.value` out of the Foundation relayer's OWN wallet, with
 * nothing constraining either the value or the `to` target. Any unauthenticated
 * party could sign a valid EIP-712 ForwardRequest for their own address with
 * `value = <relayer balance>` and `to = self`; on-chain `verify` passes (valid
 * sig, current nonce, unexpired), and the relayer submits `execute{value:N}` →
 * draining the relayer in a single call. The hourly per-`from`/per-IP limiter
 * caps request COUNT, not value.
 *
 * This module refuses to sponsor:
 *   1. any request that moves native value (`value != 0`), and
 *   2. any call whose `to` target is not a known federation contract.
 *
 * Both checks fail CLOSED: an unparseable / non-decimal value, or a `to` that
 * is not a well-formed 20-byte address on the allowlist, is DENIED — never
 * waved through. A gas-sponsoring relay must never fund value, and it should
 * only sponsor calls into the federation contracts the explorer supports.
 *
 * The on-chain twin — `require(req.value == 0)` in `CitrateForwarder.execute`
 * — is HELD for the reroll/contract track (it is a consensus-gated deploy).
 * This is the off-chain defence that lands on `main` now and stands whether or
 * not the forwarder is yet provisioned.
 */

/**
 * Optional server-only extension of the sponsorable-target set (comma-separated
 * 0x-addresses). Fail-closed: only well-formed 20-byte addresses are added; a
 * missing/empty/malformed value adds nothing — it can never open the allowlist
 * to "any target". Deliberately NOT a `NEXT_PUBLIC_*` var (which is inlined into
 * the client bundle and edit-visible); the allowlist is a server-side trust
 * decision.
 */
function envExtraTargets(): string[] {
  const raw = process.env.RELAY_TARGET_ALLOWLIST;
  if (!raw || raw.trim() === "") return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^0x[0-9a-f]{40}$/.test(s));
}

/**
 * The set of `to` targets the relay is willing to sponsor: the federation's
 * canonical contract table plus the ERC-4337 AA stack (both already lowercased
 * in the canonical source), optionally extended by `RELAY_TARGET_ALLOWLIST`.
 * Recomputed per call so env overrides apply without a cold start in tests/ops.
 */
export function sponsorableTargets(): ReadonlySet<string> {
  const set = new Set<string>();
  for (const a of Object.values(CONTRACT_ADDRESSES)) set.add((a as string).toLowerCase());
  for (const a of Object.values(AA_STACK)) set.add((a as string).toLowerCase());
  for (const a of envExtraTargets()) set.add(a);
  return set;
}

/** True only for a strictly-zero, well-formed decimal value string. Fail-closed. */
export function isZeroValue(value: string): boolean {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return false;
  try {
    return BigInt(value) === 0n;
  } catch {
    return false;
  }
}

/** True only for a well-formed 20-byte address that is on the allowlist. Fail-closed. */
export function isSponsorableTarget(to: string): boolean {
  if (typeof to !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(to)) return false;
  return sponsorableTargets().has(to.toLowerCase());
}

/**
 * PBA-L3c-011: the most gas the relayer will sponsor for one forwarded call.
 * `value == 0` and the target allowlist bound WHAT is called, not how much gas
 * the relayer burns doing it (the audit PoC forwarded gas=1e12 to EntryPoint).
 * The explorer's own client signs 300,000. Override with `RELAY_MAX_GAS`; a
 * missing/malformed/non-positive value falls back to the default (never "no cap").
 */
export const DEFAULT_RELAY_MAX_GAS = 500_000n;

export function relayMaxGas(): bigint {
  const raw = process.env.RELAY_MAX_GAS?.trim();
  if (!raw || !/^[1-9]\d{0,17}$/.test(raw)) return DEFAULT_RELAY_MAX_GAS;
  return BigInt(raw);
}

/** True only for a well-formed decimal gas value in (0, relayMaxGas()]. Fail-closed. */
export function isSponsorableGas(gas: string): boolean {
  if (typeof gas !== "string" || !/^\d{1,30}$/.test(gas)) return false;
  const g = BigInt(gas);
  return g > 0n && g <= relayMaxGas();
}

export type SponsorPolicyResult = { ok: true } | { ok: false; error: string };

/**
 * Decide whether the relay may sponsor this request. Enforced BEFORE any chain
 * interaction and independently of whether the forwarder is provisioned.
 */
export function checkSponsorPolicy(req: {
  value: string;
  to: Address | string;
  gas?: string;
}): SponsorPolicyResult {
  if (!isZeroValue(req.value)) {
    return {
      ok: false,
      error:
        "gasless relay does not sponsor value transfers — request.value must be 0",
    };
  }
  if (!isSponsorableTarget(req.to)) {
    return {
      ok: false,
      error: "relay target is not an allowlisted federation contract",
    };
  }
  // PBA-L3c-011: `gas` is required by the route schema; a caller of this helper
  // that omits it is treated as out of policy (fail closed).
  if (req.gas === undefined || !isSponsorableGas(req.gas)) {
    return {
      ok: false,
      error: `relay sponsors at most ${relayMaxGas().toString()} gas per call`,
    };
  }
  return { ok: true };
}
