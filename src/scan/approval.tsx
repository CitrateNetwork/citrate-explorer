"use client";
/**
 * The one approval dialog for every explorer write.
 *
 *   ApprovalDialog    — modal (or inline page). Prepares the call in the browser
 *                       through the contract kit from the CONNECTED wallet, shows
 *                       the facts, enforces the approval rules, then (and only
 *                       then) asks the wallet to sign. Used by the contract page's
 *                       Write tab, the chat card and MCP approval links.
 *   PreparedWriteCard — the card a `prepare_write` tool result renders in chat.
 *   ApproveScreen     — `#/approve/<payload>`: the page an MCP approval link opens.
 *
 * Nothing here signs without a click on Approve: the only call that reaches the
 * wallet is `execute()` in src/lib/agent/approval.ts → kit executeWrite, which
 * refuses anything but a fresh, single-use kit approval (made by approveWrite in
 * the Approve click handler) for exactly the PreparedWrite on screen.
 *
 * Data sources (Rule 7): the Citrate RPC (kit createRpcReader), the verification
 * store (GET /api/contract/{a}/verified via createApiSourceV2), the user's wallet
 * (wagmi), POST /api/relay for gasless sends, and POST /api/agent/write-events for
 * the thread history.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnect, useConnection, useConnectors, useSendTransaction, useSwitchChain } from "wagmi";
import { createPublicClient, http, formatEther, type Address, type Hex } from "viem";
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
  setAcknowledged,
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
import { approvalFacts } from "@/lib/agent/wire";
import { writeEventFromKit, type WriteEventKind } from "@/lib/agent/writeLog";
import type { PreparedWrite as WirePreparedWrite } from "@/lib/contracts/types";
import { createApiSourceV2 } from "@/lib/contract/infoSources";
import type { PreparedWrite } from "@/lib/contract/kit";
import { prepareFromRequest } from "@/lib/contract/request";
import { createRpcReader } from "@/lib/contract/rpcReader";
import { ApprovalView, type TargetFacts } from "./approval-view";
import "@/scan/contract/contract.css";

export type WriteRequest = Omit<ApprovalRequest, "v">;

/** How the dialog gets its PreparedWrite: always the kit, from the connected wallet. */
export type Preparer = (from: Address | null) => Promise<{ prepared: PreparedWrite; target: TargetFacts; explanation: WriteExplanation | null }>;

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
  if (typeof v === "bigint") return v.toString();
  return JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
}

/** A Preparer for a request (chat card, MCP link): kit prepareFromRequest over the browser reader. */
export function requestPreparer(req: WriteRequest): Preparer {
  const reader = createRpcReader();
  const info = createApiSourceV2();
  return async (from) => {
    const out = await prepareFromRequest({
      reader,
      info,
      request: { address: req.address, function: req.function, args: req.args, value: req.value },
      from,
      forwarder: (PROJECT_ADDRESSES.forwarder as Address | undefined) ?? null,
    });
    return { prepared: out.prepared, ...approvalFacts(out, req.origin) };
  };
}

export function ApprovalDialog({
  preparer,
  request,
  origin = "ui",
  threadId,
  onClose,
  onOpenTx,
  onSent,
  inline = false,
}: {
  /** The contract page passes its own kit preparation; a request (chat/MCP) uses requestPreparer. */
  preparer?: Preparer;
  /** An agent/MCP request. Makes the call editable here. */
  request?: WriteRequest;
  origin?: WirePreparedWrite["origin"];
  threadId?: string | null;
  onClose: () => void;
  onOpenTx?: (hash: string) => void;
  onSent?: (hash: Hex, path: ExecutionPath) => void;
  inline?: boolean;
}) {
  const { address, chainId } = useConnection();
  const connectors = useConnectors();
  const connect = useConnect();
  const send = useSendTransaction();
  const switchChain = useSwitchChain();
  const sponsored = useSponsoredWrite();
  const headers = useAuthHeaders();

  const [current, setCurrent] = useState<WriteRequest | null>(request ?? null);
  const prep = useMemo<Preparer | null>(() => preparer ?? (current ? requestPreparer(current) : null), [preparer, current]);
  const [state, setState] = useState<ApprovalState | null>(null);
  const [target, setTarget] = useState<TargetFacts | null>(null);
  const [explanation, setExplanation] = useState<WriteExplanation | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editArgs, setEditArgs] = useState<string[]>([]);
  const [editValue, setEditValue] = useState("0");
  const [historyThread, setHistoryThread] = useState<string | null>(threadId ?? null);
  const evOrigin = request ? (request.origin ?? origin) : origin;

  const log = useCallback(
    async (kind: WriteEventKind, p: PreparedWrite, extra: { path?: ExecutionPath; txHash?: string; outcome?: string } = {}) => {
      // History is per signed-in user; without a session there is nothing to append to.
      const auth = headers();
      if (!auth.Authorization) return;
      try {
        const r = await fetch("/api/agent/write-events", {
          method: "POST",
          headers: { "content-type": "application/json", ...auth },
          body: JSON.stringify({ threadId: historyThread, event: writeEventFromKit(kind, p, evOrigin, extra) }),
        });
        const j = await r.json().catch(() => ({}));
        if (j.threadId) setHistoryThread(j.threadId);
      } catch {
        /* history is best-effort; it never blocks the dialog */
      }
    },
    [headers, historyThread, evOrigin],
  );

  const runPrepare = useCallback(
    async (p: Preparer, reason: "open" | "edited" | "refresh") => {
      setLoading(true);
      setError(null);
      try {
        const out = await p((address as Address | undefined) ?? null);
        setTarget(out.target);
        setExplanation(out.explanation);
        setState((prev) => (prev && reason !== "open" ? replacePrepared(prev, out.prepared) : initialApproval(out.prepared)));
        if (reason !== "refresh") void log(reason === "edited" ? "edited" : "prepared", out.prepared);
      } catch (e) {
        setError((e as Error).message || "could not simulate this call");
      } finally {
        setLoading(false);
      }
    },
    [address, log],
  );

  // Prepare on open, and re-simulate whenever the connected wallet changes, so
  // what the user approves was always simulated from their own address.
  const opened = useRef(false);
  useEffect(() => {
    if (!prep) return;
    void runPrepare(prep, opened.current ? "refresh" : "open");
    opened.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  const connected = (address as Address | undefined) ?? null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(t);
  }, []);
  const blockers = useMemo(() => (state ? approvalBlockers(state, connected, now) : []), [state, connected, now]);

  const signer: Signer = useMemo(
    () => ({
      sendTransaction: async (tx) => {
        if (chainId !== citrate.id) await switchChain.mutateAsync({ chainId: citrate.id });
        // The wallet shows its own confirmation; the user signs there.
        return (await send.mutateAsync({ to: tx.to, data: tx.data, value: tx.value, chainId: citrate.id, gas: tx.gas })) as Hex;
      },
      sponsor: async (tx) => {
        // The wallet asks the user to sign the EIP-712 ForwardRequest; the relayer pays gas.
        const h = await sponsored.sponsor({ to: tx.to, data: tx.data, value: 0n });
        if (!h) throw new Error(sponsored.error ?? "The gasless relay did not accept the request.");
        return h as Hex;
      },
    }),
    [chainId, send, switchChain, sponsored],
  );

  // Runs inside the Approve button's click handler, so kit approveWrite sees the user gesture.
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
    onSent?.(s.txHash, s.path);
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
    setEditArgs(state.prepared.args.map((a) => editableValue(a.value)));
    setEditValue(formatEther(state.prepared.value));
    setEditing(true);
  };

  const onResimulate = async () => {
    if (!state || !current) return;
    const next: WriteRequest = {
      ...current,
      address: state.prepared.to,
      function: state.prepared.method.signature,
      args: editArgs,
      value: state.prepared.method.stateMutability === "payable" ? editValue : undefined,
    };
    setBusy(true);
    setCurrent(next);
    await runPrepare(requestPreparer(next), "edited");
    setEditing(false);
    setBusy(false);
  };

  const view = (
    <ApprovalView
      state={state}
      target={target}
      explanation={explanation}
      connected={connected}
      blockers={blockers}
      loading={loading}
      error={error}
      busy={busy}
      editable={!!current && !preparer}
      editing={editing}
      editArgs={editArgs}
      editValue={editValue}
      relayAvailable={Boolean(PROJECT_ADDRESSES.forwarder)}
      onTyped={(v) => state && setState(setTyped(state, v))}
      onAck={(code, on) => state && setState(setAcknowledged(state, code, on))}
      onPath={(p) => state && setState(setPath(state, p))}
      onApprove={onApprove}
      onReject={onReject}
      onEdit={onEdit}
      onEditArg={(i, v) => setEditArgs((a) => a.map((x, j) => (j === i ? v : x)))}
      onEditValue={setEditValue}
      onResimulate={onResimulate}
      onCancelEdit={() => setEditing(false)}
      onConnect={() => connectors[0] && connect.mutate({ connector: connectors[0] })}
      onClose={onClose}
      onOpenTx={onOpenTx}
    />
  );
  if (inline) {
    return (
      <div className="cx cx-approval inline">
        <div className="cx-modal">{view}</div>
      </div>
    );
  }
  return (
    <div className="cx cx-approval">
      <div className="cx-scrim" role="presentation" onClick={busy ? undefined : onClose}>
        <div className="cx-modal" onClick={(e) => e.stopPropagation()}>
          {view}
        </div>
      </div>
    </div>
  );
}

/** The chat card for a `prepare_write` result (the agent's wire PreparedWrite, executable: false). */
export function PreparedWriteCard({
  output,
  threadId,
  onOpenTx,
}: {
  output: { prepared?: WirePreparedWrite; request?: WriteRequest; explanation?: WriteExplanation };
  threadId?: string | null;
  onOpenTx?: (hash: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const p = output?.prepared;
  if (!p || !output.request) return null;
  const high = p.risk.flags.filter((f) => f.severity === "high").length;
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
      <div className="cx cx-approval inline">
        <div className="cx-modal">
          <h3>Review transaction</h3>
          <div className="cx-result bad">{parsed.error}</div>
        </div>
      </div>
    );
  }
  const { v: _v, ...request } = parsed.request;
  void _v;
  return <ApprovalDialog request={request} inline onClose={onDone} onOpenTx={onOpenTx} />;
}
