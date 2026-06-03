"use client";

/**
 * Live-data adapter — bridges the design's sample-data screens to the real S-1
 * backend. Each hook fetches a route and returns live values, or `null` when the
 * backend is unreachable / unprovisioned so the caller falls back to the design's
 * sample data (the approved fallback). Deeper per-entity wiring (tx/address/
 * contract/DAG topology) lands as the S-2 backend fills in decoded/indexed data.
 *
 * Data source (Rule 11): the real `/api/*` routes; null on failure (never faked).
 */
import { useEffect, useState } from "react";

export interface LiveChain {
  chainId: number;
  height: number;
  blueScore: number;
  tipsCount: number;
}

/** Real GHOSTDAG status from `/api/dag` (maps dagOverview → chain badge fields). */
export function useLiveChain(): LiveChain | null {
  const [data, setData] = useState<LiveChain | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/dag")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j || j.error) return;
        setData({
          chainId: 40204,
          height: Number(j.height ?? 0),
          blueScore: Number(j.maxBlueScore ?? 0),
          tipsCount: Number(j.tipsCount ?? 0),
        });
      })
      .catch(() => {
        /* offline / unprovisioned → caller keeps sample data */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return data;
}
