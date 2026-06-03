// @ts-nocheck
/* eslint-disable */
"use client";

// scan-components.jsx — shared primitives. Navigation + agent via useScan().
import { useState, useEffect, useRef, useMemo, useCallback, Fragment } from "react";
import { SD } from "@/scan/data";
import { SH } from "@/scan/harness";
import { Icon } from "@/scan/icons";
import { useLiveChain } from "@/scan/live";
import { useScan } from "@/scan/context";

// ---- copy button ----
export function CopyBtn({ text, size = 14 }) {
  const [done, setDone] = useState(false);
  return (
    <button className="copyb" title="Copy" onClick={(e) => {
      e.stopPropagation();
      try { navigator.clipboard.writeText(text); } catch (x) {}
      setDone(true); setTimeout(() => setDone(false), 1100);
    }}><Icon name={done ? "check" : "copy"} size={size} /></button>
  );
}

// ---- entity chip — the system rule for hashes/addresses ----
export function EntityChip({ value, kind, label, showLabel = true, mono = true, noMenu = false }) {
  const scan = useScan();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const lab = label || (SD.labelOf(value) ? SD.labelOf(value).label : null);
  const display = showLabel && lab ? lab : SD.short(value);
  const route = kind === "tx" ? `tx/${value}` : kind === "block" ? `block/${value}` :
    kind === "token" ? `token/${value}` : kind === "contract" ? `contract/${value}` : `address/${value}`;

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const isLabelled = showLabel && !!lab;
  return (
    <span className="chip-wrap" ref={ref} style={{ position: "relative", display: "inline-flex" }}>
      <span className={"chip" + (isLabelled ? " labelled" : "")} style={mono && !isLabelled ? null : null}
        onClick={(e) => { e.stopPropagation(); scan.nav(route); }}
        onContextMenu={(e) => { if (!noMenu) { e.preventDefault(); setOpen(!open); } }}>
        {kind === "tx" && <span className="ic"><Icon name="link" size={12} /></span>}
        <span className={isLabelled ? "lab" : ""}>{display}</span>
      </span>
      {!noMenu && (
        <button className="copyb" style={{ width: 18, height: 18 }} onClick={(e) => { e.stopPropagation(); setOpen(!open); }} aria-label="Entity menu">
          <Icon name="chevdown" size={12} />
        </button>
      )}
      {open && (
        <div className="chip-menu">
          <button onClick={() => { scan.nav(route); setOpen(false); }}><span className="ic"><Icon name="arrowright" size={15} /></span> Open</button>
          <button onClick={() => { try { navigator.clipboard.writeText(value); } catch (x) {} setOpen(false); }}><span className="ic"><Icon name="copy" size={15} /></span> Copy {kind === "tx" ? "hash" : "address"}</button>
          <div className="div" />
          <button onClick={() => { scan.ask(kind === "tx" ? "tx" : "explain", display); setOpen(false); }}><span className="ic"><Icon name="spark" size={15} /></span> Explain</button>
          <button onClick={() => { scan.ask(kind === "tx" ? "tx" : "explain", display); setOpen(false); }}><span className="ic"><Icon name="lattice" size={15} /></span> Ask about this</button>
        </div>
      )}
    </span>
  );
}

// ---- status dot ----
export function StatusDot({ status }) {
  const map = { success: "Success", failed: "Failed", pending: "Pending" };
  return <span className={"stat " + status}><span className="d" />{map[status] || status}</span>;
}

// ---- action chip (decoded action leads the row) ----
export function ActionChip({ kind, label }) {
  const icon = { swap: "swap", transfer: "send", mint: "spark", anchor: "link" }[kind] || "cube";
  return <span className={"act " + kind}><span className="ic"><Icon name={icon} size={13} /></span>{label}</span>;
}

// ---- finality badge (depth-based, never "confirmations") ----
export function FinalityBadge({ blueScore }) {
  const f = SH.finality(blueScore);
  if (f.state === "pending") return <span className="badge amber"><span className="d" /> Pending</span>;
  if (f.state === "final") return <span className="badge green" title={`Depth ${f.depth} ≥ ${f.threshold}`}><Icon name="shieldCheck" size={12} /> Finalized</span>;
  const pct = Math.min(100, Math.round((f.depth / f.threshold) * 100));
  return (
    <span className="finality" title={`current blue_score − block blue_score = ${f.depth}`}>
      <span className="badge amber">Finalizing</span>
      <span className="meter"><i style={{ width: pct + "%" }} /></span>
      <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{f.depth}/{f.threshold}</span>
    </span>
  );
}

// ---- SummaryCard — signature component ----
export function SummaryCard({ label = "What happened", text, compact, status, foot, seed, warming, verbosity = "full" }) {
  const scan = useScan();
  const [warm, setWarm] = useState(warming);
  useEffect(() => {
    if (!warming) return;
    const t = setTimeout(() => setWarm(false), 2200);
    return () => clearTimeout(t);
  }, [warming]);
  const body = typeof text === "object" ? (verbosity === "short" ? text.short : text.full) : text;
  return (
    <div className="summary">
      <div className="summary-h">
        <span className="spark"><Icon name="spark" size={17} /></span>
        <span className="lbl">{label}</span>
        <span className="spacer" />
        {warm && <span className="badge amber" style={{ height: 20 }}><span className="d" /> Summary warming</span>}
      </div>
      {warm ? (
        <div className="summary-body">
          <div className="shimmer-line" style={{ width: "94%" }} />
          <div className="shimmer-line" style={{ width: "78%" }} />
          <div className="note info" style={{ marginTop: 12 }}><span className="ic"><Icon name="info" size={15} /></span> The summary model is coming online — the raw on-chain data below is ready now.</div>
        </div>
      ) : (
        <Fragment>
          <div className={"summary-body" + (compact ? " compact" : "")}>{body}</div>
          <div className="summary-foot">
            {foot}
            <button className="ask-cta" onClick={() => scan.ask(seed || "explain", label)}>
              <span className="ic"><Icon name="spark" size={14} /></span> Ask the agent
            </button>
          </div>
        </Fragment>
      )}
    </div>
  );
}

// ---- tabs ----
export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={active === t.id}
          className={"tab" + (active === t.id ? " active" : "") + (t.raw ? " raw" : "")}
          onClick={() => onChange(t.id)}>
          {t.label}{t.count != null && <span className="cnt">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ---- key/value ----
export function KV({ k, v, mono, green, children }) {
  return <div className="kv"><span className="k">{k}</span><span className={"v" + (mono ? " mono" : "") + (green ? " green" : "")}>{children || v}</span></div>;
}

// ---- global banners ----
export function Banners({ states, dismiss }) {
  const [idxProg, setIdxProg] = useState(40);
  useEffect(() => {
    if (!states.indexer) return;
    const t = setInterval(() => setIdxProg((p) => Math.min(100, p + 6)), 1200);
    return () => clearInterval(t);
  }, [states.indexer]);
  return (
    <div className="banners">
      {states.rpc && (
        <div className="gbanner rpc">
          <span className="ic"><Icon name="refresh" size={15} /></span>
          <span>RPC reconnecting — pages stay readable from cache. The live tick will resume automatically.</span>
          <span className="spacer" />
          <button className="x" onClick={() => dismiss("rpc")}><Icon name="x" size={14} /></button>
        </div>
      )}
      {states.indexer && (
        <div className="gbanner indexer">
          <span className="ic"><Icon name="database" size={15} /></span>
          <span>Indexer is ~{Math.round((100 - idxProg) * 1.2)} blocks behind the tip — newest activity may be a moment late.</span>
          <span className="prog"><i style={{ width: idxProg + "%" }} /></span>
          <span className="spacer" />
          <button className="x" onClick={() => dismiss("indexer")}><Icon name="x" size={14} /></button>
        </div>
      )}
    </div>
  );
}

// ---- chain badge (header) ----
export function ChainBadge({ rpc }) {
  const live = useLiveChain();
  const [bs, setBs] = useState(SD.CHAIN.blueScore);
  // Seed from the real chain when /api/dag responds; else keep the sample value.
  useEffect(() => {
    if (live && live.blueScore > 0) setBs(live.blueScore);
  }, [live]);
  useEffect(() => {
    if (rpc) return;
    const t = setInterval(() => setBs((b) => b + Math.floor(1 + Math.random() * 2)), 2600);
    return () => clearInterval(t);
  }, [rpc]);
  return (
    <div className="chainbadge" aria-live="polite">
      <span className={"dot" + (rpc ? " red" : "")} />
      <span className="k">{rpc ? "reconnecting" : "live"}</span>
      <span className="sep" />
      <span className="k">chain</span><span className="v">{SD.CHAIN.chainId}</span>
      <span className="sep" />
      <span className="k">blue_score</span><span className="v tabular">{bs.toLocaleString()}</span>
    </div>
  );
}

// ---- breadcrumb ----
export function Crumb({ items }) {
  const scan = useScan();
  return (
    <div className="crumb">
      {items.map((it, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="sl">/</span>}
          {it.route ? <a onClick={() => scan.nav(it.route)} style={{ cursor: "pointer" }}>{it.label}</a> : <span>{it.label}</span>}
        </Fragment>
      ))}
    </div>
  );
}

// ---- gasless foot pill ----
export function GaslessPill() {
  return <span className="badge green" title="No native paymaster — EIP-2771 forwarder + Foundation relayer"><Icon name="bolt" size={12} /> Gas paid by Foundation</span>;
}
