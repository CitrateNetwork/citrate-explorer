// @ts-nocheck
/* eslint-disable */
"use client";
// scan-settings.jsx — Settings (account, keys, privacy, transparency, developer) + Dev hub
import React, { useState } from "react";
import { SD } from "@/scan/data";
import { SH } from "@/scan/harness";
import { Icon } from "@/scan/icons";
import { CopyBtn, EntityChip, KV, Crumb } from "@/scan/components";
import { useScan } from "@/scan/context";
import { useAuth } from "@/lib/auth/client";

const SET_SECTIONS = [
  { id: "account", label: "Account", icon: "user" },
  { id: "keys", label: "API Keys", icon: "key" },
  { id: "privacy", label: "Privacy & Data", icon: "shield" },
  { id: "watchlist", label: "Watchlist & alerts", icon: "bell" },
  { id: "appearance", label: "Appearance", icon: "sun" },
  { id: "security", label: "Security", icon: "shieldCheck" },
  { id: "transparency", label: "Transparency", icon: "eye" },
  { id: "developer", label: "Developer", icon: "code" },
  { id: "about", label: "About", icon: "info" },
];

function CopyOnceModal({ onClose }) {
  const key = "ctr_sk_live_9f4a2e1bd6f0c8a1d3e5b7c90a2d4e6b";
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Copy your API key now</h3>
        <p>This is the only time you'll see it. We store a salted SHA-256 hash, not the key — so we literally can't show it again. If you lose it, revoke and issue a new one.</p>
        <div className="keyshow"><span style={{ flex: 1 }}>{key}</span><CopyBtn text={key} size={16} /></div>
        <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn primary" onClick={onClose}>I've copied it</button></div>
      </div>
    </div>
  );
}

function Toggle({ on, onClick }) { return <div className={"toggle" + (on ? " on" : "")} onClick={onClick} role="switch" aria-checked={on}><i /></div>; }

export function SettingsScreen({ tweaks }) {
  const scan = useScan();
  const auth = useAuth();
  const [sec, setSec] = useState("privacy");

  // GDPR rights — wired to the real routes with the auth-seam token.
  const authHeaders = async () => { const t = await auth.getToken(); return t ? { Authorization: `Bearer ${t}` } : {}; };
  const exportData = async () => {
    if (!auth.authenticated) { alert("Sign in to export your data."); return; }
    const res = await fetch("/api/account/export", { headers: await authHeaders() });
    const j = await res.json();
    if (!res.ok) { alert(j.error || "Export failed."); return; }
    const blob = new Blob([JSON.stringify(j, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = "citratescan-data.json"; a.click(); URL.revokeObjectURL(url);
  };
  const deleteAccount = async () => {
    if (!auth.authenticated) { alert("Sign in to manage your data."); return; }
    if (!confirm("Delete your account and ALL stored data? On-chain data is public and permanent and is NOT affected. This cannot be undone.")) return;
    const res = await fetch("/api/account", { method: "DELETE", headers: await authHeaders() });
    const j = await res.json();
    alert(j.deleted ? "Your account-scoped data has been erased." : (j.note || j.error || "Delete failed."));
    if (j.deleted) auth.logout();
  };
  const [keys, setKeys] = useState(SD.API_KEYS);
  const [modal, setModal] = useState(false);
  const [watch, setWatch] = useState([{ addr: SD.L.alice.addr, label: "alice.ctr", alert: true }, { addr: SD.L.router.addr, label: "CitrateSwap Router", alert: false }]);
  const [prompt, setPrompt] = useState(false);
  const audit = SH.audit.slice(0, 8);

  return (
    <div className="wrap">
      <Crumb items={[{ label: "Home", route: "" }, { label: "Settings" }]} />
      <h1 style={{ fontSize: 30, marginBottom: 20 }}>Settings</h1>
      <div className="set-layout">
        <div className="set-rail">
          {SET_SECTIONS.map((s) => (
            <button key={s.id} className={sec === s.id ? "active" : ""} onClick={() => setSec(s.id)}><span className="ic"><Icon name={s.icon} size={16} /></span> {s.label}</button>
          ))}
        </div>

        <div className="set-sec">
          {sec === "account" && (
            <React.Fragment>
              <h2>Account</h2><div className="lede">Your identity is an embedded wallet — no seed phrase. You own the key; we never see it.</div>
              <div className="card"><div className="card-bd">
                <KV k="Address"><span className="row" style={{ gap: 8 }}><EntityChip value={SD.L.alice.addr} kind="address" /><CopyBtn text={SD.L.alice.addr} /></span></KV>
                <KV k="Login method" v="Passkey · alice@example.com" />
                <KV k="Linked accounts" v="Google · embedded wallet" />
                <KV k="Embedded wallet" v="Secured by Privy — export anytime, we never hold the key" />
              </div></div>
              <div className="row" style={{ marginTop: 16, gap: 8 }}><button className="btn"><Icon name="download" size={15} /> Export wallet key</button><button className="btn ghost"><Icon name="logout" size={15} /> Sign out</button><button className="btn ghost">Sign out everywhere</button></div>
            </React.Fragment>
          )}

          {sec === "keys" && (
            <React.Fragment>
              <h2>API Keys</h2><div className="lede">Use a key with the REST API (<span className="mono">/api/v1</span>, Etherscan-compatible) and the MCP server (<span className="mono">/api/mcp</span>). Keys are hashed at rest — shown once.</div>
              <div className="card"><div className="card-bd">
                {keys.map((k) => (
                  <div className="keyrow" key={k.id}>
                    <span className="km" style={{ flex: 1 }}>{k.masked}</span>
                    <span className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>{k.created}</span>
                    <div className="quota"><div className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{k.quotaUsed.toLocaleString()} / {k.quotaLimit.toLocaleString()}</div><div className="bar"><i style={{ width: (k.quotaUsed / k.quotaLimit * 100) + "%" }} /></div></div>
                    <button className="btn sm ghost" onClick={() => setKeys(keys.filter((x) => x.id !== k.id))}><Icon name="trash" size={14} /> Revoke</button>
                  </div>
                ))}
                {keys.length === 0 && <div className="empty" style={{ padding: 30 }}><p>No keys yet.</p></div>}
              </div></div>
              <button className="btn primary" style={{ marginTop: 16 }} onClick={() => setModal(true)}><Icon name="plus" size={15} /> Create API key</button>
              <div className="codeblock" style={{ marginTop: 18 }}><pre>{`# REST (Etherscan-compatible)
curl "https://citratescan.ai/api/v1?module=account&action=balance&address=0xf78c…2d915&apikey=YOUR_KEY"

# MCP (for agents)
{ "mcpServers": { "citratescan": {
    "url": "https://citratescan.ai/api/mcp",
    "headers": { "Authorization": "Bearer YOUR_KEY" } } } }`}</pre></div>
            </React.Fragment>
          )}

          {sec === "privacy" && (
            <React.Fragment>
              <h2>Privacy & Data</h2><div className="lede">Control, transparency, and exit. Every control here maps to a real backend — no dead toggles.</div>
              <div className="set-block">
                <div className="h">Encryption status — three classes, three protections</div>
                <div className="card"><div className="card-bd flush">
                  <table className="enc-table">
                    <thead><tr><th>Data</th><th>Protection</th><th>Who can read it</th></tr></thead>
                    <tbody>
                      <tr><td>Settings & logins<br /><span style={{ color: "var(--text-3)", fontSize: 12 }}>watchlist, preferences</span></td><td><span className="enc-pill e2ee">E2EE</span><div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 5 }}>AES-256-GCM, key from your wallet signature → HKDF</div></td><td>Only you — your wallet reproduces the key</td></tr>
                      <tr><td>Issued API keys</td><td><span className="enc-pill hash">HASHED</span><div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 5 }}>salted SHA-256 + pepper, copy-once</div></td><td>No one — not even us</td></tr>
                      <tr><td>Third-party provider keys</td><td><span className="enc-pill aes">AES AT REST</span><div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 5 }}>HKDF(server master, wallet)</div></td><td>The server, at request time — so the agent can use them</td></tr>
                    </tbody>
                  </table>
                </div></div>
                <div className="note" style={{ marginTop: 12 }}><span className="ic"><Icon name="info" size={15} /></span> Your settings and logins are end-to-end encrypted — we store scrambled data only your wallet can unlock. The keys we issue are stored only as a one-way hash. Any provider key you give us is encrypted at rest, but because the server has to use it for you, it can decrypt at request time. We tell you this plainly so you can decide what to entrust.</div>
              </div>
              <div className="set-block">
                <div className="h">What we store</div>
                <div className="card"><div className="card-bd">
                  {[["Watchlist", "E2EE"], ["Settings", "E2EE"], ["Issued API keys", "hash only"], ["Provider keys", "AES-GCM at rest"], ["Query history", "deletable"], ["Public chain data we index", "permanent & public"]].map((r, i) => (
                    <div className="setrow" key={i}><span className="grow lbl">{r[0]}</span><span className="badge" style={{ height: 20 }}>{r[1]}</span></div>
                  ))}
                </div></div>
              </div>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <button className="btn" onClick={exportData}><Icon name="download" size={15} /> Export my data (JSON)</button>
                <button className="btn ghost" onClick={deleteAccount} style={{ color: "var(--danger-text)" }}><Icon name="trash" size={15} /> Delete account & all data</button>
              </div>
              <div className="note amber" style={{ marginTop: 14 }}><span className="ic"><Icon name="info" size={15} /></span> On-chain data the explorer indexes is permanent and public — deleting your account removes your CitrateScan records, not anything on the Citrate ledger, which no one can delete.</div>
            </React.Fragment>
          )}

          {sec === "watchlist" && (
            <React.Fragment>
              <h2>Watchlist & alerts</h2><div className="lede">Addresses and contracts you watch are stored end-to-end encrypted. Alerts run off the indexer.</div>
              <div className="card"><div className="card-bd">
                {watch.map((w, i) => (
                  <div className="setrow" key={i}>
                    <EntityChip value={w.addr} kind="address" label={w.label} />
                    <span className="grow" />
                    <span className="desc">Alert on new activity</span>
                    <Toggle on={w.alert} onClick={() => setWatch(watch.map((x, j) => j === i ? { ...x, alert: !x.alert } : x))} />
                    <button className="btn sm ghost" onClick={() => setWatch(watch.filter((_, j) => j !== i))}><Icon name="trash" size={14} /></button>
                  </div>
                ))}
              </div></div>
              <button className="btn" style={{ marginTop: 14 }}><Icon name="plus" size={15} /> Add address to watch</button>
            </React.Fragment>
          )}

          {sec === "appearance" && (
            <React.Fragment>
              <h2>Appearance</h2><div className="lede">Theme and reading preferences. Stored locally — no account needed.</div>
              <div className="card"><div className="card-bd">
                <div className="setrow"><div className="grow"><div className="lbl">Theme</div><div className="desc">Warm paper, or deep evergreen</div></div>
                  <div className="row" style={{ gap: 6 }}>
                    <button className={"btn sm" + (tweaks.theme === "light" ? " primary" : "")} onClick={() => scan.setTweak("theme", "light")}><Icon name="sun" size={15} /> Light</button>
                    <button className={"btn sm" + (tweaks.theme === "dark" ? " primary" : "")} onClick={() => scan.setTweak("theme", "dark")}><Icon name="moon" size={15} /> Dark</button>
                  </div>
                </div>
                <div className="setrow"><div className="grow"><div className="lbl">Summary verbosity</div><div className="desc">How much the plain-English summary says</div></div>
                  <div className="row" style={{ gap: 6 }}>
                    <button className={"btn sm" + (tweaks.verbosity === "short" ? " primary" : "")} onClick={() => scan.setTweak("verbosity", "short")}>Concise</button>
                    <button className={"btn sm" + (tweaks.verbosity === "full" ? " primary" : "")} onClick={() => scan.setTweak("verbosity", "full")}>Full</button>
                  </div>
                </div>
                <div className="setrow"><div className="grow"><div className="lbl">Reduced motion</div><div className="desc">Pause DAG streaming animation</div></div><Toggle on={tweaks.reducedMotion} onClick={() => scan.setTweak("reducedMotion", !tweaks.reducedMotion)} /></div>
              </div></div>
            </React.Fragment>
          )}

          {sec === "security" && (
            <React.Fragment>
              <h2>Security</h2><div className="lede">CitrateScan is read-only and never holds your funds or signs anything.</div>
              <div className="card"><div className="card-bd">
                <div className="setrow"><div className="grow"><div className="lbl">Active sessions</div><div className="desc">2 devices · macOS, iOS</div></div><button className="btn sm ghost">Revoke all</button></div>
                <div className="setrow"><div className="grow"><div className="lbl">Passkeys</div><div className="desc">1 enrolled</div></div><button className="btn sm">Manage</button></div>
                <div className="setrow"><div className="grow"><div className="lbl">Connected wallets</div><div className="desc">embedded · 1 external</div></div><button className="btn sm">Manage</button></div>
              </div></div>
              <div className="note" style={{ marginTop: 14 }}><span className="ic"><Icon name="shieldCheck" size={15} /></span> There is no signer in the read harness — by construction, the explorer and its agent cannot move funds or write to the chain.</div>
            </React.Fragment>
          )}

          {sec === "transparency" && (
            <React.Fragment>
              <h2>Transparency</h2><div className="lede">Open-source ethos made visible — see exactly what the agent runs under and every read it can make.</div>
              <div className="set-block">
                <div className="h">AI system prompt — verbatim</div>
                <button className="btn sm ghost" onClick={() => setPrompt(!prompt)}><Icon name={prompt ? "chevdown" : "chevright"} size={14} /> {prompt ? "Hide" : "Show"} the exact instructions</button>
                {prompt && <div className="codeblock" style={{ marginTop: 10 }}><pre>{SD.AGENT.SYSTEM_PROMPT}</pre></div>}
              </div>
              <div className="set-block">
                <div className="h">Harness allowlist — the agent's ceiling</div>
                <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                  <div className="card"><div className="card-h"><span className="t" style={{ color: "var(--accent-text)" }}>Allowed · read-only</span></div><div className="card-bd" style={{ maxHeight: 200, overflowY: "auto" }}>{SD.ALLOWLIST.allowed.map((m, i) => <div key={i} className="mono" style={{ fontSize: 12, padding: "3px 0", color: "var(--text-2)" }}>{m}</div>)}</div></div>
                  <div className="card"><div className="card-h"><span className="t" style={{ color: "var(--danger-text)" }}>Forbidden · checked first</span></div><div className="card-bd" style={{ maxHeight: 200, overflowY: "auto" }}>{SD.ALLOWLIST.forbidden.map((m, i) => <div key={i} className="mono" style={{ fontSize: 12, padding: "3px 0", color: "var(--text-3)", textDecoration: "line-through" }}>{m}</div>)}</div></div>
                </div>
              </div>
              <div className="set-block">
                <div className="h">Recent audit log</div>
                <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Op</th><th>Backing</th><th className="num">Latency</th><th>Mode</th><th className="num">Age</th></tr></thead>
                  <tbody>{audit.map((a, i) => (<tr key={i}><td className="mono">{a.op}</td><td className="mono" style={{ color: "var(--text-3)" }}>{a.backing}</td><td className="num mono">{a.latency}ms</td><td>{a.cache ? <span className="badge" style={{ height: 18 }}>cache</span> : <span className="badge green" style={{ height: 18 }}>{a.decoded ? "decoded" : "raw"}</span>}</td><td className="num age">{a.age}</td></tr>))}</tbody></table></div>
              </div>
              <div className="set-block">
                <div className="h">Source · model provenance</div>
                <div className="card"><div className="card-bd">
                  <KV k="Repository" ><span className="row" style={{ gap: 6 }}><span className="mono" style={{ fontSize: 13 }}>github.com/citrate/citrate-explorer</span><Icon name="external" size={13} /></span></KV>
                  <KV k="License" v="MIT" /><KV k="Build" v="v1.0.0 · commit 9f4a2e1" mono />
                  <KV k="Agent model" green><span className="mono" style={{ fontSize: 13 }}>gemma-4-E4B · modelHash 0x4a7c…r12 · runs on Citrate</span></KV>
                </div></div>
              </div>
            </React.Fragment>
          )}

          {sec === "developer" && <DevSection inline />}

          {sec === "about" && (
            <React.Fragment>
              <h2>About</h2><div className="lede">CitrateScan is the AI-native block explorer for the Citrate Network — a public good, open-source, read-only.</div>
              <div className="card"><div className="card-bd">
                <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text-2)", margin: "0 0 14px" }}>Every page leads with plain English. The raw payload is always one tap away — never the front door. The agent reads the chain through the same read-only harness the UI does, and cites every read it makes.</p>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}><button className="btn sm ghost">Status page <Icon name="external" size={13} /></button><button className="btn sm ghost">Changelog</button><button className="btn sm ghost">Contact</button></div>
              </div></div>
            </React.Fragment>
          )}
        </div>
      </div>
      {modal && <CopyOnceModal onClose={() => { setModal(false); setKeys([{ id: "k" + Date.now(), masked: "ctr_sk_live_••••••••••••" + Math.random().toString(16).slice(2, 6), created: "2026-06-02", quotaUsed: 0, quotaLimit: 10000 }, ...keys]); }} />}
    </div>
  );
}

// Developer hub — also reachable at /apis
export function DevSection({ inline }) {
  const Wrap = inline ? React.Fragment : "div";
  return (
    <React.Fragment>
      {!inline && <h1 style={{ fontSize: 30, marginBottom: 6 }}>Developer hub</h1>}
      {inline ? <h2>Developer</h2> : null}
      <div className="lede" style={{ marginBottom: 20 }}>Two programmatic surfaces over one read-only harness: an Etherscan-compatible REST API and an MCP endpoint for agents. Add Citrate to your wallet below.</div>
      <div className="set-block"><div className="h">Endpoints</div>
        <div className="grid" style={{ gridTemplateColumns: "1fr" }}>
          <div className="endpoint"><span className="meth">REST</span><span className="url">/api/v1</span><span className="desc">Etherscan-compatible JSON</span></div>
          <div className="endpoint"><span className="meth">MCP</span><span className="url">/api/mcp</span><span className="desc">tool surface for agents</span></div>
          <div className="endpoint"><span className="meth">RPC</span><span className="url">https://rpc.citrate.ai</span><span className="desc">read methods only</span></div>
          <div className="endpoint"><span className="meth">WSS</span><span className="url">wss://rpc.citrate.ai</span><span className="desc">DAG stream</span></div>
        </div>
      </div>
      <div className="set-block"><div className="h">Add Citrate to your wallet</div>
        <div className="card"><div className="card-bd">
          <div className="grid" style={{ gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
            {[["Chain ID", "40204 · 0x9D0C"], ["Native token", "SALT · 18 decimals"], ["RPC", "rpc.citrate.ai"]].map((m, i) => <div key={i}><div className="eyebrow">{m[0]}</div><div className="mono" style={{ fontSize: 13, marginTop: 4 }}>{m[1]}</div></div>)}
          </div>
          <button className="btn sm primary" style={{ marginTop: 14 }}><Icon name="wallet" size={15} /> Add Citrate to wallet</button>
        </div></div>
      </div>
      <div className="set-block"><div className="h">Quickstart — viem PublicClient</div>
        <div className="codeblock"><pre>{`import { createPublicClient, http } from "viem";

const citrate = createPublicClient({
  chain: { id: 40204, name: "Citrate",
    rpcUrls: { default: { http: ["https://rpc.citrate.ai"] } } },
  transport: http(),
});

const blockNumber = await citrate.getBlockNumber();`}</pre></div>
      </div>
    </React.Fragment>
  );
}

export function DevHub() {
  return (
    <div className="wrap narrow">
      <Crumb items={[{ label: "Home", route: "" }, { label: "Developer hub" }]} />
      <DevSection />
    </div>
  );
}
