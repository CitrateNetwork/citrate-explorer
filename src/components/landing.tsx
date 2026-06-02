"use client";

import { useState } from "react";

/**
 * Minimal functional landing — an omni-search box + live chain status. This is a
 * thin placeholder that exercises the real backend (`/api/search`, `/api/dag`);
 * the design team's prototype (see DESIGN_BRIEF.md) replaces the visual layer.
 */
export function Landing() {
  const [q, setQ] = useState("");
  const [result, setResult] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`);
      setResult(await res.json());
    } catch (err) {
      setResult({ error: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 gap-8">
      <div className="text-center">
        <h1 className="text-4xl font-semibold tracking-tight">CitrateScan</h1>
        <p className="text-[var(--muted)] mt-2 max-w-xl">
          AI-native explorer for the Citrate Network — a GHOSTDAG BlockDAG (chain
          40204). Ask in plain English; we read the chain and explain.
        </p>
      </div>

      <form onSubmit={onSearch} className="w-full max-w-2xl flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search address / tx hash / block, or ask a question…"
          className="mono flex-1 rounded-xl bg-white/5 border border-white/10 px-4 py-3 outline-none focus:border-[var(--accent)]"
          aria-label="Omni-search"
        />
        <button
          type="submit"
          className="rounded-xl px-5 py-3 font-medium text-black"
          style={{ background: "var(--accent)" }}
          disabled={loading}
        >
          {loading ? "…" : "Search"}
        </button>
      </form>

      {result != null && (
        <pre className="mono w-full max-w-2xl overflow-auto rounded-xl bg-black/40 border border-white/10 p-4 text-xs text-[var(--foreground)]">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}

      <p className="text-xs text-[var(--muted)]">
        Scaffold build · S-1 (indexer + AI agent) in progress · see DESIGN_BRIEF.md
      </p>
    </main>
  );
}
