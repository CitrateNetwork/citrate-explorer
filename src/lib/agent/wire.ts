/**
 * The kit's results in the agent's JSON wire shapes (src/lib/contracts/types.ts).
 * Pure: used by the agent's tools on the server and by the approval dialog for
 * the deterministic explanation. Nothing here prepares, approves or sends.
 */
import { formatEther, keccak256, toBytes, type AbiFunction } from "viem";
import { GASLESS_GAS, type PreparedWrite as KitPreparedWrite, type ProxyInfo as KitProxyInfo, type ResolvedAbi as KitResolvedAbi } from "@/lib/contract/kit";
import { decodedValues, type PreparedFromRequest } from "@/lib/contract/request";
import { explainPreparedWrite, type WriteExplanation } from "./explain";
import { CITRATE_WRITE_CHAIN_ID, type AbiSource, type Hex, type PreparedWrite, type ProxyInfo, type VerificationStatus } from "@/lib/contracts/types";

export const NO_PROXY: ProxyInfo = { isProxy: false, kind: null, implementation: null, admin: null, beacon: null, evidence: [] };

// ---------------------------------------------------------------------------

/** The kit's proxy facts in the agent's JSON shape, with the evidence spelled out. */
export function wireProxy(p: KitProxyInfo | null): ProxyInfo {
  if (!p) return NO_PROXY;
  const evidence =
    p.kind === "eip1167"
      ? ["EIP-1167 minimal-proxy bytecode"]
      : p.kind === "eip1967"
        ? ["EIP-1967 implementation slot", ...(p.admin ? ["EIP-1967 admin slot"] : [])]
        : p.kind === "eip1967-beacon"
          ? ["EIP-1967 beacon slot", "beacon.implementation()"]
          : ["EIP-1822 PROXIABLE slot"];
  return { isProxy: true, kind: p.kind, implementation: p.implementation, admin: p.admin, beacon: p.beacon, evidence };
}

/** The kit's ABI provenance in the agent's vocabulary. A selector-only guess is not an ABI to the agent. */
export function wireAbiSource(s: KitResolvedAbi["abiSource"] | "signature"): AbiSource {
  switch (s) {
    case "verified":
      return "verified";
    case "partial-match":
    case "similar-match":
      return "partial-match";
    case "proxy-implementation":
      return "implementation";
    case "signature":
      return "signature";
    default:
      return "none";
  }
}

/** keccak256 of the canonical (chainId, from, to, data, value): stable across re-simulation. */
export function preparedWriteId(p: { from: string | null; to: string; data: string; valueWei: bigint }): Hex {
  return keccak256(toBytes(JSON.stringify([CITRATE_WRITE_CHAIN_ID, p.from?.toLowerCase() ?? null, p.to.toLowerCase(), p.data.toLowerCase(), p.valueWei.toString()])));
}

/** The kit's PreparedWrite as the JSON the agent's tools return. Always `executable: false`. */
export function toWirePrepared(
  k: KitPreparedWrite,
  ctx: { resolved: KitResolvedAbi; fn: AbiFunction; label: string | null; origin: PreparedWrite["origin"]; gasPriceWei: bigint | null; blockNumber: bigint | null; now: Date },
): PreparedWrite {
  const r = ctx.resolved;
  const contractName = (r.abiSource === "proxy-implementation" ? r.implementationInfo?.contractName : null) ?? r.info.contractName ?? null;
  const ok = k.simulation.status === "ok";
  const revertReason = k.simulation.status === "reverted" ? (k.simulation.revert?.message ?? k.simulation.error) : null;
  const gasEstimate = k.gas.estimate;
  return {
    id: k.id,
    requestId: preparedWriteId({ from: k.from, to: k.to, data: k.data, valueWei: k.value }),
    chainId: CITRATE_WRITE_CHAIN_ID,
    network: "citrate",
    from: k.from,
    target: {
      address: k.to,
      label: ctx.label,
      isContract: k.target.isContract,
      verification: k.target.verification as VerificationStatus,
      contractName,
      abiSource: wireAbiSource(k.abiSource),
      proxy: wireProxy(r.proxy),
    },
    call: {
      function: k.method.name,
      signature: k.method.signature,
      selector: k.method.selector,
      stateMutability: k.method.stateMutability === "payable" ? "payable" : "nonpayable",
      args: decodedValues(ctx.fn.inputs, k.args.map((a) => a.value)),
      data: k.data,
    },
    value: { wei: k.value.toString(), salt: formatEther(k.value) },
    simulation: {
      ok,
      from: k.from,
      revertReason,
      gasEstimate: gasEstimate?.toString() ?? null,
      gasPriceWei: ctx.gasPriceWei?.toString() ?? null,
      feeSalt: gasEstimate !== null && ctx.gasPriceWei !== null ? formatEther(gasEstimate * ctx.gasPriceWei) : null,
      blockNumber: ctx.blockNumber?.toString() ?? null,
      simulatedAt: ctx.now.toISOString(),
    },
    risk: { flags: [...k.risks], elevated: k.elevated, confirmPhrase: k.confirmPhrase },
    relay: k.gasless.eligible ? { eligible: true, reason: null, gas: GASLESS_GAS.toString() } : { eligible: false, reason: k.gasless.reason, gas: null },
    origin: ctx.origin,
    executable: false,
    createdAt: new Date(k.preparedAt).toISOString(),
  };
}


/** What the approval dialog shows beside a kit preparation of a request: target facts and the deterministic explanation. */
export function approvalFacts(
  out: PreparedFromRequest,
  origin: PreparedWrite["origin"],
): { target: { label: string | null; contractName: string | null; viaImplementation: boolean }; explanation: WriteExplanation } {
  const r = out.resolved;
  const wire = toWirePrepared(out.prepared, { resolved: r, fn: out.fn, label: null, origin, gasPriceWei: null, blockNumber: null, now: new Date() });
  return {
    target: { label: null, contractName: wire.target.contractName, viaImplementation: out.prepared.abiSource === "proxy-implementation" },
    explanation: explainPreparedWrite(wire),
  };
}
