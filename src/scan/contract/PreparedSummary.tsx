"use client";

/**
 * The facts of one kit PreparedWrite as a definition list (EXP-S3). Shared by the
 * contract page's preview and the one approval dialog (src/scan/approval-view.tsx),
 * so both show the same method, arguments, target, sender, value, gas, simulation
 * and calldata.
 */
import { formatEther } from "viem";
import type { PreparedWrite, RiskSeverity } from "@/lib/contract/kit";

export function SevTag({ sev }: { sev: RiskSeverity }) {
  return <span className={"cx-tag sev " + (sev === "high" ? "bad" : sev === "warn" ? "warn" : "info")}>{sev}</span>;
}

export function PreparedSummary({ p }: { p: PreparedWrite }) {
  return (
    <dl className="cx-kv tight">
      <div className="cx-kv-r"><dt>method</dt><dd className="mono">{p.method.signature} <span className="muted">{p.method.selector}</span></dd></div>
      {p.args.map((a) => (
        <div className="cx-kv-r" key={a.name}><dt className="mono" style={{ textTransform: "none", letterSpacing: 0 }}>{a.name}</dt><dd className="mono brk">{a.display} <span className="muted">{a.type}</span></dd></div>
      ))}
      <div className="cx-kv-r"><dt>to</dt><dd className="mono brk">{p.to}</dd></div>
      <div className="cx-kv-r"><dt>from</dt><dd className="mono brk">{p.from ?? "no wallet connected"}</dd></div>
      <div className="cx-kv-r"><dt>value</dt><dd className="mono">{formatEther(p.value)} SALT</dd></div>
      <div className="cx-kv-r"><dt>gas</dt><dd className="mono">{p.gas.estimate !== null ? p.gas.estimate.toLocaleString("en-US") : <span className="muted">{p.gas.error}</span>}</dd></div>
      <div className="cx-kv-r"><dt>simulation</dt><dd>
        {p.simulation.status === "ok" && <span className="cx-tag ok">succeeds at latest</span>}
        {p.simulation.status === "reverted" && <span className="cx-err mono">reverts: {p.simulation.revert?.message ?? p.simulation.error}</span>}
        {p.simulation.status === "unavailable" && <span className="cx-err">could not simulate: the outcome is unknown</span>}
        {p.simulation.status === "skipped" && <span className="muted">{p.simulation.reason}</span>}
      </dd></div>
      <div className="cx-kv-r"><dt>data</dt><dd><pre className="cx-pre">{p.data}</pre></dd></div>
    </dl>
  );
}
