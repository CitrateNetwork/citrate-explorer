// @ts-nocheck
/* eslint-disable */
"use client";

import { useState } from "react";
import { SD } from "@/scan/data";
import { SH } from "@/scan/harness";
import { Icon } from "@/scan/icons";
import { EntityChip, ActionChip, StatusDot, FinalityBadge } from "@/scan/components";
import { useScan } from "@/scan/context";
import { DagMiniStrip } from "@/scan/screens/dag";

// scan-home.jsx — landing: big omni-search hero, live DAG mini, chain stats, latest blocks/txns
export function Home({ tweaks }) {
  const scan = useScan();
  const [q, setQ] = useState("");
  const status = SH.tools.getChainStatus().data;
  const go = () => { if (q.trim()) scan.search(q.trim()); };

  const blocks = SD.BLOCKS.filter((b) => b.blue).slice(0, 6);
  return (
    <div className="wrap">
      <div className="hero">
        <h1>The AI-native explorer for <span className="accent">Citrate</span></h1>
        <p>Every page leads with what happened in plain English — the hash soup is one tap away, never the front door. Ask a question and the agent reads the chain for you.</p>
        <div className="bigsearch">
          <span className="si"><Icon name="search" size={20} /></span>
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()}
            placeholder="Search any address, tx, block, token — or ask a question…" aria-label="Search or ask" />
        </div>
        <div className="prompt-chips">
          <button className="prompt-chip" onClick={() => scan.nav(`tx/${SD.txList[0].hash}`)}><span className="ic"><Icon name="spark" size={14} /></span> Explain a swap</button>
          <button className="prompt-chip" onClick={() => scan.ask("holders", "SALT")}><span className="ic"><Icon name="spark" size={14} /></span> Who holds the most SALT?</button>
          <button className="prompt-chip" onClick={() => scan.nav("dag")}><span className="ic"><Icon name="lattice" size={14} /></span> Watch the live DAG</button>
          <button className="prompt-chip" onClick={() => scan.ask("dag", "the DAG")}><span className="ic"><Icon name="spark" size={14} /></span> How does GHOSTDAG work?</button>
        </div>
      </div>

      <div className="home-grid">
        <div className="grid">
          <DagMiniStrip reducedMotion={tweaks.reducedMotion} />
          <div className="card">
            <div className="card-h"><span className="t">Chain status</span><span className="spacer" /><span className="badge green" style={{ height: 20 }}><span className="d" /> up</span></div>
            <div className="card-bd" style={{ paddingTop: 6, paddingBottom: 6 }}>
              <div className="stat-rows">
                <div className="stat-row"><span className="k">Network</span><span className="v" style={{ fontSize: 15 }}>{status.network}</span></div>
                <div className="stat-row"><span className="k">Chain ID</span><span className="v">{status.chainId}</span></div>
                <div className="stat-row"><span className="k">blue_score</span><span className="v green">{status.blueScore.toLocaleString()}</span></div>
                <div className="stat-row"><span className="k">Height</span><span className="v">{status.height.toLocaleString()}</span></div>
                <div className="stat-row"><span className="k">Finality depth</span><span className="v">{SD.CHAIN.finalityDepth}</span></div>
                <div className="stat-row"><span className="k">Fees</span><span className="v green">gasless</span></div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid">
          <div>
            <div className="list-head"><div className="eyebrow">Latest blocks · by blue_score</div><a onClick={() => scan.nav("dag")}>View DAG →</a></div>
            <div className="card mini-list">
              {blocks.map((b) => (
                <div className="mini-row" key={b.hash} onClick={() => scan.nav(`block/${b.hash}`)} style={{ cursor: "pointer" }}>
                  <span className="cube"><Icon name="cube" size={17} /></span>
                  <div className="grow">
                    <div className="ttl">#{b.height.toLocaleString()} <span style={{ color: "var(--text-3)", fontWeight: 400 }}>· bs {b.blueScore.toLocaleString()}</span></div>
                    <div className="meta">{b.txCount} txns · validator {b.validator} · {SD.fmtAge(b.timestamp)}</div>
                  </div>
                  <FinalityBadge blueScore={b.blueScore} />
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="list-head"><div className="eyebrow">Latest transactions</div><a onClick={() => scan.nav(`tx/${SD.txList[0].hash}`)}>Explain one →</a></div>
            <div className="card mini-list">
              {SD.LATEST_TX.map((t, i) => (
                <div className="mini-row" key={i} onClick={() => scan.nav(`tx/${t.hash}`)} style={{ cursor: "pointer" }}>
                  <ActionChip kind={t.kind} label={t.action} />
                  <div className="grow" style={{ textAlign: "right" }}>
                    <div className="meta" style={{ marginTop: 0 }}><EntityChip value={t.hash} kind="tx" label={t.shortHash} showLabel noMenu /></div>
                  </div>
                  <StatusDot status={t.status} />
                  <span className="age mono" style={{ fontSize: 12, color: "var(--text-3)", minWidth: 38, textAlign: "right" }}>{t.age}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
