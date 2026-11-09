"use client";

/**
 * Client reads for the direction-B screens. Each hook fetches one of the
 * explorer's own read routes and returns { data, error, loading }. There is no
 * sample fallback: on failure the screen shows the error (Rule 1).
 *
 * Data source (Rule 7): /api/ledger, /api/blocks/[id], /api/tx/[hash],
 * /api/address/[addr], which read live Citrate RPC and the indexer.
 */
import { useEffect, useState } from "react";
import type { LedgerSnapshot } from "@/lib/citrate/ledger";
import type { BlockR1007, TxR1007 } from "@/lib/citrate/r1007Reads";

export interface Fetched<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

export function useJson<T>(url: string | null, refreshMs = 0): Fetched<T> {
  const [state, setState] = useState<Fetched<T>>({ data: null, error: null, loading: !!url });
  useEffect(() => {
    if (!url) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setState((s) => ({ data: s.data, error: null, loading: true }));
    const load = async () => {
      try {
        const r = await fetch(url);
        const j = (await r.json().catch(() => null)) as (T & { error?: string }) | null;
        if (cancelled) return;
        if (!r.ok || !j || j.error) {
          setState((s) => ({ data: s.data, error: (j && j.error) || `HTTP ${r.status}`, loading: false }));
        } else {
          setState({ data: j, error: null, loading: false });
        }
      } catch (e) {
        if (!cancelled) setState((s) => ({ data: s.data, error: (e as Error).message, loading: false }));
      }
      if (!cancelled && refreshMs > 0 && (typeof document === "undefined" || !document.hidden)) {
        timer = setTimeout(load, refreshMs);
      } else if (!cancelled && refreshMs > 0) {
        timer = setTimeout(load, refreshMs * 3);
      }
    };
    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [url, refreshMs]);
  return state;
}

export type LedgerResponse = LedgerSnapshot & { _stale?: boolean; _ageMs?: number };

/** The network snapshot, refreshed every 5 s. */
export function useLedger(heights = 40): Fetched<LedgerResponse> {
  return useJson<LedgerResponse>(`/api/ledger?heights=${heights}`, 5000);
}

export interface BlockResponse {
  hash: string;
  height: number;
  blueScore: number;
  blueWork: string;
  timestamp: number;
  selectedParent: string;
  mergeParents: string[];
  proposer: string | null;
  miner: string | null;
  gasUsed: number;
  gasLimit: number;
  baseFeePerGas: string | null;
  txCount: number;
  transactions: Array<{ hash: string; from: string; to: string | null; valueSalt?: string; methodId?: string | null }>;
  r1007?: BlockR1007;
}

export function useBlock(id: string | null): Fetched<BlockResponse> {
  return useJson<BlockResponse>(id ? `/api/blocks/${encodeURIComponent(id)}` : null);
}

export interface TxResponse {
  hash: string;
  from: string;
  to: string | null;
  valueSalt: string;
  nonce: number;
  blockNumber: string | null;
  blockHash: string | null;
  status: "success" | "reverted" | "pending";
  gasUsed: string | null;
  fee: { salt: string } | null;
  input: string;
  methodId: string | null;
  timestamp: number | null;
  isCreate: boolean;
  contractAddress: string | null;
  logs: Array<{ address: string; topics: string[]; data: string; logIndex: number | null }>;
  r1007?: TxR1007;
}

export function useTx(hash: string | null): Fetched<TxResponse> {
  return useJson<TxResponse>(hash ? `/api/tx/${encodeURIComponent(hash)}` : null);
}

type NotProvisioned = { provisioned: false; note?: string };

export interface IndexedTx {
  hash: string;
  blockHash: string | null;
  blockHeight: number | null;
  from: string;
  to: string | null;
  /** wei, decimal string */
  value: string;
  status: number | null;
  methodId: string | null;
  createdContract: string | null;
  timestamp: number | null;
}

export interface AddressResponse {
  address: string;
  balanceSalt: string;
  nonce: number;
  isContract: boolean;
  codeSize: number;
  activity: NotProvisioned | { provisioned: true; sent: number; received: number; tokenSent: number; tokenReceived: number };
  recentTransactions: NotProvisioned | { provisioned: true; results: IndexedTx[] };
  tokenTransfers:
    | NotProvisioned
    | { provisioned: true; results: Array<{ txHash: string; token: string; from: string; to: string; standard: string; timestamp: number; value?: string | null; tokenId?: string | null }> };
}

export function useAddress(addr: string | null): Fetched<AddressResponse> {
  return useJson<AddressResponse>(addr ? `/api/address/${encodeURIComponent(addr)}` : null);
}
