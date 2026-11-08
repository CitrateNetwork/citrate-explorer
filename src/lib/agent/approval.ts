/**
 * The approval state machine for every explorer write (the contract page's Write
 * tab, the chat "Prepared transaction" card, MCP approval links). It is a thin
 * layer over the contract kit's approveWrite / executeWrite, which hold the
 * binding rules; this file adds the dialog's phases and the reasons the Approve
 * button is disabled.
 *
 *   review ──approve(user click)──▶ approved ──execute──▶ submitted ──▶ executed | failed
 *     │  ▲                                           (wallet called once, here)
 *     │  └──── edit → re-prepare → review (new id; any earlier approval is void)
 *     └──reject──▶ rejected
 *
 * Nothing signs automatically. `approve` refuses unless every check in
 * `approvalBlockers` passes (Citrate chain 40204, a kit preparation
 * (`executable: false`), a connected wallet, a simulation run from THAT wallet
 * and still fresh, every high risk acknowledged, the typed confirmation for an
 * elevated write, gasless eligibility when gasless is chosen), and then calls
 * kit `approveWrite`, which also requires a real user gesture. `execute` calls
 * kit `executeWrite`, which sends only with that approval, for exactly this
 * preparation, once, within 120 s, on the approved path.
 *
 * The signer is a parameter, so the dialog passes the user's wallet (wagmi) or the
 * relay hook, and tests pass a recording fake. Pure and framework-free.
 */
import {
  approveWrite,
  executeWrite,
  PREPARED_WRITE_TTL_MS,
  type ApprovalEnv,
  type PreparedWrite,
  type RiskCode,
  type WriteApproval,
  type WriteExecutor,
  type WritePath,
} from "@/lib/contract/kit";
import { CITRATE_WRITE_CHAIN_ID, type Address, type Hex } from "@/lib/contracts/types";

export type ApprovalPhase = "review" | "approved" | "submitted" | "executed" | "failed" | "rejected";
export type ExecutionPath = WritePath;

export interface ApprovalState {
  prepared: PreparedWrite;
  phase: ApprovalPhase;
  path: ExecutionPath;
  /** What the user typed into the confirmation box (elevated writes). */
  typed: string;
  /** The high risks the user ticked. */
  acknowledged: RiskCode[];
  /** The kit approval from the user's click; null until they click Approve. */
  approval: WriteApproval | null;
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
  gas?: bigint;
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
    acknowledged: [],
    approval: null,
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
export function approvalBlockers(s: ApprovalState, connected: Address | null, now: number = Date.now()): string[] {
  const p = s.prepared;
  const out: string[] = [];
  if (s.phase !== "review") out.push(`this request is already ${s.phase}`);
  if (p.chainId !== CITRATE_WRITE_CHAIN_ID) out.push(`wrong network: expected chain ${CITRATE_WRITE_CHAIN_ID}`);
  if ((p as { executable?: unknown }).executable !== false) out.push("malformed request");
  if (!connected) out.push("connect your wallet");
  else if (!sameAddress(p.from, connected)) out.push("re-simulate from your connected wallet first");
  if (now - p.preparedAt > PREPARED_WRITE_TTL_MS) out.push("the simulation is older than 2 minutes: re-simulate");
  const missing = p.risks.filter((r) => r.severity === "high" && !s.acknowledged.includes(r.code));
  if (missing.length) out.push(`acknowledge ${missing.length === 1 ? "the high risk" : `all ${missing.length} high risks`}`);
  if (p.elevated && s.typed.trim() !== (p.confirmPhrase ?? "")) out.push(`type "${p.confirmPhrase}" to confirm this flagged call`);
  if (s.path === "gasless" && !p.gasless.eligible) out.push(`the gasless relay cannot sponsor this call: ${p.gasless.reason}`);
  return out;
}

export function setTyped(s: ApprovalState, typed: string): ApprovalState {
  return s.phase === "review" ? { ...s, typed } : s;
}

export function setPath(s: ApprovalState, path: ExecutionPath): ApprovalState {
  return s.phase === "review" ? { ...s, path } : s;
}

export function setAcknowledged(s: ApprovalState, code: RiskCode, on: boolean): ApprovalState {
  if (s.phase !== "review") return s;
  const rest = s.acknowledged.filter((c) => c !== code);
  return { ...s, acknowledged: on ? [...rest, code] : rest };
}

/** The user clicked Approve. Throws when anything blocks it. Must run inside the click handler (kit approveWrite checks the gesture). */
export function approve(s: ApprovalState, connected: Address | null, env?: ApprovalEnv, now?: number): ApprovalState {
  const blockers = approvalBlockers(s, connected, now);
  if (blockers.length) throw new Error(`cannot approve: ${blockers.join("; ")}`);
  const approval = approveWrite(s.prepared, { path: s.path, acknowledged: s.acknowledged, confirmation: s.typed }, env);
  return { ...s, phase: "approved", approval, approvedId: s.prepared.id };
}

/** The user clicked Reject. */
export function reject(s: ApprovalState): ApprovalState {
  if (s.phase !== "review" && s.phase !== "approved") return s;
  return { ...s, phase: "rejected", approval: null, approvedId: null };
}

/**
 * The user edited the call (or the wallet changed) and it was re-prepared. Any
 * approval is void: the new proposal goes back to review with its own id, an
 * empty confirmation box and no acknowledged risks.
 */
export function replacePrepared(s: ApprovalState, next: PreparedWrite): ApprovalState {
  if (s.phase !== "review" && s.phase !== "approved") return s;
  return { ...initialApproval(next), path: next.gasless.eligible ? s.path : "wallet", history: [...s.history, next.id] };
}

/** The kit executor for the chosen path, built from the user's signer. */
export function executorFor(path: ExecutionPath, signer: Signer): WriteExecutor {
  if (path === "gasless") {
    return {
      path: "gasless",
      async send(p) {
        if (!signer.sponsor) throw new Error("the gasless relay is not available here");
        return signer.sponsor({ to: p.to, data: p.data, value: p.value });
      },
    };
  }
  return {
    path: "wallet",
    send: (p) =>
      signer.sendTransaction({ chainId: CITRATE_WRITE_CHAIN_ID, to: p.to, data: p.data, value: p.value, ...(p.gas.estimate !== null ? { gas: (p.gas.estimate * 12n) / 10n } : {}) }),
  };
}

/**
 * Send the approved call. The ONLY function that reaches the signer, through kit
 * executeWrite, and only for the exact PreparedWrite the user approved.
 */
export async function execute(s: ApprovalState, signer: Signer, opts: { now?: () => number } = {}): Promise<ApprovalState> {
  if (s.phase !== "approved" || !s.approval || s.approvedId === null || s.approvedId !== s.prepared.id) {
    throw new Error("refusing to sign: this call has not been approved");
  }
  try {
    const hash = await executeWrite(s.prepared, s.approval, executorFor(s.path, signer), opts);
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
