"use client";
/**
 * Approval UX for agent-prepared contract writes (EXP-AGENT).
 *
 *   PreparedWriteCard — the card a `prepare_write` tool result renders in chat.
 *   ApprovalDialog    — modal: re-prepares from the connected wallet, shows the
 *                       facts, enforces the approval rules, then (and only then)
 *                       asks the wallet to sign; logs each step to history.
 *   ApproveScreen     — `#/approve/<payload>`: the page an MCP approval link opens.
 *
 * Nothing here signs without a click on Approve: the only call that reaches the
 * wallet is `execute()` in src/lib/agent/approval.ts, which refuses any state
 * that was not approved for exactly the PreparedWrite on screen.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useConnect, useSendTransaction, useSwitchChain } from "wagmi";
import { injected } from "wagmi/connectors";
import { createPublicClient, http } from "viem";
import { citrate } from "@/lib/citrate/chain";
import { useAuth } from "@/lib/auth/client";
import { useSponsoredWrite } from "@/lib/citrate/use-sponsored-write";
import { PROJECT_ADDRESSES } from "@/lib/citrate/addresses";
import {
  approvalBlockers,
  approve,
  execute,
  initialApproval,
  reject,
  replacePrepared,
  setPath,
  setTyped,
  settle,
  type ApprovalState,
  type ExecutionPath,
  type Signer,
} from "@/lib/agent/approval";
import { parseApprovalPayload, type ApprovalRequest } from "@/lib/agent/deepLink";
import type { WriteExplanation } from "@/lib/agent/explain";
import { unwrapUntrusted } from "@/lib/agent/untrusted";
import { writeEventFrom, type WriteEventKind } from "@/lib/agent/writeLog";
import { CITRATE_WRITE_CHAIN_ID, type Address, type Hex, type PreparedWrite } from "@/lib/contracts/types";
import { ApprovalView } from "./approval-view";

export type WriteRequest = Omit<ApprovalRequest, "v">;

function useAuthHeaders() {
  const auth = useAuth();
  const tokenRef = useRef<string | null>(null);
  useEffect(() => {
    auth
      .getToken()
      .then((t: string | null) => {
        tokenRef.current = t;
      })
      .catch(() => {});
  }, [auth, auth.authenticated]);
  return useCallback((): Record<string, string> => (tokenRef.current ? { Authorization: `Bearer ${tokenRef.current}` } : {}), []);
}

function editableValue(v: unknown): string {
  if (typeof v === "string") return unwrapUntrusted(v);
  return JSON.stringify(v);
}

export function ApprovalDialog({
  request,
  threadId,
  onClose,
  onOpenTx,
  inline = false,
}: {
  request: WriteRequest;
  threadId?: string | null;
  onClose: () => void;
  onOpenTx?: (hash: string) => void;
  inline?: boolean;
}) {
  const { address, chainId } = useAccount();
  const { connect } = useConnect();
  const { mutateAsync: sendTransactionAsync } = useSendTransaction();
  const { mutateAsync: switchChainAsync } = useSwitchChain();
  const { sponsor } = useSponsoredWrite();
  const headers = useAuthHeaders();

  const [state, setState] = useState<ApprovalState | null>(null);
  const [explanation, setExplanation] = useState<WriteExplanation | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editArgs, setEditArgs] = useState<string[]>([]);
  const [editValue, setEditValue] = useState("0");
  const [historyThread, setHistoryThread] = useState<string | null>(threadId ?? null);
  const [current, setCurrent] = useState<WriteRequest>(request);
  const opened = useRef(false);

  const log = useCallback(
    async (kind: WriteEventKind, p: PreparedWrite, extra: { path?: ExecutionPath; txHash?: string; outcome?: string } = {}) => {
      try {
        const r = await fetch("/api/agent/write-events", {
          method: "POST",
          headers: { "content-type": "application/json", ...headers() },
          body: JSON.stringify({ threadId: historyThread, event: writeEventFrom(kind, p, extra) }),
        });
        const j = await r.json().catch(() => ({}));
        if (j.threadId) setHistoryThread(j.threadId);
      } catch {
        /* history is best-effort; it never blocks the dialog */
      }
    },
    [headers, historyThread],
  );

  const prepare = useCallback(
    async (req: WriteRequest, reason: "open" | "edited" | "refresh") => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch("/api/agent/prepare", {
          method: "POST",
          headers: { "content-type": "application/json", ...headers() },
          body: JSON.stringify({ v: 1, ...req, from: address ?? null, threadId: historyThread, reason }),
        });
        const j = await r.json();
        if (!r.ok) {
          setError(j.error ?? `could not prepare (${r.status})`);
          return;
        }
        if (j.threadId) setHistoryThread(j.threadId);
        setExplanation(j.explanation);
        setState((prev) => (prev && reason !== "open" ? replacePrepared(prev, j.prepared) : initialApproval(j.prepared)));
      } catch {
        setError("could not reach CitrateScan to simulate this call");
      } finally {
        setLoading(false);
      }
    },
    [address, headers, historyThread],
  );

  // Prepare on open, and re-simulate whenever the connected wallet changes, so
  // what the user approves was always simulated from their own address.
  useEffect(() => {
    void prepare(current, opened.current ? "refresh" : "open");
    opened.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  const connected = (address as Address | undefined) ?? null;
  const blockers = useMemo(() => (state ? approvalBlockers(state, connected) : []), [state, connected]);

  const signer: Signer = useMemo(
    () => ({
      sendTransaction: async (tx) => {
        if (chainId !== CITRATE_WRITE_CHAIN_ID) await switchChainAsync({ chainId: CITRATE_WRITE_CHAIN_ID });
        return (await sendTransactionAsync({ to: tx.to, data: tx.data, value: tx.value, chainId: CITRATE_WRITE_CHAIN_ID })) as Hex;
      },
      sponsor: async (tx) => {
        const gas = state?.prepared.relay.gas ? BigInt(state.prepared.relay.gas) : undefined;
        const h = await sponsor({ to: tx.to, data: tx.data, value: tx.value, gas });
        if (!h) throw new Error("the gasless relay did not accept this request");
        return h as Hex;
      },
    }),
    [chainId, sendTransactionAsync, switchChainAsync, sponsor, state],
  );

  const onApprove = async () => {
    if (!state) return;
    let s: ApprovalState;
    try {
      s = approve(state, connected);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    setBusy(true);
    setState(s);
    void log("approved", s.prepared, { path: s.path });
    s = await execute(s, signer);
    setState(s);
    if (!s.txHash) {
      void log("failed", s.prepared, { path: s.path, outcome: s.error ?? "not sent" });
      setBusy(false);
      return;
    }
    void log("submitted", s.prepared, { path: s.path, txHash: s.txHash });
    try {
      const client = createPublicClient({ chain: citrate, transport: http() });
      const receipt = await client.waitForTransactionReceipt({ hash: s.txHash, timeout: 120_000 });
      s = settle(s, receipt.status === "success" ? "success" : "reverted");
    } catch {
      s = { ...s, error: "no receipt yet; check the transaction page" };
    }
    setState(s);
    if (s.phase === "executed" || s.phase === "failed") void log(s.phase, s.prepared, { path: s.path, txHash: s.txHash ?? undefined, outcome: s.error ?? undefined });
    setBusy(false);
  };

  const onReject = () => {
    if (!state) return onClose();
    const s = reject(state);
    setState(s);
    void log("rejected", s.prepared);
  };

  const onEdit = () => {
    if (!state) return;
    setEditArgs(state.prepared.call.args.map((a) => editableValue(a.value)));
    setEditValue(state.prepared.value.salt);
    setEditing(true);
  };

  const onResimulate = async () => {
    if (!state) return;
    const next: WriteRequest = {
      ...current,
      address: state.prepared.target.address,
      function: state.prepared.call.signature,
      args: editArgs,
      value: state.prepared.call.stateMutability === "payable" ? editValue : undefined,
    };
    setBusy(true);
    setCurrent(next);
    await prepare(next, "edited");
    setEditing(false);
    setBusy(false);
  };

  const view = (
    <ApprovalView
      state={state}
      explanation={explanation}
      connected={connected}
      blockers={blockers}
      loading={loading}
      error={error}
      busy={busy}
      editing={editing}
      editArgs={editArgs}
      editValue={editValue}
      relayAvailable={Boolean(PROJECT_ADDRESSES.forwarder)}
      onTyped={(v) => state && setState(setTyped(state, v))}
      onPath={(p) => state && setState(setPath(state, p))}
      onApprove={onApprove}
      onReject={onReject}
      onEdit={onEdit}
      onEditArg={(i, v) => setEditArgs((a) => a.map((x, j) => (j === i ? v : x)))}
      onEditValue={setEditValue}
      onResimulate={onResimulate}
      onCancelEdit={() => setEditing(false)}
      onConnect={() => connect({ connector: injected() })}
      onClose={onClose}
      onOpenTx={onOpenTx}
    />
  );
  if (inline) return <div className="apv-page">{view}</div>;
  return (
    <div className="modal-scrim" onClick={busy ? undefined : onClose}>
      <div className="modal apv-modal" onClick={(e) => e.stopPropagation()}>
        {view}
      </div>
    </div>
  );
}

/** The chat card for a `prepare_write` result. */
export function PreparedWriteCard({
  output,
  threadId,
  onOpenTx,
}: {
  output: { prepared?: PreparedWrite; request?: WriteRequest; explanation?: WriteExplanation };
  threadId?: string | null;
  onOpenTx?: (hash: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const p = output?.prepared;
  if (!p || !output.request) return null;
  const high = p.risk.flags.filter((f) => f.severity === "elevated").length;
  return (
    <div className="apv-card">
      <div className="apv-card-h">
        <span className="apv-card-t">Prepared transaction</span>
        <span className="badge info">not sent</span>
      </div>
      <div className="mono apv-small apv-break">
        {p.call.signature} → {p.target.address}
      </div>
      <div className="apv-small">
        {p.value.salt} SALT · {p.simulation.ok ? "simulation succeeds" : "simulation does not succeed"}
        {high > 0 ? ` · ${high} high-risk flag${high > 1 ? "s" : ""}` : ""}
      </div>
      <button className="btn primary apv-card-btn" onClick={() => setOpen(true)}>
        Review and approve
      </button>
      {open && <ApprovalDialog request={output.request} threadId={threadId} onClose={() => setOpen(false)} onOpenTx={onOpenTx} />}
    </div>
  );
}

/** `#/approve/<payload>`: an approval link from an MCP client or a shared prepare. */
export function ApproveScreen({ payload, onDone, onOpenTx }: { payload: string; onDone: () => void; onOpenTx?: (hash: string) => void }) {
  const parsed = useMemo(() => parseApprovalPayload(payload), [payload]);
  if (!parsed.ok) {
    return (
      <div className="apv-page">
        <div className="apv">
          <h3>Review transaction</h3>
          <div className="note apv-danger">{parsed.error}</div>
        </div>
      </div>
    );
  }
  const { v: _v, ...request } = parsed.request;
  void _v;
  return <ApprovalDialog request={request} inline onClose={onDone} onOpenTx={onOpenTx} />;
}
