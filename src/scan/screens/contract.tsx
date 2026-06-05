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
  SummaryCard,
  Tabs,
  GaslessPill,
  Crumb,
} from "@/scan/components";
import { useScan } from "@/scan/context";
import { useAccount, useConnect, useWriteContract } from "wagmi";
import { injected } from "wagmi/connectors";
import { encodeFunctionData } from "viem";
import { useSponsoredWrite } from "@/lib/citrate/use-sponsored-write";

// Coerce a string input to the rough type its solidity param wants (best-effort).
function coerceArg(v, type) {
  if (v == null || v === "") {
    if (type && (type.startsWith("uint") || type.startsWith("int"))) return 0n;
    if (type === "bool") return false;
    if (type === "address") return "0x0000000000000000000000000000000000000000";
    return "";
  }
  if (type && (type.startsWith("uint") || type.startsWith("int"))) return BigInt(v);
  if (type === "bool") return v === "true" || v === true;
  return v;
}
function fnFragment(fn) {
  return { type: "function", name: fn.fn, inputs: (fn.inputs || []).map((i) => ({ name: i.name, type: i.type })), outputs: [], stateMutability: "nonpayable" };
}
function encodeCall(fn, vals) {
  try {
    return encodeFunctionData({ abi: [fnFragment(fn)], functionName: fn.fn, args: (fn.inputs || []).map((i) => coerceArg(vals[i.name], i.type)) });
  } catch {
    return "0x";
  }
}

function ReadFn({ fn, addr }) {
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState({});
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const query = () => {
    setLoading(true); setResult(null);
    setTimeout(() => { const r = SH.tools.readContract(addr, fn.fn).data; setResult(r); setLoading(false); }, 420);
  };
  return (
    <div className="fn-card">
      <div className={"fn-h" + (open ? " open" : "")} onClick={() => setOpen(!open)}>
        <span className="name">{fn.fn}<span className="args">({fn.inputs.map((i) => i.type).join(", ")})</span></span>
        <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>→ {fn.outputs}</span>
        <span className="chev"><Icon name="chevright" size={16} /></span>
      </div>
      {open && (
        <div className="fn-bd">
          {fn.inputs.map((inp, i) => (
            <div className="fn-input" key={i}><label>{inp.name} · {inp.type}</label><input placeholder={inp.type} value={vals[inp.name] || ""} onChange={(e) => setVals({ ...vals, [inp.name]: e.target.value })} /></div>
          ))}
          <button className="btn sm primary" style={{ marginTop: 8 }} onClick={query} disabled={loading}>{loading ? "Querying…" : "Query"}</button>
          {result && (
            <div className="fn-result"><div className="lbl">result · decoded {result.decoded ? "(units resolved)" : "(unverified raw)"}</div><div className="val">{typeof result.result === "string" && result.result.startsWith("0x") && result.result.length === 42 ? <EntityChip value={result.result} kind="contract" /> : result.result}</div></div>
          )}
        </div>
      )}
    </div>
  );
}

function GaslessModal({ fn, addr, vals, onClose }) {
  const scan = useScan();
  const { sponsor, status, txHash, error } = useSponsoredWrite();
  const phase = status === "done" ? "done" : "confirm";
  const sign = () => sponsor({ to: addr, data: encodeCall(fn, vals) });
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {phase !== "done" ? (
          <React.Fragment>
            <h3>Confirm — no gas, on us</h3>
            <p>You're authorizing a call to <strong className="mono">{fn.fn}()</strong>. You sign a typed message (EIP-712 ForwardRequest) — it carries no value and costs nothing.</p>
            <div className="gasless-banner"><span className="ic"><Icon name="bolt" size={18} /></span><div><div className="t">Gas paid by the Citrate Foundation</div><div className="d">The relayer submits via CitrateForwarder (EIP-2771). Your signature authorizes; the Foundation pays. There is no native paymaster.</div></div></div>
            <div className="codeblock" style={{ marginBottom: 16 }}><pre>{`ForwardRequest {
  from:  alice.ctr
  to:    CitrateSwap Router
  data:  ${fn.fn}(${args || "…"})
  value: 0
}`}</pre></div>
            {error && <div className="note" style={{ color: "var(--danger-text)", marginBottom: 10 }}><span className="ic"><Icon name="info" size={14} /></span> {error}</div>}
            <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
              <button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn primary" onClick={sign} disabled={status === "signing" || status === "relaying"}>{status === "signing" ? "Signing…" : status === "relaying" ? "Relaying…" : "Sign — no gas"}</button>
            </div>
          </React.Fragment>
        ) : (
          <React.Fragment>
            <h3 className="row" style={{ gap: 9 }}><span style={{ color: "var(--accent)" }}><Icon name="shieldCheck" size={22} /></span> Authorized — gas on us</h3>
            <p>The relayer submitted your call. It surfaced as a transaction you can open and read in plain English.</p>
            <div className="modal .keyshow keyshow"><EntityChip value={txHash} kind="tx" label={SD.short(txHash)} noMenu /><span className="spacer" /><GaslessPill /></div>
            <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
              <button className="btn" onClick={onClose}>Close</button>
              <button className="btn primary" onClick={() => { onClose(); scan.nav(`tx/${txHash}`); }}>Open transaction <Icon name="arrowright" size={15} /></button>
            </div>
          </React.Fragment>
        )}
      </div>
    </div>
  );
}

function WriteFn({ fn, addr }) {
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState({});
  const [modal, setModal] = useState(false);
  const { isConnected } = useAccount();
  const { connect } = useConnect();
  const { writeContractAsync } = useWriteContract();
  const walletWrite = async () => {
    try {
      if (!isConnected) { connect({ connector: injected() }); return; }
      const hash = await writeContractAsync({ address: addr, abi: [fnFragment(fn)], functionName: fn.fn, args: (fn.inputs || []).map((i) => coerceArg(vals[i.name], i.type)) });
      alert("Submitted with your wallet: " + hash);
    } catch (e) { alert(e.shortMessage || e.message); }
  };
  return (
    <div className="fn-card">
      <div className={"fn-h" + (open ? " open" : "")} onClick={() => setOpen(!open)}>
        <span className="name">{fn.fn}<span className="args">({fn.inputs.map((i) => i.type).join(", ")})</span></span>
        <span className="chev"><Icon name="chevright" size={16} /></span>
      </div>
      {open && (
        <div className="fn-bd">
          {fn.inputs.map((inp, i) => (
            <div className="fn-input" key={i}><label>{inp.name} · {inp.type}</label><input placeholder={inp.type} value={vals[inp.name] || ""} onChange={(e) => setVals({ ...vals, [inp.name]: e.target.value })} /></div>
          ))}
          <div className="gasless-banner" style={{ marginTop: 14 }}><span className="ic"><Icon name="bolt" size={18} /></span><div><div className="t">Gasless write — the default path</div><div className="d">Sign an EIP-712 ForwardRequest; the Foundation relayer pays the gas. No SALT needed in your wallet.</div></div></div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn primary" onClick={() => setModal(true)}><Icon name="bolt" size={15} /> Write — no gas, on us</button>
            <button className="btn ghost" onClick={walletWrite}><Icon name="wallet" size={15} /> {isConnected ? "Write with wallet (you pay gas)" : "Connect wallet to write"}</button>
          </div>
        </div>
      )}
      {modal && <GaslessModal fn={fn} addr={addr} vals={vals} onClose={() => setModal(false)} />}
    </div>
  );
}

export function ContractScreen({ addr, tweaks }) {
  const scan = useScan();
  const [tab, setTab] = useState("code");
  const [srcTab, setSrcTab] = useState(0);
  const c = SD.CONTRACT[(addr || "").toLowerCase()];
  // Live on-chain facts for any address (WS-2a) — bytecode + token metadata.
  const [live, setLive] = useState(null);
  useEffect(() => {
    if (c) return;
    let cancelled = false;
    fetch(`/api/contract/${addr}`).then((r) => r.json()).then((j) => { if (!cancelled) setLive(j); }).catch(() => {});
    return () => { cancelled = true; };
  }, [addr]);
  if (!c) {
    // live path — show the REAL on-chain code + token facts, and verified source
    // when the contract has been verified (WS-2b).
    const tok = live && live.token;
    const ver = live && live.verification && live.verification.verified ? live.verification : null;
    return (
      <div className="wrap">
        <Crumb items={[{ label: "Home", route: "" }, { label: "Contract" }, { label: SD.short(addr) }]} />
        <div className="pagehead"><div><h1 className="row" style={{ gap: 10 }}><Icon name="file" size={24} /> {(ver && ver.contractName) || (live && live.label) || "Contract"}</h1><div className="sub row" style={{ gap: 8 }}><span className="mono" style={{ fontSize: 13 }}>{SD.short(addr)}</span><CopyBtn text={addr} />{ver ? <span className="badge green" style={{ height: 20 }}><Icon name="shieldCheck" size={11} /> verified · {ver.matchType}</span> : <span className="badge" style={{ height: 20 }}>unverified</span>}</div></div></div>
        {ver
          ? <SummaryCard label="What this is" text={{ full: `Verified contract (${ver.matchType} match) compiled with ${ver.compilerVersion}. The source below was recompiled and its bytecode matched the on-chain code — reads can be decoded against the verified ABI.`, short: `Verified (${ver.matchType}) with ${ver.compilerVersion}.` }} seed="explain" verbosity={tweaks.verbosity} />
          : <SummaryCard label="What this is" text={{ full: "This contract isn't verified yet. We show its on-chain bytecode and any detected token metadata, and let you make raw eth_call reads (labeled \"unverified raw\" — never presented as decoded or trusted). Verify the source to unlock decoded Read and Write.", short: "Unverified — on-chain bytecode shown; raw reads only until source is matched." }} seed="explain" verbosity={tweaks.verbosity} foot={<button className="ask-cta" onClick={() => scan.nav("verify/" + addr)}><Icon name="shield" size={14} /> Verify source</button>} />}
        {ver && ver.source && (
          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-h"><span className="t">Verified source</span><span className="spacer" /><CopyBtn text={ver.source} /></div>
            <div className="codeblock" style={{ border: "none", borderRadius: 0, maxHeight: 460, overflow: "auto" }}><pre>{ver.source}</pre></div>
          </div>
        )}
        {tok && (
          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-h"><span className="t">Token · {tok.standard}</span></div>
            <div className="card-bd"><div className="stat-rows">
              <div className="stat-row"><span className="k">Name</span><span className="v">{tok.name || "—"}</span></div>
              <div className="stat-row"><span className="k">Symbol</span><span className="v">{tok.symbol || "—"}</span></div>
              {tok.decimals != null && <div className="stat-row"><span className="k">Decimals</span><span className="v mono">{tok.decimals}</span></div>}
              {tok.totalSupply != null && <div className="stat-row"><span className="k">Total supply</span><span className="v mono">{tok.totalSupply}</span></div>}
            </div></div>
          </div>
        )}
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-h"><span className="t">On-chain bytecode</span><span className="spacer" />{live && live.bytecode && <CopyBtn text={live.bytecode} />}</div>
          <div className="card-bd">
            {!live && <div className="empty" style={{ padding: 20 }}><p>Reading code…</p></div>}
            {live && live.isContract === false && <div className="note info"><span className="ic"><Icon name="info" size={15} /></span> This address is an EOA — no contract code.</div>}
            {live && live.isContract && (
              <React.Fragment>
                <div className="stat-rows" style={{ marginBottom: 12 }}>
                  <div className="stat-row"><span className="k">Code size</span><span className="v mono">{Number(live.codeSize || 0).toLocaleString()} bytes</span></div>
                  <div className="stat-row"><span className="k">Code hash</span><span className="v mono" style={{ fontSize: 12 }}>{live.codeHash ? SD.short(live.codeHash) : "—"}</span></div>
                </div>
                <div className="codeblock" style={{ maxHeight: 280, overflow: "auto" }}><pre style={{ wordBreak: "break-all", whiteSpace: "pre-wrap", fontSize: 11 }}>{live.bytecode}</pre></div>
              </React.Fragment>
            )}
          </div>
        </div>
      </div>
    );
  }
  useEffect(() => { scan.setCtx("contract " + c.label); }, [addr]);
  const tabs = [{ id: "code", label: "Code", count: c.sources.length }, { id: "read", label: "Read", count: c.reads.length }, { id: "write", label: "Write", count: c.writes.length }, { id: "events", label: "Events", count: c.events.length }];
  return (
    <div className="wrap">
      <Crumb items={[{ label: "Home", route: "" }, { label: "Contract" }, { label: c.label }]} />
      <div className="pagehead">
        <div><h1 className="row" style={{ gap: 10 }}><Icon name="file" size={24} />{c.label}</h1><div className="sub row" style={{ gap: 8 }}><span className="mono" style={{ fontSize: 13 }}>{SD.short(addr)}</span><CopyBtn text={addr} /><span className="badge green" style={{ height: 20 }}><Icon name="shieldCheck" size={11} /> verified</span></div></div>
        <button className="btn sm" onClick={() => scan.nav(`address/${addr}`)}><Icon name="user" size={15} /> Address view</button>
      </div>
      <div style={{ marginBottom: 18 }}><SummaryCard label="What this is" text={{ full: c.summary, short: c.summary }} seed="explain" verbosity={tweaks.verbosity} warming={tweaks.warming}
        foot={<React.Fragment><span className="badge" style={{ height: 22 }}>{c.compiler.split("+")[0]}</span><GaslessPill /></React.Fragment>} /></div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "code" && (
        <div className="grid" style={{ gridTemplateColumns: "1fr" }}>
          <div className="card"><div className="card-h"><span className="t">Compiler & metadata</span></div><div className="card-bd">
            <div className="grid" style={{ gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
              {[["Compiler", c.compiler], ["Optimization", c.optimizer], ["License", c.license], ["EVM version", c.evmVersion], ["Created block", "#" + c.createdBlock.toLocaleString()], ["Standard", "Solidity"]].map((m, i) => (
                <div key={i}><div className="eyebrow">{m[0]}</div><div className="mono" style={{ fontSize: 13, marginTop: 4 }}>{m[1]}</div></div>
              ))}
            </div>
          </div></div>
          <div className="card raised" style={{ overflow: "hidden" }}>
            <div className="code-tabs">{c.sources.map((s, i) => <button key={i} className={"code-tab" + (srcTab === i ? " active" : "")} onClick={() => setSrcTab(i)}>{s.name}</button>)}<span className="spacer" /><span style={{ marginLeft: "auto", padding: "7px 12px" }}><CopyBtn text={c.sources[srcTab].code} /></span></div>
            <div className="codeblock" style={{ border: "none", borderRadius: 0, maxHeight: 460 }}><pre>{c.sources[srcTab].code}</pre></div>
          </div>
        </div>
      )}

      {tab === "read" && (
        <div>
          <div className="note info" style={{ marginBottom: 14 }}><span className="ic"><Icon name="info" size={15} /></span> Decoded reads via <span className="mono">eth_call</span> at <span className="mono">latest</span>. Results are unit-resolved, not raw uint256. Read-only — no signature, no gas.</div>
          {c.reads.map((fn, i) => <ReadFn key={i} fn={fn} addr={addr} />)}
        </div>
      )}

      {tab === "write" && (
        <div>
          <div className="gasless-banner" style={{ marginBottom: 16 }}><span className="ic"><Icon name="bolt" size={18} /></span><div><div className="t">Writes are gasless on Citrate</div><div className="d">Sign a typed message; the Citrate Foundation relayer pays the gas through CitrateForwarder (EIP-2771). A wallet path is offered too if you'd rather pay yourself.</div></div></div>
          {c.writes.map((fn, i) => <WriteFn key={i} fn={fn} addr={addr} />)}
        </div>
      )}

      {tab === "events" && (
        <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Event</th><th className="num">Emitted</th><th></th></tr></thead>
          <tbody>{c.events.map((e, i) => (<tr key={i}><td className="mono">{e.name}</td><td className="num tabular">{e.count.toLocaleString()}</td><td><button className="btn sm ghost" onClick={() => scan.ask("explain", e.name + " events")}><Icon name="spark" size={13} /> Explain</button></td></tr>))}</tbody></table></div>
      )}
    </div>
  );
}
