// @ts-nocheck
/* eslint-disable */
"use client";

// Shared loading / error states for live-wired screens (P-1). Uses the design's
// existing `.wrap` + `.empty` vocabulary so they sit naturally in the layout.
import { Icon } from "@/scan/icons";

export function ScreenLoading({ label = "Loading…" }) {
  return (
    <div className="wrap">
      <div className="empty" aria-busy="true" aria-live="polite">
        <div className="ic" style={{ opacity: 0.6 }}><Icon name="lattice" size={28} /></div>
        <h3>{label}</h3>
        <p>Reading the chain.</p>
      </div>
    </div>
  );
}

export function ScreenError({ error, onRetry }) {
  return (
    <div className="wrap">
      <div className="empty" role="alert">
        <div className="ic" style={{ color: "var(--danger)" }}><Icon name="info" size={28} /></div>
        <h3>Could not load this from the chain</h3>
        <p>{error || "The node did not respond."}</p>
        {onRetry && (
          <button className="btn sm" style={{ marginTop: 12 }} onClick={onRetry}>
            <Icon name="refresh" size={14} /> Try again
          </button>
        )}
      </div>
    </div>
  );
}
