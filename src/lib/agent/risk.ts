/**
 * Risk flags for a prepared contract write (EXP-AGENT approvals).
 *
 * Pure: the inputs are the decoded call, the target's facts and the simulation;
 * nothing here reads the chain. Matching is by 4-byte selector as well as by
 * name, so a renamed or unverified function with a dangerous selector is still
 * caught, and a harmless function that happens to be called "approve" with a
 * different shape is caught by name.
 *
 * Elevated flags (the dialog then needs a typed confirmation):
 *   approve / increaseAllowance / permit / setApprovalForAll(true),
 *   ownership or admin transfer, proxy upgrades, payable value above the
 *   threshold, an unverified or partial-match target, a call to an address with
 *   no code, and any simulation that reverted or could not run.
 */
import { formatEther, parseEther, toFunctionSelector } from "viem";
import type { AbiSource, ProxyInfo, RiskFlag, Simulation, VerificationStatus } from "@/lib/contracts/types";

const sel = (sig: string) => toFunctionSelector(sig).toLowerCase();

const MAX_UINT256 = 2n ** 256n - 1n;

/** Selector → risk class. Built from signatures so nobody hand-types a hash. */
const SELECTOR_CLASS: ReadonlyMap<string, RiskClass> = new Map<string, RiskClass>([
  [sel("approve(address,uint256)"), "approve"],
  [sel("increaseAllowance(address,uint256)"), "approve"],
  [sel("permit(address,address,uint256,uint256,uint8,bytes32,bytes32)"), "permit"],
  [sel("permit(address,address,uint256,uint256,bool,uint8,bytes32,bytes32)"), "permit"],
  [sel("setApprovalForAll(address,bool)"), "approvalForAll"],
  [sel("transferOwnership(address)"), "ownership"],
  [sel("renounceOwnership()"), "ownership"],
  [sel("acceptOwnership()"), "ownership"],
  [sel("setOwner(address)"), "ownership"],
  [sel("changeAdmin(address)"), "admin"],
  [sel("changeProxyAdmin(address,address)"), "admin"],
  [sel("grantRole(bytes32,address)"), "admin"],
  [sel("renounceRole(bytes32,address)"), "admin"],
  [sel("revokeRole(bytes32,address)"), "admin"],
  [sel("upgradeTo(address)"), "upgrade"],
  [sel("upgradeToAndCall(address,bytes)"), "upgrade"],
  [sel("upgrade(address,address)"), "upgrade"],
  [sel("upgradeAndCall(address,address,bytes)"), "upgrade"],
  [sel("setImplementation(address)"), "upgrade"],
  [sel("setBeacon(address)"), "upgrade"],
]);

type RiskClass = "approve" | "permit" | "approvalForAll" | "ownership" | "admin" | "upgrade";

const NAME_CLASS: ReadonlyArray<[RegExp, RiskClass]> = [
  [/^(approve|increaseallowance|safeapprove)$/i, "approve"],
  [/^permit/i, "permit"],
  [/^setapprovalforall$/i, "approvalForAll"],
  [/^(transferownership|renounceownership|acceptownership|setowner|changeowner)$/i, "ownership"],
  [/^(changeadmin|setadmin|transferadmin|changeproxyadmin|grantrole|revokerole|renouncerole)$/i, "admin"],
  [/^(upgradeto|upgradetoandcall|upgrade|upgradeandcall|setimplementation|setbeacon)$/i, "upgrade"],
];

/** Default threshold above which a payable call is elevated: 1 SALT. */
export const DEFAULT_PAYABLE_WARN_SALT = "1";

/** `AGENT_PAYABLE_WARN_SALT` (decimal SALT), else 1 SALT. A malformed value falls back, never disables. */
export function payableThresholdWei(env: NodeJS.ProcessEnv = process.env): bigint {
  const raw = env.AGENT_PAYABLE_WARN_SALT?.trim();
  if (raw && /^\d{1,12}(\.\d{1,18})?$/.test(raw)) return parseEther(raw);
  return parseEther(DEFAULT_PAYABLE_WARN_SALT);
}

export interface RiskInput {
  functionName: string;
  selector: string;
  /** Decoded argument values in ABI order (bigints, addresses, booleans …). */
  args: readonly unknown[];
  valueWei: bigint;
  target: {
    isContract: boolean;
    /** Status of the code whose ABI decoded the call (the implementation's, behind a proxy). */
    verification: VerificationStatus;
    abiSource: AbiSource;
    proxy: Pick<ProxyInfo, "isProxy" | "kind" | "implementation">;
  };
  simulation: Pick<Simulation, "ok" | "from" | "revertReason" | "gasEstimate">;
  thresholdWei: bigint;
}

export interface RiskAssessment {
  flags: RiskFlag[];
  elevated: boolean;
  confirmPhrase: string | null;
}

export function classify(functionName: string, selector: string): RiskClass | null {
  const bySel = SELECTOR_CLASS.get(selector.toLowerCase());
  if (bySel) return bySel;
  for (const [re, c] of NAME_CLASS) if (re.test(functionName)) return c;
  return null;
}

export function assessRisk(i: RiskInput): RiskAssessment {
  const flags: RiskFlag[] = [];
  const add = (f: RiskFlag) => flags.push(f);

  switch (classify(i.functionName, i.selector)) {
    case "approve": {
      const amount = typeof i.args[1] === "bigint" ? (i.args[1] as bigint) : null;
      add({ code: "token-approval", severity: "elevated", message: `This lets ${short(i.args[0])} spend your tokens on this contract.` });
      if (amount !== null && amount >= MAX_UINT256 / 2n) {
        add({ code: "unlimited-approval", severity: "elevated", message: "The allowance is unlimited: the spender can take every token you hold now or later." });
      }
      break;
    }
    case "permit":
      add({ code: "permit", severity: "elevated", message: "A permit grants a token allowance by signature; anyone holding it can spend within that allowance." });
      break;
    case "approvalForAll":
      if (i.args[1] !== false) {
        add({ code: "approval-for-all", severity: "elevated", message: `This lets ${short(i.args[0])} move every NFT you hold in this collection.` });
      }
      break;
    case "ownership":
      add({ code: "ownership-transfer", severity: "elevated", message: "This changes who owns the contract. An owner change is usually irreversible." });
      break;
    case "admin":
      add({ code: "admin-transfer", severity: "elevated", message: "This changes an admin or role on the contract: who can control it afterwards." });
      break;
    case "upgrade":
      add({ code: "proxy-upgrade", severity: "elevated", message: "This replaces the contract's code (proxy upgrade). The new code can do anything the old code could." });
      break;
  }

  if (i.valueWei > 0n) {
    if (i.valueWei > i.thresholdWei) {
      add({ code: "payable-above-threshold", severity: "elevated", message: `This sends ${formatEther(i.valueWei)} SALT, above the ${formatEther(i.thresholdWei)} SALT review threshold.` });
    } else {
      add({ code: "value-transfer", severity: "warn", message: `This sends ${formatEther(i.valueWei)} SALT with the call.` });
    }
  }

  if (!i.target.isContract) {
    add({ code: "eoa-target", severity: "elevated", message: "The target has no contract code. Calldata sent to it does nothing except move any value." });
  } else if (i.target.verification === "partial-match" || i.target.abiSource === "partial-match") {
    add({ code: "partial-match-target", severity: "elevated", message: "The target's source is only a partial match, not verified. Its real behaviour may differ from the shown source." });
  } else if (i.target.abiSource === "signature" && i.target.verification === "verified") {
    add({ code: "unverified-target", severity: "elevated", message: "The contract is verified, but this function is not in its verified ABI: it was encoded from a signature you supplied." });
  } else if (i.target.verification === "unavailable") {
    add({ code: "unverified-target", severity: "elevated", message: "Whether the target contract is verified is unknown right now (the verification store is unavailable). Treat it as unverified." });
  } else if (i.target.verification !== "verified") {
    add({ code: "unverified-target", severity: "elevated", message: "The target contract is not verified. Nobody has shown what its code does." });
  }

  if (i.target.proxy.isProxy) {
    add({
      code: "proxy-target",
      severity: "warn",
      message: `The target is a ${i.target.proxy.kind ?? "proxy"} proxy${i.target.proxy.implementation ? ` delegating to ${i.target.proxy.implementation}` : ""}; its logic can change if it is upgraded.`,
    });
  }

  if (!i.simulation.from) {
    add({ code: "no-sender", severity: "warn", message: "Simulated without a sender. Connect your wallet: approval re-simulates from your address." });
  }
  if (!i.simulation.ok) {
    add(
      i.simulation.revertReason
        ? { code: "simulation-reverted", severity: "elevated", message: `The simulation reverted: ${i.simulation.revertReason}. Sending it will most likely fail and still cost gas.` }
        : { code: "simulation-unavailable", severity: "elevated", message: "The simulation could not run, so the outcome is unknown." },
    );
  }

  const elevated = flags.some((f) => f.severity === "elevated");
  return { flags, elevated, confirmPhrase: elevated ? i.functionName : null };
}

function short(v: unknown): string {
  return typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v) ? v : "the spender";
}
