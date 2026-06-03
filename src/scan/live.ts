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
import { useEffect, useState } from "react";
import { SD } from "./data";

/** Demo mode keeps the rich sample as the fallback. Set NEXT_PUBLIC_DEMO=0 in prod. */
export const DEMO = process.env.NEXT_PUBLIC_DEMO !== "0";

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

export function useLiveAddress(addr: string) {
  const { data, loading, error } = useFetch<any>(addr ? `/api/address/${addr}` : null);
  if (!data || data.error) return { data: null, loading, error };
  const lbl = labelOf(addr);
  const activity = data.activity && data.activity.provisioned ? data.activity : null;
  const txCount = activity ? activity.sent + activity.received : Number(data.nonce ?? 0);
  return {
    data: {
      addr,
      label: lbl ? lbl.label : null,
      isContract: Boolean(data.isContract),
      balanceSalt: data.balanceSalt ?? "0",
      txCount,
      firstSeen: "—",
      summary:
        `This address holds ${data.balanceSalt ?? "0"} SALT` +
        `${data.isContract ? " and is a contract" : ""}. ` +
        `${activity ? `${txCount} transactions indexed.` : "Transaction history appears here as the indexer catches up."}`,
      txns: [],
      tokens: [],
      _live: true,
    },
    loading,
    error,
  };
}
