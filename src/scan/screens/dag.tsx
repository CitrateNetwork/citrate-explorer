// @ts-nocheck
/* eslint-disable */
"use client";
// scan-dag.jsx — GHOSTDAG visualization. Honest DAG: tips, blue/red, selected vs
// merge parents, blue_score, depth-based finality. Streams new blocks at the frontier.
import React, { useState, useEffect, useRef, useMemo } from "react";
import { SD } from "@/scan/data";
import { SH } from "@/scan/harness";
import { Icon } from "@/scan/icons";
import { Crumb, EntityChip, KV, FinalityBadge } from "@/scan/components";
import { useScan } from "@/scan/context";

const DAG_REDUCED = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function buildInitialBlocks() {
  // clone sample, ensure ordering newest-first
  return SD.BLOCKS.map((b) => ({ ...b })).sort((a, b) => b.blueScore - a.blueScore);
}

function layoutDag(blocks, stepX, laneGap, padX, midY) {
  const minBS = Math.min(...blocks.map((b) => b.blueScore));
  const groups = {};
  blocks.forEach((b) => { const c = b.blueScore - minBS; (groups[c] = groups[c] || []).push(b); });
  const byHash = {};
  const nodes = blocks.map((b) => {
    const c = b.blueScore - minBS;
    const grp = groups[c];
    const lane = grp.indexOf(b);
    const n = grp.length;
    const node = { ...b, x: padX + c * stepX, y: midY + (lane - (n - 1) / 2) * laneGap, col: c };
    byHash[b.hash] = node;
    return node;
  });
  const maxCol = Math.max(...nodes.map((n) => n.col));
  return { nodes, byHash, width: padX * 2 + maxCol * stepX, minBS };
}

export function DagGraph({ blocks, height, onPick, selected, compact, streaming }) {
  const stepX = compact ? 58 : 78;
  const laneGap = compact ? 34 : 46;
  const padX = 34;
  const midY = height / 2;
  const L = useMemo(() => layoutDag(blocks, stepX, laneGap, padX, midY), [blocks, height]);
  const maxBS = SD.CHAIN.blueScore + (blocks[0] ? blocks[0].blueScore - SD.TIP_BLOCK.blueScore : 0);
  const curMax = Math.max(...blocks.map((b) => b.blueScore));

  return (
    <svg className="dag-canvas" style={{ height }} viewBox={`0 0 ${Math.max(L.width, 200)} ${height}`} preserveAspectRatio="xMaxYMid meet">
      {/* edges */}
      {L.nodes.map((n) => {
        const out = [];
        const draw = (parentHash, sel) => {
          const p = L.byHash[parentHash];
          if (!p) return;
          const mx = (p.x + n.x) / 2;
          out.push(<path key={n.hash + parentHash} className={sel ? "dag-edge-sel" : "dag-edge-mrg"}
            d={`M ${p.x} ${p.y} C ${mx} ${p.y}, ${mx} ${n.y}, ${n.x} ${n.y}`} />);
        };
        if (n.selectedParent) draw(n.selectedParent, true);
        (n.mergeParents || []).forEach((mp) => draw(mp, false));
        return out;
      })}
      {/* nodes */}
      {L.nodes.map((n) => {
        const isFinal = (curMax - n.blueScore) >= SD.CHAIN.finalityDepth;
        const r = n.tips ? (compact ? 9 : 11) : (compact ? 7 : 9);
        const fill = n.blue ? "var(--accent)" : "var(--danger)";
        const isSel = selected === n.hash;
        return (
          <g key={n.hash} className={"dag-node-g" + (n._new ? " new" : "")} onClick={() => onPick && onPick(n)} role="button" tabIndex={0}
             onKeyDown={(e) => { if (e.key === "Enter") onPick && onPick(n); }}>
            {n.tips && <circle cx={n.x} cy={n.y} r={r + 5} fill="none" stroke={fill} strokeWidth="1" opacity="0.4" />}
            {isSel && <circle className="ringhit" cx={n.x} cy={n.y} r={r + 4} fill="none" stroke="var(--accent)" strokeWidth="2" />}
            <circle className="dag-node ringhit" cx={n.x} cy={n.y} r={r}
              fill={isFinal ? fill : "var(--surface-2)"} stroke={fill} strokeWidth={isFinal ? 0 : 2} />
            {!compact && <text x={n.x} y={n.y + r + 12} textAnchor="middle">{n.height}</text>}
          </g>
        );
      })}
    </svg>
  );
}

export function DagView({ reducedMotion }) {
  const scan = useScan();
  const [blocks, setBlocks] = useState(buildInitialBlocks);
  const [stream, setStream] = useState("live"); // live | paused | recon
  const [selected, setSelected] = useState(null);
  const [linear, setLinear] = useState(false);
  const counter = useRef(0);
  const noMotion = reducedMotion || DAG_REDUCED;

  // stream new blocks at the frontier
  useEffect(() => {
    if (stream !== "live" || noMotion) return;
    const t = setInterval(() => {
      setBlocks((prev) => {
        const top = prev.reduce((a, b) => (b.blueScore > a.blueScore ? b : a), prev[0]);
        counter.current += 1;
        const isRed = counter.current % 4 === 0;
        const nb = {
          hash: "0x" + Math.random().toString(16).slice(2, 12),
          height: top.height + 1,
          blueScore: top.blueScore + (isRed ? 0 : 1),
          blue: !isRed,
          txCount: 1 + Math.floor(Math.random() * 9),
          selectedParent: top.hash,
          mergeParents: isRed ? [] : (prev[1] ? [prev[1].hash] : []),
          mergeSet: 1, validator: "ctr-val-" + (1 + Math.floor(Math.random() * 99)),
          timestamp: Date.now(), tips: true, _new: true,
        };
        const cleared = prev.map((b) => ({ ...b, tips: b.hash === top.hash && isRed ? b.tips : false, _new: false }));
        const next = [nb, ...cleared];
        // keep tips on the genuine frontier (last 2 added)
        return next.slice(0, 15);
      });
    }, 2800);
    return () => clearInterval(t);
  }, [stream, noMotion]);

  const cur = SH.tools.exploreDag().data;
  const sel = selected ? blocks.find((b) => b.hash === selected) : null;
  const ordered = [...blocks].sort((a, b) => b.blueScore - a.blueScore);

  return (
    <div className="wrap">
      <Crumb items={[{ label: "Home", route: "" }, { label: "Live DAG" }]} />
      <div className="pagehead">
        <div>
          <h1><span style={{ color: "var(--accent)" }}><Icon name="lattice" size={26} /></span> Live DAG</h1>
          <div className="sub">GHOSTDAG consensus · k={SD.CHAIN.k} · finality depth {SD.CHAIN.finalityDepth}. Ordered by blue_score, not by a single chain.</div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className={"btn sm" + (linear ? " primary" : "")} onClick={() => setLinear(!linear)}><Icon name={linear ? "list" : "lattice"} size={15} /> {linear ? "Linear view" : "DAG view"}</button>
          <button className="btn sm" onClick={() => scan.ask("dag", "the DAG")}><Icon name="spark" size={15} /> Ask about the DAG</button>
        </div>
      </div>

      <div className="card dag-card">
        <div className="card-h">
          <span className="t">Frontier</span>
          <span className="dag-legend">
            <span><i className="bl" /> blue set</span>
            <span><i className="rd" /> red (parallel)</span>
            <span><i className="sel" /> selected parent</span>
            <span><i className="mrg" /> merge parent</span>
          </span>
          <span className="spacer" />
          <span className={"dag-stream " + (stream === "live" ? "live" : stream === "paused" ? "paused" : "recon")}>
            <span className="d" />{stream === "live" ? "streaming" : stream === "paused" ? "paused" : "reconnecting"}
          </span>
          <div className="row" style={{ gap: 4, marginLeft: 10 }}>
            <button className="copyb" title={stream === "live" ? "Pause" : "Resume"} onClick={() => setStream(stream === "live" ? "paused" : "live")}><Icon name={stream === "live" ? "pause" : "play"} size={15} /></button>
            <button className="copyb" title="Simulate reconnect" onClick={() => { setStream("recon"); setTimeout(() => setStream("live"), 2600); }}><Icon name="refresh" size={15} /></button>
          </div>
        </div>
        <div className="card-bd">
          {stream === "recon" && <div className="note amber" style={{ marginBottom: 14 }}><span className="ic"><Icon name="refresh" size={15} /></span> DAG stream dropped — showing the last snapshot. Reconnecting to <span className="mono">wss://rpc.citrate.ai</span>…</div>}
          {!linear ? (
            <div style={{ overflowX: "auto" }}>
              <DagGraph blocks={ordered} height={260} onPick={(n) => setSelected(n.hash)} selected={selected} streaming={stream === "live"} />
            </div>
          ) : (
            <div className="dag-list">
              <div className="note info" style={{ marginBottom: 12 }}><span className="ic"><Icon name="info" size={15} /></span> Linear fallback — the selected-parent chain rendered as a familiar block list. The DAG's true width is collapsed to one column.</div>
              {ordered.filter((b) => b.blue).map((b) => (
                <div className="r" key={b.hash} style={{ cursor: "pointer" }} onClick={() => scan.nav(`block/${b.hash}`)}>
                  <span className="mono" style={{ color: "var(--accent-text)" }}>#{b.height}</span>
                  <EntityChip value={b.hash} kind="block" noMenu />
                  <span className="mono" style={{ color: "var(--text-3)", fontSize: 12 }}>{b.txCount} txns</span>
                </div>
              ))}
            </div>
          )}
          <div className="row" style={{ justifyContent: "space-between", marginTop: 14, flexWrap: "wrap", gap: 10 }}>
            <div className="dag-tipline">Tips: <b>{ordered.filter((b) => b.tips).map((b) => "#" + b.height).join(", ") || "—"}</b> · selected parent <b>#{ordered.find((b) => b.blue).height}</b> · max blue_score <b>{cur.maxBlueScore.toLocaleString()}</b></div>
            <div className="dag-tipline" style={{ color: "var(--text-3)" }}>Illustrative testnet sample — live queries wire through <span className="mono">exploreDag()</span> → <span className="mono">citrate_getDagStats</span>.</div>
          </div>
        </div>
      </div>

      {/* selected block detail + a11y list */}
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 18 }}>
        <div className="card">
          <div className="card-h"><span className="t">Selected block</span><span className="spacer" />{sel && <button className="btn sm ghost" onClick={() => scan.nav(`block/${sel.hash}`)}>Open block <Icon name="arrowright" size={14} /></button>}</div>
          <div className="card-bd">
            {sel ? (
              <React.Fragment>
                <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
                  <h3 style={{ fontSize: 22 }}>#{sel.height.toLocaleString()}</h3>
                  {sel.blue ? <span className="badge green"><span className="d" /> blue</span> : <span className="badge red"><span className="d" /> red</span>}
                </div>
                <KV k="Hash"><EntityChip value={sel.hash} kind="block" noMenu /></KV>
                <KV k="blue_score" v={sel.blueScore.toLocaleString()} mono />
                <KV k="Height" v={sel.height.toLocaleString()} mono />
                <KV k="Parents" v={`1 selected · ${(sel.mergeParents || []).length} merge`} />
                <KV k="Merge set" v={sel.mergeSet} mono />
                <KV k="Finality"><FinalityBadge blueScore={sel.blueScore} /></KV>
              </React.Fragment>
            ) : <div className="empty" style={{ padding: "30px 10px" }}><div className="ic"><Icon name="cube" size={28} /></div><p>Click any node to inspect it — height, blue_score, parents, and finality.</p></div>}
          </div>
        </div>
        <div className="card">
          <div className="card-h"><span className="t">Accessible block list</span><span className="spacer" /><span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>color is never the only signal</span></div>
          <div className="card-bd dag-list" style={{ maxHeight: 320, overflowY: "auto" }}>
            {ordered.slice(0, 12).map((b) => (
              <div className="r" key={b.hash} style={{ gridTemplateColumns: "60px 1fr auto auto", cursor: "pointer" }} onClick={() => setSelected(b.hash)}>
                <span className="mono" style={{ color: "var(--text-2)" }}>#{b.height}</span>
                <span className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>bs {b.blueScore.toLocaleString()}</span>
                {b.blue ? <span className="badge green" style={{ height: 18 }}>blue</span> : <span className="badge red" style={{ height: 18 }}>red</span>}
                {b.tips ? <span className="badge amber" style={{ height: 18 }}>tip</span> : <span style={{ width: 30 }} />}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// home mini strip
export function DagMiniStrip({ reducedMotion }) {
  const scan = useScan();
  const [blocks, setBlocks] = useState(buildInitialBlocks);
  const counter = useRef(0);
  useEffect(() => {
    if (DAG_REDUCED || reducedMotion) return;
    const t = setInterval(() => {
      setBlocks((prev) => {
        const top = prev.reduce((a, b) => (b.blueScore > a.blueScore ? b : a), prev[0]);
        counter.current += 1;
        const isRed = counter.current % 4 === 0;
        const nb = { hash: "0x" + Math.random().toString(16).slice(2, 12), height: top.height + 1, blueScore: top.blueScore + (isRed ? 0 : 1), blue: !isRed, txCount: 3, selectedParent: top.hash, mergeParents: [], mergeSet: 1, tips: true, _new: true };
        return [nb, ...prev.map((b) => ({ ...b, tips: false, _new: false }))].slice(0, 9);
      });
    }, 3000);
    return () => clearInterval(t);
  }, [reducedMotion]);
  const ordered = [...blocks].sort((a, b) => b.blueScore - a.blueScore);
  return (
    <div className="card dag-card" style={{ cursor: "pointer" }} onClick={() => scan.nav("dag")}>
      <div className="card-h"><span className="t">Live DAG</span><span className="spacer" /><span className="dag-stream live"><span className="d" />streaming</span></div>
      <div className="card-bd" style={{ padding: 12 }}>
        <div style={{ overflow: "hidden" }}><DagGraph blocks={ordered} height={130} compact onPick={() => scan.nav("dag")} /></div>
        <div className="dag-tipline" style={{ marginTop: 8 }}>Tips <b>{ordered.filter((b) => b.tips).map((b) => "#" + b.height).join(", ")}</b> · <span style={{ color: "var(--accent-text)" }}>open full DAG →</span></div>
      </div>
    </div>
  );
}
