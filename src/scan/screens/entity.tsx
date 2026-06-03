// @ts-nocheck
/* eslint-disable */
"use client";

import React, { useState, useEffect } from "react";
import { SD } from "@/scan/data";
import { SH } from "@/scan/harness";
import { Icon } from "@/scan/icons";
import {
  EntityChip,
  CopyBtn,
  StatusDot,
  ActionChip,
  FinalityBadge,
  SummaryCard,
  Tabs,
  KV,
  Crumb,
  GaslessPill,
} from "@/scan/components";
import { useScan } from "@/scan/context";
import { NotFound } from "@/scan/screens/tx";
import { useLiveBlock, useLiveAddress, DEMO } from "@/scan/live";
import { ScreenLoading } from "@/scan/screens/states";

export function BlockScreen({ id, tweaks }) {
  const scan = useScan();
  const liveB = useLiveBlock(id);
  // Live-first; rich sample is the demo fallback.
  const b = liveB.data ?? (DEMO ? SH.tools.getBlock(id).data : null);
  useEffect(() => { if (b) scan.setCtx("block #" + b.height); }, [id, b]);
  if (!b) return liveB.loading ? <ScreenLoading label="Loading block…" /> : <NotFound kind="block" value={id} />;
  const f = SH.finality(b.blueScore);
  const summary = {
    full: `Block #${b.height.toLocaleString()} sits at blue_score ${b.blueScore.toLocaleString()} in the ${b.blue ? "blue set" : "red set (it arrived in parallel and GHOSTDAG ordered it after the blue blocks)"}. It has one selected parent and ${(b.mergeParents || []).length} merge parent${(b.mergeParents || []).length === 1 ? "" : "s"}, and carries ${b.txCount} transactions. It is ${f.state === "final" ? "finalized" : `finalizing — depth ${f.depth}/${f.threshold}`}.`,
    short: `Block #${b.height.toLocaleString()} · blue_score ${b.blueScore.toLocaleString()} · ${b.txCount} txns · ${b.blue ? "blue" : "red"}.`,
  };
  return (
    <div className="wrap">
      <Crumb items={[{ label: "Home", route: "" }, { label: "Blocks" }, { label: "#" + b.height }]} />
      <div className="pagehead">
        <div><h1>Block #{b.height.toLocaleString()}</h1><div className="sub row" style={{ gap: 8 }}><span className="mono" style={{ fontSize: 13 }}>{SD.short(b.hash)}</span><CopyBtn text={b.hash} /></div></div>
        <div className="row" style={{ gap: 8 }}>{b.blue ? <span className="badge green"><span className="d" /> blue</span> : <span className="badge red"><span className="d" /> red</span>}<FinalityBadge blueScore={b.blueScore} /></div>
      </div>
      <div style={{ marginBottom: 18 }}><SummaryCard text={summary} seed="dag" verbosity={tweaks.verbosity} foot={b.tips ? <span className="badge amber"><span className="d" /> current tip</span> : null} /></div>

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="card">
          <div className="card-h"><span className="t">Consensus</span></div>
          <div className="card-bd">
            <KV k="Height" v={b.height.toLocaleString()} mono />
            <KV k="blue_score" green v={b.blueScore.toLocaleString()} mono />
            <KV k="Color"><span className="row" style={{ gap: 8 }}>{b.blue ? "blue" : "red"} <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{b.blue ? "in the well-connected cluster (k=" + SD.CHAIN.k + ")" : "arrived in parallel, outside the blue set"}</span></span></KV>
            <KV k="Merge set" v={b.mergeSet} mono />
            <KV k="Finality"><FinalityBadge blueScore={b.blueScore} /></KV>
            <KV k="Validator" v={b.validator} mono />
            <KV k="Size" v={b.size + " KB"} mono />
            <KV k="Timestamp" v={new Date(b.timestamp).toISOString().replace("T", " ").slice(0, 19) + " UTC"} mono />
          </div>
        </div>
        <div className="card">
          <div className="card-h"><span className="t">Parents</span><span className="spacer" /><span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>1 selected · up to {SD.CHAIN.maxParents} merge</span></div>
          <div className="card-bd">
            {b.selectedParent ? (
              <div className="xfer" style={{ borderTop: "none" }}>
                <span className="badge green" style={{ height: 20 }}>selected</span>
                <EntityChip value={b.selectedParent} kind="block" noMenu />
                <span className="mono" style={{ fontSize: 11, color: "var(--text-3)", marginLeft: "auto" }}>heaviest-blue link</span>
              </div>
            ) : <div className="note"><span className="ic"><Icon name="info" size={15} /></span> Genesis-adjacent block — no selected parent in this snapshot.</div>}
            {(b.mergeParents || []).map((mp, i) => (
              <div className="xfer" key={i}><span className="badge" style={{ height: 20 }}>merge</span><EntityChip value={mp} kind="block" noMenu /><span className="mono" style={{ fontSize: 11, color: "var(--text-3)", marginLeft: "auto" }}>merged into history</span></div>
            ))}
            {(b.mergeParents || []).length === 0 && b.selectedParent && <div className="note" style={{ marginTop: 12 }}><span className="ic"><Icon name="lattice" size={15} /></span> No merge parents — this block extended a single tip.</div>}
            <button className="btn sm ghost" style={{ marginTop: 14 }} onClick={() => scan.nav("dag")}><Icon name="lattice" size={15} /> See it in the DAG</button>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <div className="list-head"><div className="eyebrow">Transactions in this block · {b.txCount}</div></div>
        <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Action</th><th>Hash</th><th>From</th><th>Status</th></tr></thead>
          <tbody>{SD.LATEST_TX.slice(0, Math.min(b.txCount, 4)).map((t, i) => (
            <tr key={i} onClick={() => scan.nav(`tx/${t.hash}`)} style={{ cursor: "pointer" }}><td><ActionChip kind={t.kind} label={t.action} /></td><td><EntityChip value={t.hash} kind="tx" label={t.shortHash} noMenu /></td><td><EntityChip value={t.from} kind="address" /></td><td><StatusDot status={t.status} /></td></tr>
          ))}</tbody></table></div>
      </div>
    </div>
  );
}

function CsvBtn({ label = "Export CSV" }) {
  const [done, setDone] = useState(false);
  return <button className="btn sm ghost" onClick={() => { setDone(true); setTimeout(() => setDone(false), 1400); }}><Icon name={done ? "check" : "download"} size={15} /> {done ? "Exported" : label}</button>;
}

export function AddressScreen({ addr, tweaks }) {
  const scan = useScan();
  const [tab, setTab] = useState("txns");
  const [watched, setWatched] = useState(false);
  const liveA = useLiveAddress(addr);
  const a = liveA.data ?? (DEMO ? SH.tools.getAddress(addr).data : null);
  useEffect(() => { if (a) scan.setCtx("address " + (a.label || SD.short(addr))); }, [addr, a]);
  if (!a) return liveA.loading ? <ScreenLoading label="Loading address…" /> : <NotFound kind="address" value={addr} />;
  const tabs = [
    { id: "txns", label: "Transactions", count: a.txns ? a.txns.length : 0 },
    { id: "tokens", label: "Tokens", count: a.tokens ? a.tokens.length : 0 },
    { id: "analytics", label: "Analytics" },
  ];
  return (
    <div className="wrap">
      <Crumb items={[{ label: "Home", route: "" }, { label: "Address" }, { label: a.label || SD.short(addr) }]} />
      <div className="pagehead">
        <div>
          <h1 className="row" style={{ gap: 10 }}>{a.isContract ? <Icon name="file" size={24} /> : <Icon name="user" size={24} />}{a.label || "Address"}</h1>
          <div className="sub row" style={{ gap: 8 }}><span className="mono" style={{ fontSize: 13 }}>{SD.short(addr)}</span><CopyBtn text={addr} />{a.isContract && <span className="badge green" style={{ height: 20 }}><Icon name="shieldCheck" size={11} /> contract</span>}</div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className={"btn sm" + (watched ? " primary" : "")} onClick={() => setWatched(!watched)}><Icon name="bell" size={15} /> {watched ? "Watching" : "Watch"}</button>
          {a.isContract && <button className="btn sm" onClick={() => scan.nav(`contract/${addr}`)}><Icon name="code" size={15} /> Contract</button>}
        </div>
      </div>

      <div style={{ marginBottom: 18 }}><SummaryCard text={{ full: a.summary, short: a.summary }} seed="explain" verbosity={tweaks.verbosity} warming={tweaks.warming}
        foot={<React.Fragment><span className="badge" style={{ height: 22 }}>Balance: {a.balanceSalt} SALT</span>{!a.isContract && <GaslessPill />}</React.Fragment>} /></div>

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr", marginBottom: 18 }}>
        <div className="card"><div className="card-bd"><div className="eyebrow">SALT balance</div><div style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 500, marginTop: 4 }}>{a.balanceSalt} <span style={{ fontSize: 14, color: "var(--text-3)" }}>SALT</span></div></div></div>
        <div className="card"><div className="card-bd"><div className="eyebrow">Transactions</div><div style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 500, marginTop: 4 }} className="tabular">{(a.txCount || 0).toLocaleString()}</div></div></div>
        <div className="card"><div className="card-bd"><div className="eyebrow">First seen</div><div style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 500, marginTop: 4 }} className="mono">{a.firstSeen || "—"}</div></div></div>
      </div>

      <div className="row" style={{ justifyContent: "space-between" }}><Tabs tabs={tabs} active={tab} onChange={setTab} /></div>

      {tab === "txns" && (
        <div className="tbl-wrap">
          <div className="tbl-top"><span className="t">Transactions</span><span className="spacer" /><CsvBtn /></div>
          {a.txns && a.txns.length ? (
            <table className="tbl"><thead><tr><th></th><th>Action</th><th>Hash</th><th>Counterparty</th><th>Status</th><th className="num">Age</th></tr></thead>
              <tbody>{a.txns.map((t, i) => (
                <tr key={i} onClick={() => scan.nav(`tx/${t.hash}`)} style={{ cursor: "pointer" }}>
                  <td><span className={"dirpill " + t.dir}>{t.dir}</span></td>
                  <td><ActionChip kind={t.kind} label={t.action} /></td>
                  <td><EntityChip value={t.hash} kind="tx" label={t.shortHash} noMenu /></td>
                  <td><EntityChip value={t.counter} kind={SD.labelOf(t.counter) && SD.labelOf(t.counter).kind === "contract" ? "contract" : "address"} /></td>
                  <td><StatusDot status={t.status} /></td><td className="num age">{t.age}</td>
                </tr>
              ))}</tbody></table>
          ) : <div className="empty" style={{ padding: 50 }}><p>No activity yet. When this address transacts, it appears here — witnessed, lineage attached.</p></div>}
        </div>
      )}

      {tab === "tokens" && (
        <div className="tbl-wrap">
          <div className="tbl-top"><span className="t">Token holdings</span><span className="spacer" /><CsvBtn /></div>
          {a.tokens && a.tokens.length ? (
            <table className="tbl"><thead><tr><th>Token</th><th className="num">Balance</th></tr></thead>
              <tbody>{a.tokens.map((t, i) => (
                <tr key={i} style={{ cursor: "pointer" }} onClick={() => t.sym !== "SALT" && scan.nav(`token/${t.token}`)}><td><span className="row" style={{ gap: 8 }}><span className="badge" style={{ height: 20 }}>{t.sym}</span> {t.name}</span></td><td className="num mono">{t.balance} {t.sym}</td></tr>
              ))}</tbody></table>
          ) : <div className="empty" style={{ padding: 50 }}><p>No token balances indexed.</p></div>}
        </div>
      )}

      {tab === "analytics" && (
        <div className="card"><div className="card-bd">
          <div className="note info" style={{ marginBottom: 16 }}><span className="ic"><Icon name="spark" size={15} /></span> Want the narrative? Ask the agent to trace this address's activity and counterparties.</div>
          <div className="grid" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
            {[["Out volume", "1,750 SALT"], ["In volume", "1,012 cWETH"], ["Counterparties", "6"], ["Gas paid", "0 SALT"]].map((s, i) => (
              <div key={i}><div className="eyebrow">{s[0]}</div><div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 500, marginTop: 4 }}>{s[1]}</div></div>
            ))}
          </div>
          <button className="btn sm" style={{ marginTop: 18 }} onClick={() => scan.ask("explain", a.label || "this address")}><Icon name="spark" size={15} /> Trace with the agent</button>
        </div></div>
      )}
    </div>
  );
}

export function TokenScreen({ addr, tweaks }) {
  const scan = useScan();
  const [tab, setTab] = useState("holders");
  const res = SH.tools.getToken(addr);
  const tk = res.data;
  if (!tk) return <NotFound kind="token" value={addr} />;
  useEffect(() => { scan.setCtx("token " + tk.symbol); }, [addr]);
  const tabs = [{ id: "holders", label: "Holders", count: tk.holderCount }, { id: "transfers", label: "Transfers", count: tk.transferCount }, { id: "info", label: "Info" }];
  return (
    <div className="wrap">
      <Crumb items={[{ label: "Home", route: "" }, { label: "Tokens" }, { label: tk.symbol }]} />
      <div className="pagehead">
        <div><h1 className="row" style={{ gap: 10 }}><Icon name="coin" size={24} />{tk.name}</h1><div className="sub row" style={{ gap: 8 }}><span className="badge green" style={{ height: 20 }}>{tk.symbol}</span><span className="mono" style={{ fontSize: 13 }}>{SD.short(addr)}</span><CopyBtn text={addr} /></div></div>
        <button className="btn sm" onClick={() => scan.nav(`contract/${addr}`)}><Icon name="code" size={15} /> Contract</button>
      </div>
      <div style={{ marginBottom: 18 }}><SummaryCard label="What this is" text={{ full: tk.summary, short: tk.summary }} seed="explain" verbosity={tweaks.verbosity} warming={tweaks.warming} /></div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(3,1fr)", marginBottom: 18 }}>
        {[["Total supply", tk.supply + " " + tk.symbol], ["Holders", tk.holderCount.toLocaleString()], ["Transfers", tk.transferCount.toLocaleString()]].map((s, i) => (
          <div className="card" key={i}><div className="card-bd"><div className="eyebrow">{s[0]}</div><div className="tabular" style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 500, marginTop: 4 }}>{s[1]}</div></div></div>
        ))}
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      {tab === "holders" && (
        <div className="tbl-wrap">
          <div className="tbl-top"><span className="t">Top holders</span><span className="spacer" /><button className="btn sm ghost" onClick={() => scan.ask("holders", tk.symbol)}><Icon name="spark" size={14} /> Ask the agent</button><CsvBtn /></div>
          <table className="tbl"><thead><tr><th>#</th><th>Holder</th><th className="num">Balance</th><th>Share</th></tr></thead>
            <tbody>{tk.holders.map((h) => (
              <tr key={h.rank}><td className="mono" style={{ color: "var(--text-3)" }}>{h.rank}</td><td><EntityChip value={h.addr} kind={h.label.includes(".ctr") ? "address" : "contract"} label={h.label} /></td><td className="num mono">{h.balance} {tk.symbol}</td>
                <td><span className="row" style={{ gap: 8 }}><span className="holder-bar"><i style={{ width: Math.min(100, h.pct) + "%" }} /></span><span className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>{h.pct < 0.01 ? "<0.01" : h.pct}%</span></span></td></tr>
            ))}</tbody></table>
        </div>
      )}
      {tab === "transfers" && (
        <div className="tbl-wrap">
          <div className="tbl-top"><span className="t">Transfers</span><span className="spacer" /><CsvBtn /></div>
          <table className="tbl"><thead><tr><th>Hash</th><th>From</th><th>To</th><th className="num">Amount</th><th className="num">Age</th></tr></thead>
            <tbody>{tk.transfers.map((t, i) => (
              <tr key={i} onClick={() => scan.nav(`tx/${t.hash}`)} style={{ cursor: "pointer" }}><td><EntityChip value={t.hash} kind="tx" label={t.shortHash} noMenu /></td><td><EntityChip value={t.from} kind="address" /></td><td><EntityChip value={t.to} kind="address" /></td><td className="num mono">{t.amount} {tk.symbol}</td><td className="num age">{t.age}</td></tr>
            ))}</tbody></table>
        </div>
      )}
      {tab === "info" && (
        <div className="card"><div className="card-bd">
          <KV k="Contract"><EntityChip value={addr} kind="contract" /></KV>
          <KV k="Decimals" v={tk.decimals} mono /><KV k="Symbol" v={tk.symbol} mono /><KV k="Verified" green v="yes — source matched" /><KV k="Standard" v="ERC-20" mono />
        </div></div>
      )}
    </div>
  );
}
