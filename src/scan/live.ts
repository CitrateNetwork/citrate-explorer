"use client";
/* eslint-disable */

/**
 * Live-data adapter (P-1) — bridges the design's screens to the real S-1/P-1
 * backend. Each hook fetches a real `/api/*` route and maps the response into the
 * exact shape the design renders (live core fields + honest-empty rich fields
 * the indexer/agent fill later). On failure it returns `{error}`; callers fall
 * back to the design's rich sample data ONLY when demo mode is on (default for
 * now, until the indexer is provisioned) — never silently masking an outage.
 *
 * Data source (Rule 11): the real `/api/*` routes; null/error on failure.
 */
import { useEffect, useRef, useState } from "react";
import { SD } from "./data";

/**
 * Demo mode keeps the rich (fictional) sample as the fallback when a live `/api/*`
 * read fails. EX-B-007 (RM-Q, 2026-09-07): this now DEFAULTS OFF and must be
 * explicitly opted into with `NEXT_PUBLIC_DEMO=1`.
 *
 * The old default (`!== "0"`) was fail-OPEN: a Vercel project that never set the
 * var shipped with demo ON, so any RPC blip silently replaced live chain data
 * with fabricated blocks/txns/balances presented as real — violating Rule 11
 * ("no fabricated chain or DAG data") on the federation's most public surface.
 * Failing closed means an unset/other value yields honest-empty degraded states
 * instead of invented facts. `.env.example` sets `=1` for local development.
 */
export function demoEnabled(v: string | undefined = process.env.NEXT_PUBLIC_DEMO): boolean {
  return v === "1";
}
export const DEMO = demoEnabled();

const toMs = (ts: number) => (ts > 0 && ts < 1e12 ? ts * 1000 : ts);
const short = (h: string) => (SD.short ? SD.short(h) : `${h?.slice(0, 6)}…${h?.slice(-4)}`);
const labelOf = (a: string) => (SD.labelOf ? SD.labelOf(a) : null);

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

function useFetch<T = any>(url: string | null): FetchState<T> {
  const [state, setState] = useState<FetchState<T>>({ data: null, loading: !!url, error: null });
  useEffect(() => {
    if (!url) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetch(url)
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (cancelled) return;
        if (!r.ok || (j && j.error)) {
          setState({ data: null, loading: false, error: (j && j.error) || `HTTP ${r.status}` });
        } else {
          setState({ data: j as T, loading: false, error: null });
        }
      })
      .catch((e) => {
        if (!cancelled) setState({ data: null, loading: false, error: (e as Error).message });
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return state;
}

// --- chain status (home card) ----------------------------------------------

export interface LiveChain {
  chainId: number;
  height: number;
  blueScore: number;
  tipsCount: number;
}

/** Real GHOSTDAG status from /api/dag. Returns null until loaded / on error. */
export function useLiveChain(): LiveChain | null {
  const { data } = useFetch<any>("/api/dag");
  if (!data || data.error) return null;
  return {
    chainId: 40204,
    height: Number(data.height ?? 0),
    blueScore: Number(data.maxBlueScore ?? 0),
    tipsCount: Number(data.tipsCount ?? 0),
  };
}

/** Home chain-status card shape ({network, chainId, blueScore, height}). */
export function useLiveChainStatus() {
  const { data, loading, error } = useFetch<any>("/api/dag");
  const mapped =
    data && !data.error
      ? {
          network: "Citrate testnet",
          chainId: 40204,
          blueScore: Number(data.maxBlueScore ?? 0),
          height: Number(data.height ?? 0),
        }
      : null;
  return { data: mapped, loading, error };
}

// --- latest blocks + txns (home) -------------------------------------------

function kindOf(tx: { isCreate?: boolean; valueSalt?: string; to?: string | null }) {
  if (tx.isCreate) return "deploy";
  if (tx.valueSalt && Number(tx.valueSalt) > 0) return "transfer";
  return "call";
}
function actionOf(tx: { isCreate?: boolean; valueSalt?: string; to?: string | null }) {
  if (tx.isCreate) return "Contract creation";
  if (tx.valueSalt && Number(tx.valueSalt) > 0) return `Send ${tx.valueSalt} SALT`;
  return tx.to ? `Call ${short(tx.to)}` : "Call";
}

export function useLiveLatest(n = 6) {
  const { data, loading, error } = useFetch<any>(`/api/latest?n=${n}`);
  if (!data || data.error) return { blocks: null, txns: null, loading, error };
  const blocks = (data.blocks ?? []).map((b: any) => ({
    hash: b.hash,
    height: b.height,
    blueScore: b.blueScore,
    blue: true,
    txCount: b.txCount,
    validator: b.proposer ? short(b.proposer) : "—",
    timestamp: toMs(b.timestamp),
  }));
  const txns = (data.transactions ?? []).map((t: any) => ({
    hash: t.hash,
    shortHash: short(t.hash),
    kind: kindOf(t),
    action: actionOf(t),
    from: t.from,
    status: "success",
    age: SD.fmtAge ? SD.fmtAge(toMs(t.timestamp)) : "",
  }));
  return { blocks, txns, loading, error };
}

// --- live DAG stream (P-5) --------------------------------------------------

/** Maps a stream vertex into the exact shape DagGraph renders. */
function toDagNode(v: any, tipSet: Set<string>, isNew = false) {
  return {
    hash: v.hash,
    height: v.height,
    blueScore: v.blueScore,
    blue: true, // canonical-chain blocks are blue; the node exposes no red set yet
    txCount: v.txCount ?? 0,
    selectedParent: v.selectedParent || null,
    mergeParents: v.mergeParents || [],
    mergeSet: (v.mergeParents || []).length + 1,
    validator: v.proposer ? short(v.proposer) : "—",
    timestamp: toMs(v.timestamp),
    tips: tipSet.size ? tipSet.has(v.hash) : false,
    _new: isNew,
  };
}

/** Recompute tips across the set: by currentTips when known, else the top block. */
function markTips(nodes: any[], tipSet: Set<string>) {
  if (!nodes.length) return nodes;
  if (tipSet.size) return nodes.map((n) => ({ ...n, tips: tipSet.has(n.hash) }));
  const topBs = Math.max(...nodes.map((n) => n.blueScore));
  return nodes.map((n) => ({ ...n, tips: n.blueScore === topBs }));
}

export type DagStreamStatus = "connecting" | "live" | "paused" | "reconnecting";

/**
 * Subscribes to the real DAG stream (`/api/dag/stream`, SSE). Returns a windowed,
 * newest-first node list in the renderer's shape, the live stats, and the
 * connection status. `pause()` closes the socket; `resume()` reopens it. The
 * browser reconnects EventSource natively, surfaced here as "reconnecting".
 */
export function useDagStream(windowN = 16) {
  const [nodes, setNodes] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [status, setStatus] = useState<DagStreamStatus>("connecting");
  const [paused, setPaused] = useState(false);
  const tipsRef = useRef<Set<string>>(new Set());
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (paused) return;
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;
    setStatus("connecting");
    const es = new EventSource("/api/dag/stream");
    esRef.current = es;

    es.addEventListener("snapshot", (e: MessageEvent) => {
      const d = JSON.parse(e.data);
      const tips = new Set<string>((d.stats?.tips ?? []) as string[]);
      tipsRef.current = tips;
      setStats(d.stats ?? null);
      setNodes(markTips((d.blocks ?? []).map((v: any) => toDagNode(v, tips)), tips).slice(0, windowN));
      setStatus("live");
    });

    es.addEventListener("block", (e: MessageEvent) => {
      const v = JSON.parse(e.data);
      setNodes((prev) => {
        if (prev.some((n) => n.hash === v.hash)) return prev;
        const fresh = [toDagNode(v, tipsRef.current, true), ...prev.map((n) => ({ ...n, _new: false }))];
        return markTips(fresh, tipsRef.current).slice(0, windowN);
      });
      setStatus("live");
    });

    es.addEventListener("status", (e: MessageEvent) => {
      const s = JSON.parse(e.data);
      const tips = new Set<string>((s.tips ?? []) as string[]);
      tipsRef.current = tips;
      setStats(s);
      setNodes((prev) => markTips(prev, tips));
      setStatus("live");
    });

    es.onerror = () => {
      // EventSource auto-reconnects; reflect the gap until the next message.
      setStatus("reconnecting");
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [paused, windowN]);

  const pause = () => {
    esRef.current?.close();
    esRef.current = null;
    setPaused(true);
    setStatus("paused");
  };
  const resume = () => setPaused(false);

  return { nodes, stats, status, paused, pause, resume };
}

// --- single entities --------------------------------------------------------

export function useLiveBlock(id: string) {
  const { data, loading, error } = useFetch<any>(id ? `/api/blocks/${id}` : null);
  // FINDINGS-001: the live RPC exposes no per-block blue_score / merge parents,
  // so we can't render the DAG-native block view truthfully. Until the chain
  // adds it, fall back to the rich demo block (demo mode) instead of showing
  // blue_score 0. Activates automatically once the node returns a real blue_score.
  if (!data || data.error || !data.blueScore) return { data: null, loading, error };
  return {
    data: {
      hash: data.hash,
      height: data.height,
      blueScore: data.blueScore,
      blue: true,
      txCount: data.txCount,
      selectedParent: data.selectedParent || null,
      mergeParents: data.mergeParents || [],
      mergeSet: (data.mergeParents || []).length + 1,
      validator: data.proposer ? short(data.proposer) : "—",
      timestamp: toMs(data.timestamp),
      size: data.gasLimit ? Math.round(data.gasUsed / 1024) : 0,
      tips: false,
      _live: true,
    },
    loading,
    error,
  };
}

export function useLiveTx(hash: string) {
  const { data, loading, error } = useFetch<any>(hash ? `/api/tx/${hash}` : null);
  if (!data || data.error) return { data: null, loading, error };
  const status = data.status === "reverted" ? "failed" : data.status; // success|failed|pending
  const valueSalt = data.valueSalt ?? "0";
  const kind = data.isCreate ? "deploy" : Number(valueSalt) > 0 ? "transfer" : "call";
  const summaryLine =
    `${status === "failed" ? "Failed" : status === "pending" ? "Pending"  : "Confirmed"} ` +
    `${kind} from ${labelOf(data.from)?.label || short(data.from)} ` +
    `${data.to ? `to ${labelOf(data.to)?.label || short(data.to)}` : "(contract creation)"}` +
    `${Number(valueSalt) > 0 ? ` moving ${valueSalt} SALT` : ""}. ` +
    `Ask the agent for a full plain-English explanation.`;
  return {
    data: {
      hash: data.hash,
      shortHash: short(data.hash),
      status,
      kind,
      from: data.from,
      to: data.to,
      blockHeight: data.blockNumber ? Number(data.blockNumber) : null,
      blueScore: data.blueScore ?? null,
      timestamp: data.timestamp ? toMs(data.timestamp) : null,
      nonce: data.nonce,
      gasUsed: data.gasUsed ? Number(data.gasUsed) : null,
      gasPaidBy: null,
      valueSalt,
      summary: { short: summaryLine, full: summaryLine },
      // Always non-null so the Overview renders safely; no ABI yet, so args empty.
      decoded: { fn: data.methodId || "—", args: [] },
      transfers: [],
      internal: [],
      logs: [],
      stateDiff: [],
      _live: true,
    },
    loading,
    error,
  };
}

/** Pure map from the `/api/address/[addr]` response to the address view model. Exported so the
 *  relayer-funded-recipient coverage (token_transfers → activity + holdings) is unit-testable without
 *  a fetch/render. Returns null when the response is absent/errored. */
export function deriveAddressView(addr: string, data: any): any | null {
  if (!data || data.error) return null;
  const lbl = labelOf(addr);
  const a = addr.toLowerCase();
  const activity = data.activity && data.activity.provisioned ? data.activity : null;
  // A relayer-funded member (nonce 0) is NEVER a tx `from`/`to` — the relayer/contract are — so its real
  // history lives in token_transfers (the SBT mint, a grant receipt). Surface those so the address
  // resolves with true activity + holdings instead of reading as an empty/unknown page.
  const tts: any[] = data.tokenTransfers && data.tokenTransfers.provisioned ? data.tokenTransfers.results : [];
  const txActivity = activity ? activity.sent + activity.received : 0;
  const tokenActivity = activity ? (activity.tokenSent ?? 0) + (activity.tokenReceived ?? 0) : tts.length;
  const txCount = txActivity + tokenActivity || Number(data.nonce ?? 0);
  const ZERO = "0x0000000000000000000000000000000000000000";
  const txns = tts.map((t) => {
    const isIn = (t.to ?? "").toLowerCase() === a;
    const isMint = (t.from ?? "").toLowerCase() === ZERO;
    const action = t.standard === "erc721" ? (isMint ? "NFT mint" : "NFT transfer") : "Token transfer";
    return {
      dir: isIn ? "in" : "out",
      kind: "token",
      action,
      hash: t.txHash,
      shortHash: short(t.txHash),
      counter: isIn ? t.from : t.to,
      status: 1,
      age: SD.fmtAge ? SD.fmtAge(toMs(t.timestamp)) : "",
    };
  });
  // Holdings from indexed transfers — ERC-721 only (count of NFTs held). A full ERC-20 balance rollup is
  // deferred (S-2), so we do NOT infer ERC-20 balances from transfer counts (Rule 1: no fabricated figure).
  const nft = new Map<string, { token: string; net: number }>();
  for (const t of tts) {
    if (t.standard !== "erc721") continue;
    const isIn = (t.to ?? "").toLowerCase() === a;
    const h = nft.get(t.token) || { token: t.token, net: 0 };
    h.net += isIn ? 1 : -1;
    nft.set(t.token, h);
  }
  const tokens = [...nft.values()]
    .filter((h) => h.net > 0)
    .map((h) => {
      const tl = labelOf(h.token);
      return { token: h.token, sym: tl ? tl.label : "NFT", name: tl ? tl.label : short(h.token), balance: String(h.net) };
    });
  const holdingsNote = tokens.length ? ` Holds ${tokens.map((t) => `${t.balance} ${t.sym}`).join(", ")}.` : "";
  return {
    addr,
    label: lbl ? lbl.label : null,
    isContract: Boolean(data.isContract),
    balanceSalt: data.balanceSalt ?? "0",
    txCount,
    firstSeen: "—",
    summary:
      `This address holds ${data.balanceSalt ?? "0"} SALT` +
      `${data.isContract ? " and is a contract" : ""}.` +
      holdingsNote +
      ` ${txCount ? `${txCount} transfers/transactions indexed.` : "Transaction history appears here as the indexer catches up."}`,
    txns,
    tokens,
    _live: true,
  };
}

export function useLiveAddress(addr: string) {
  const { data, loading, error } = useFetch<any>(addr ? `/api/address/${addr}` : null);
  const view = deriveAddressView(addr, data);
  if (!view) return { data: null, loading, error };
  return { data: view, loading, error };
}
