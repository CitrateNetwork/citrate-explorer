/**
 * The approval state machine (EXP-AGENT, the hard requirement).
 *
 * Nothing signs automatically. A PreparedWrite is a proposal; the only way from
 * a proposal to a wallet prompt is:
 *
 *   review ──approve(user click)──▶ approved ──execute──▶ submitted ──▶ executed | failed
 *     │  ▲                                           (signer called once, here)
 *     │  └──── edit → re-prepare → review (new id; any earlier approval is void)
 *     └──reject──▶ rejected
 *
 * `approve` refuses unless every check in `approvalBlockers` passes: Citrate
 * chain 40204, a connected wallet, a simulation run from THAT wallet, the typed
 * confirmation when the write is flagged elevated, and relay eligibility when
 * the relay is chosen. `execute` refuses unless the state was approved for
 * exactly this PreparedWrite id. The signer is a parameter, so the UI passes the
 * user's wallet (wagmi) or the relay hook, and tests pass a recording fake.
 *
 * Pure and framework-free; the React dialog (src/scan/approval.tsx) is a view
 * over this.
 */
import { CITRATE_WRITE_CHAIN_ID, type Address, type Hex, type PreparedWrite } from "@/lib/contracts/types";

export type ApprovalPhase = "review" | "approved" | "submitted" | "executed" | "failed" | "rejected";
export type ExecutionPath = "wallet" | "relay";

export interface ApprovalState {
  prepared: PreparedWrite;
  phase: ApprovalPhase;
  path: ExecutionPath;
  /** What the user typed into the confirmation box (elevated writes). */
  typed: string;
  /** The PreparedWrite id the user approved; null until they click Approve. */
  approvedId: Hex | null;
  txHash: Hex | null;
  error: string | null;
  /** Ids this dialog has shown (edits produce new ones), for the history log. */
  history: Hex[];
}

export interface WalletTx {
  chainId: number;
  to: Address;
  data: Hex;
  value: bigint;
}

/** What `execute` needs: the user's wallet and, optionally, the gasless relay. */
export interface Signer {
  /** Ask the user's wallet to sign and send. Resolves to the tx hash. */
  sendTransaction(tx: WalletTx): Promise<Hex>;
  /** Sign an EIP-712 ForwardRequest in the user's wallet and hand it to /api/relay. */
  sponsor?(tx: { to: Address; data: Hex; value: bigint }): Promise<Hex>;
}

export function initialApproval(prepared: PreparedWrite): ApprovalState {
  return {
    prepared,
    phase: "review",
    path: "wallet",
    typed: "",
    approvedId: null,
    txHash: null,
    error: null,
    history: [prepared.id],
  };
}

export function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

/** Every reason the Approve button is disabled right now. Empty = approvable. */
export function approvalBlockers(s: ApprovalState, connected: Address | null): string[] {
  const p = s.prepared;
  const out: string[] = [];
  if (s.phase !== "review") out.push(`this request is already ${s.phase}`);
  if (p.chainId !== CITRATE_WRITE_CHAIN_ID) out.push(`wrong network: expected chain ${CITRATE_WRITE_CHAIN_ID}`);
  if ((p as { executable?: unknown }).executable !== false) out.push("malformed request");
  if (!connected) out.push("connect your wallet");
  else if (!sameAddress(p.from, connected) || !sameAddress(p.simulation.from, connected)) {
    out.push("re-simulate from your connected wallet first");
  }
  if (p.risk.elevated && s.typed.trim() !== (p.risk.confirmPhrase ?? "")) {
    out.push(`type "${p.risk.confirmPhrase}" to confirm this flagged call`);
  }
  if (s.path === "relay" && !p.relay.eligible) out.push(`the gasless relay cannot sponsor this call: ${p.relay.reason}`);
  return out;
}

export function setTyped(s: ApprovalState, typed: string): ApprovalState {
  return s.phase === "review" ? { ...s, typed } : s;
}

export function setPath(s: ApprovalState, path: ExecutionPath): ApprovalState {
  return s.phase === "review" ? { ...s, path } : s;
}

/** The user clicked Approve. Throws when anything blocks it. */
export function approve(s: ApprovalState, connected: Address | null): ApprovalState {
  const blockers = approvalBlockers(s, connected);
  if (blockers.length) throw new Error(`cannot approve: ${blockers.join("; ")}`);
  return { ...s, phase: "approved", approvedId: s.prepared.id };
}

/** The user clicked Reject. */
export function reject(s: ApprovalState): ApprovalState {
  if (s.phase !== "review" && s.phase !== "approved") return s;
  return { ...s, phase: "rejected", approvedId: null };
}

/**
 * The user edited the call and it was re-prepared (re-simulated). Any approval is
 * void: the new proposal goes back to review with its own id and an empty
 * confirmation box.
 */
export function replacePrepared(s: ApprovalState, next: PreparedWrite): ApprovalState {
  if (s.phase !== "review" && s.phase !== "approved") return s;
  return { ...initialApproval(next), path: next.relay.eligible ? s.path : "wallet", history: [...s.history, next.id] };
}

/**
 * Send the approved call. The ONLY function that calls the signer, and only for
 * the exact PreparedWrite the user approved.
 */
export async function execute(s: ApprovalState, signer: Signer): Promise<ApprovalState> {
  if (s.phase !== "approved" || s.approvedId === null || s.approvedId !== s.prepared.id) {
    throw new Error("refusing to sign: this call has not been approved");
  }
  const p = s.prepared;
  const tx = { to: p.target.address, data: p.call.data, value: BigInt(p.value.wei) };
  try {
    let hash: Hex;
    if (s.path === "relay") {
      if (!signer.sponsor) throw new Error("the gasless relay is not available here");
      if (!p.relay.eligible) throw new Error("the gasless relay cannot sponsor this call");
      hash = await signer.sponsor(tx);
    } else {
      hash = await signer.sendTransaction({ chainId: CITRATE_WRITE_CHAIN_ID, ...tx });
    }
    return { ...s, phase: "submitted", txHash: hash, error: null };
  } catch (e) {
    return { ...s, phase: "failed", error: e instanceof Error ? e.message : String(e) };
  }
}

/** The receipt came back. */
export function settle(s: ApprovalState, outcome: "success" | "reverted", error?: string): ApprovalState {
  if (s.phase !== "submitted") return s;
  return outcome === "success" ? { ...s, phase: "executed" } : { ...s, phase: "failed", error: error ?? "the transaction reverted on chain" };
}
