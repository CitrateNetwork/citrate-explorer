// @ts-nocheck
/* eslint-disable */
"use client";

import { Fragment, useState, useEffect } from "react";
import { SD } from "@/scan/data";
import { SH } from "@/scan/harness";
import { Icon } from "@/scan/icons";
import { EntityChip, CopyBtn, StatusDot, ActionChip, FinalityBadge, SummaryCard, Tabs, KV, Crumb, GaslessPill } from "@/scan/components";
import { useScan } from "@/scan/context";
import { useLiveTx, DEMO } from "@/scan/live";
import { ScreenLoading } from "@/scan/screens/states";

// scan-tx.jsx — the marquee "Explain this transaction" page.
function ErrorDiagnosis({ error }) {
  const scan = useScan();
  const [raw, setRaw] = useState(false);
  return (
    <div className="errbox">
      <h4><Icon name="alert" size={18} /> Why this transaction failed</h4>
      <div className="plain">{error.plain}</div>
      <div className="sugg"><span className="ic"><Icon name="info" size={16} /></span><span>{error.suggestion}</span></div>
      <div className="raw">
        <button className="btn sm ghost" onClick={() => setRaw(!raw)}><Icon name={raw ? "chevdown" : "chevright"} size={14} /> {raw ? "Hide" : "Show"} raw error</button>
        {raw && (
          <div className="codeblock" style={{ marginTop: 10 }}><pre>{`Fail with custom error '${error.signature}'
selector: ${error.selector}
matched ABI: CitrateRouter.${error.signature}`}</pre></div>
        )}
        <button className="btn sm ghost" style={{ marginLeft: 8 }} onClick={() => scan.ask("fail", "this failed transaction")}><Icon name="spark" size={14} /> Ask the agent why</button>
      </div>
    </div>
  );
}

function StuckTxCopilot({ tx }) {
  const scan = useScan();
  const p = tx.pending;
  return (
    <div className="copilot">
      <h4><Icon name="clock" size={18} /> Where your transaction is</h4>
      <div className="steps">
        <div className="step"><span className="n">1</span><span>Signed and broadcast — your EIP-712 authorization reached the relayer and a real transaction was submitted.</span></div>
        <div className="step"><span className="n">2</span><span><strong>In the mempool now</strong>, {p.reason}. On a BlockDAG this is the normal short wait, not a stuck transaction.</span></div>
        <div className="step"><span className="n">3</span><span>Next: a block picks it up → it enters the blue set → it reaches finality depth ({SD.CHAIN.finalityDepth}). No action needed from you.</span></div>
      </div>
      <div className="seen">
        <div className="x"><div className="v tabular">{p.seenBy}</div><div className="k">nodes saw it</div></div>
        <div className="x"><div className="v tabular">{p.mempoolAge}</div><div className="k">in mempool</div></div>
        <div className="x"><div className="v">blue set</div><div className="k">waiting to merge</div></div>
      </div>
      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn sm" onClick={() => scan.ask("explain", "this pending transaction")}><Icon name="spark" size={14} /> Ask the agent</button>
        <span className="note" style={{ flex: 1 }}><span className="ic"><Icon name="info" size={15} /></span> We never say "0 confirmations" — finality on Citrate is depth-based, not a confirmation count.</span>
      </div>
    </div>
  );
}

export function TxScreen({ hash, tweaks }) {
  const scan = useScan();
  const [tab, setTab] = useState("overview");
  const liveT = useLiveTx(hash);
  const tx = liveT.data ?? (DEMO ? SH.tools.getTransaction(hash).data : null);
  useEffect(() => { if (tx && scan && scan.setCtx) scan.setCtx("transaction " + tx.shortHash); }, [hash, tx]);
  if (!tx) return liveT.loading ? <ScreenLoading label="Loading transaction…" /> : <NotFound kind="transaction" value={hash} />;

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "internal", label: "Internal", count: tx.internal.length },
    { id: "logs", label: "Logs", count: tx.logs.length },
    { id: "statediff", label: "State diff", count: tx.stateDiff.length },
    { id: "raw", label: "Raw", raw: true },
  ];

  return (
    <div className="wrap">
      <Crumb items={[{ label: "Home", route: "" }, { label: "Transactions" }, { label: tx.shortHash }]} />
      <div className="pagehead">
        <div>
          <h1>Transaction</h1>
          <div className="sub row" style={{ gap: 8 }}><span className="mono" style={{ fontSize: 13 }}>{tx.shortHash}</span><CopyBtn text={tx.hash} /></div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <StatusDot status={tx.status} />
          {tx.blueScore != null ? <FinalityBadge blueScore={tx.blueScore} /> : <span className="badge amber"><span className="d" /> Pending</span>}
        </div>
      </div>

      {/* SummaryCard always first */}
      <div style={{ marginBottom: 18 }}>
        <SummaryCard
          label={tx.status === "failed" ? "What happened" : "What happened"}
          text={tx.summary} seed={tx.status === "failed" ? "fail" : "tx"} verbosity={tweaks.verbosity}
          warming={tweaks.warming}
          foot={<Fragment><StatusDot status={tx.status} /><GaslessPill /></Fragment>}
        />
      </div>

      {/* failed → ErrorDiagnosis ; pending → StuckTxCopilot — before the raw tabs */}
      {tx.status === "failed" && <div style={{ marginBottom: 18 }}><ErrorDiagnosis error={tx.error} /></div>}
      {tx.status === "pending" && <div style={{ marginBottom: 18 }}><StuckTxCopilot tx={tx} /></div>}

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "overview" && (
        <div className="grid" style={{ gridTemplateColumns: "1fr", gap: 18 }}>
          <div className="card">
            <div className="card-h"><span className="t">Decoded action</span></div>
            <div className="card-bd">
              <div className="row" style={{ marginBottom: 14, gap: 10 }}><ActionChip kind={tx.kind} label={tx.decoded.fn} /><span className="mono" style={{ color: "var(--text-3)", fontSize: 12 }}>decoded from ABI</span></div>
              {tx.decoded.args.map((a, i) => (
                <div className="kv" key={i}><span className="k mono">{a.name} <span style={{ opacity: .6 }}>{a.type}</span></span><span className="v">{a.value.length === 42 && a.value.startsWith("0x") ? <EntityChip value={a.value} kind="address" /> : a.value}</span></div>
              ))}
            </div>
          </div>

          {tx.transfers.length > 0 && (
            <div className="card">
              <div className="card-h"><span className="t">Token transfers</span><span className="spacer" /><span className="badge" style={{ height: 20 }}>native value: {tx.valueSalt} SALT</span></div>
              <div className="card-bd">
                {tx.valueSalt === "0" && <div className="note" style={{ marginBottom: 12 }}><span className="ic"><Icon name="info" size={15} /></span> The native SALT value is 0 — but that headline would lie. The real movement is the token transfer(s) below.</div>}
                {tx.transfers.map((t, i) => (
                  <div className="xfer" key={i}>
                    <span className="amt">{t.amount}<span className="sym">{t.sym}</span></span>
                    <EntityChip value={t.from} kind={SD.labelOf(t.from) && SD.labelOf(t.from).kind === "token" ? "token" : "address"} />
                    <span className="arrow"><Icon name="arrowright" size={15} /></span>
                    <EntityChip value={t.to} kind={SD.labelOf(t.to) && SD.labelOf(t.to).kind === "token" ? "token" : "address"} />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-h"><span className="t">Details</span></div>
            <div className="card-bd">
              <KV k="From"><EntityChip value={tx.from} kind="address" /></KV>
              <KV k="To"><EntityChip value={tx.to} kind={SD.labelOf(tx.to) && SD.labelOf(tx.to).kind === "contract" ? "contract" : "address"} /></KV>
              {tx.block && <KV k="Block"><EntityChip value={tx.block} kind="block" label={"#" + tx.blockHeight} /></KV>}
              {tx.blueScore != null && <KV k="blue_score" v={tx.blueScore.toLocaleString()} mono />}
              <KV k="Nonce" v={tx.nonce} mono />
              {tx.gasUsed && <KV k="Gas used" v={tx.gasUsed.toLocaleString() + " units"} mono />}
              <KV k="Gas paid by" green><span className="row" style={{ gap: 8 }}><EntityChip value={SD.L.foundation.addr} kind="address" label="Citrate Foundation" /> <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>EIP-2771 relayer</span></span></KV>
              <KV k="Timestamp" v={new Date(tx.timestamp).toISOString().replace("T", " ").slice(0, 19) + " UTC"} mono />
            </div>
          </div>
        </div>
      )}

      {tab === "internal" && (
        <div className="tbl-wrap">
          {tx.internal.length === 0 ? <div className="empty" style={{ padding: "40px" }}><p>No internal transactions in this transaction.</p></div> : (
            <table className="tbl"><thead><tr><th>Type</th><th>From</th><th>To</th><th>Function</th><th className="num">Value</th></tr></thead>
              <tbody>{tx.internal.map((it, i) => (
                <tr key={i}><td><span className="badge" style={{ height: 20 }}>{it.type}</span></td><td><EntityChip value={it.from} kind="contract" /></td><td><EntityChip value={it.to} kind="contract" /></td><td className="mono">{it.fn}</td><td className="num mono">{it.value}</td></tr>
              ))}</tbody></table>
          )}
        </div>
      )}

      {tab === "logs" && (
        <div className="grid" style={{ gridTemplateColumns: "1fr" }}>
          {tx.logs.length === 0 ? <div className="tbl-wrap"><div className="empty" style={{ padding: 40 }}><p>No event logs were emitted.</p></div></div> :
            tx.logs.map((lg, i) => (
              <div className="card" key={i}>
                <div className="card-h"><span className="t">Log #{i}</span><span className="spacer" /><EntityChip value={lg.addr} kind={SD.labelOf(lg.addr) && SD.labelOf(lg.addr).kind === "token" ? "token" : "contract"} /></div>
                <div className="card-bd">
                  <div className="row" style={{ marginBottom: 10 }}><span className="badge green" style={{ height: 20 }}><Icon name="check" size={11} /> {lg.name}</span><span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>decoded event</span></div>
                  {lg.args.map((a, j) => <div className="kv" key={j}><span className="k mono">{a[0]}</span><span className="v mono">{a[1]}</span></div>)}
                </div>
              </div>
            ))}
        </div>
      )}

      {tab === "statediff" && (
        <div className="tbl-wrap">
          {tx.stateDiff.length === 0 ? <div className="empty" style={{ padding: 40 }}><p>No state changes (the transaction reverted or moved nothing).</p></div> : (
            <table className="tbl"><thead><tr><th>Entity</th><th>Key</th><th className="num">Before</th><th className="num">After</th><th className="num">Δ</th></tr></thead>
              <tbody>{tx.stateDiff.map((s, i) => (
                <tr key={i}><td><EntityChip value={s.entity} kind="address" label={s.label} /></td><td className="mono">{s.key}</td><td className="num mono">{s.before}</td><td className="num mono">{s.after}</td><td className="num mono" style={{ color: s.delta.startsWith("−") ? "var(--danger-text)" : "var(--accent-text)" }}>{s.delta}</td></tr>
              ))}</tbody></table>
          )}
        </div>
      )}

      {tab === "raw" && (
        <div className="card">
          <div className="card-h"><span className="t">Raw payload</span><span className="spacer" /><span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>the hash soup lives here — last, never first</span></div>
          <div className="card-bd">
            <div className="codeblock"><pre>{JSON.stringify({ hash: tx.hash, status: tx.status, from: tx.from, to: tx.to, nonce: tx.nonce, blueScore: tx.blueScore, gasUsed: tx.gasUsed, input: "0x" + (tx.decoded.fn === "swapExactTokensForTokens" ? "38ed1739" : "a9059cbb") + "000000000000000000000000…", logsBloom: "0x00000000000000…" }, null, 2)}</pre></div>
          </div>
        </div>
      )}
    </div>
  );
}

export function NotFound({ kind, value }) {
  const scan = useScan();
  return (
    <div className="wrap">
      <div className="empty" style={{ padding: "90px 20px" }}>
        <div className="ic"><Icon name="search" size={40} /></div>
        <h3>No {kind} found</h3>
        <p>Couldn't resolve <span className="mono">{SD.short(value)}</span> on chain {SD.CHAIN.chainId}. Check the value, or ask the agent to help locate it.</p>
        <div className="row" style={{ justifyContent: "center", marginTop: 16 }}><button className="btn" onClick={() => scan.nav("")}>Back home</button><button className="btn primary" onClick={() => scan.ask("explain", value)}><Icon name="spark" size={15} /> Ask the agent</button></div>
      </div>
    </div>
  );
}
