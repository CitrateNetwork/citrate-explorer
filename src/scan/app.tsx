// @ts-nocheck
/* eslint-disable */
"use client";

/**
 * CitrateScan app shell (ported from scan-app.jsx): header with the marquee logo
 * + omni-search, the ⌘K command palette, status banners, the hash router, and the
 * persistent Ask-CitrateScan agent drawer. The design-tool Tweaks overlay is
 * intentionally dropped (it's an editor affordance, not product); theme/verbosity
 * live in the real Settings screen.
 */
import { useState, useEffect, useRef, Fragment } from "react";
import { ScanProvider, useScan } from "./context";
import { AuthProvider, useAuth } from "@/lib/auth/client";
import { SiteFooter } from "@/components/site-footer";
import { SD } from "./data";
import { SH } from "./harness";
import { Icon, Logo } from "./icons";
import { LanguagePicker } from "./language-picker";
import { ChainBadge, Banners } from "./components";
import { Home } from "./screens/home";
import { TxScreen } from "./screens/tx";
import { BlockScreen, AddressScreen, TokenScreen } from "./screens/entity";
import { ContractScreen } from "./screens/contract";
import { VerifyScreen } from "./screens/verify";
import { DagView } from "./screens/dag";
import { AgentPanel } from "./screens/agent";
import { SettingsScreen, DevHub } from "./screens/settings";

function CommandPalette({ open, onClose }) {
  const scan = useScan();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef(null);
  useEffect(() => {
    if (open) {
      setQ("");
      setIdx(0);
      setTimeout(() => inputRef.current && inputRef.current.focus(), 30);
    }
  }, [open]);
  if (!open) return null;
  const jumps = [
    { label: "Home", icon: "search", route: "" },
    { label: "Live DAG", icon: "lattice", route: "dag" },
    { label: "Developer hub", icon: "code", route: "apis" },
    { label: "Settings", icon: "settings", route: "account" },
  ];
  const cls = q.trim() ? SH.classify(q.trim()) : null;
  const entityRow =
    cls && cls.kind !== "search" && cls.kind !== "empty"
      ? {
          label: `Open ${cls.kind} ${SD.short(cls.value)}`,
          icon: "arrowright",
          action: () => { scan.search(q.trim()); onClose(); },
        }
      : null;
  const filteredJumps = jumps.filter((j) => !q.trim() || j.label.toLowerCase().includes(q.toLowerCase()));
  const askRow = q.trim()
    ? { ask: true, label: `Ask the agent: "${q.trim()}"`, action: () => { scan.ask(q.trim()); onClose(); } }
    : null;
  const rows = [entityRow, ...filteredJumps.map((j) => ({ ...j, action: () => { scan.nav(j.route); onClose(); } })), askRow].filter(Boolean);

  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(rows.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); rows[idx] && rows[idx].action(); }
    else if (e.key === "Escape") onClose();
  };
  return (
    <div className="cmdk-scrim" onClick={onClose}>
      <div className="cmdk" onClick={(e) => e.stopPropagation()}>
        <div className="cmdk-in">
          <span className="ic"><Icon name="search" size={18} /></span>
          <input ref={inputRef} value={q} onChange={(e) => { setQ(e.target.value); setIdx(0); }} onKeyDown={onKey} placeholder="Search address, tx, block, token — or ask a question…" />
          <span className="kbd mono" style={{ fontSize: 11, color: "var(--text-3)" }}>esc</span>
        </div>
        <div className="cmdk-list">
          {entityRow && <div className="cmdk-sec">Resolved</div>}
          {rows.map((r, i) => (
            <Fragment key={i}>
              {i === (entityRow ? 1 : 0) && <div className="cmdk-sec">Jump to</div>}
              {r.ask && <div className="cmdk-sec">Ask</div>}
              <div className={"cmdk-item" + (idx === i ? " active" : "")} onMouseEnter={() => setIdx(i)} onClick={r.action}>
                <span className="ic"><Icon name={r.ask ? "spark" : r.icon || "arrowright"} size={16} /></span>
                <span className={r.ask ? "ask" : ""}>{r.label}</span>
              </div>
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

function Header({ onSearch, onCmd, agentOpen, onToggleAgent, rpc }) {
  const scan = useScan();
  const auth = useAuth();
  const [q, setQ] = useState("");
  const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
  return (
    <header className="hdr">
      <div className="hdr-logo" onClick={() => scan.nav("")} translate="no">
        <Logo height={22} />
        <span className="scan">Scan</span>
      </div>
      <div className="hdr-search">
        <span className="si"><Icon name="search" size={17} /></span>
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) { onSearch(q.trim()); setQ(""); } }}
          placeholder="Search by address, tx hash, block, token — or ask a question" aria-label="Omni-search" />
        <span className="kbd" onClick={onCmd} style={{ cursor: "pointer" }}>⌘K</span>
      </div>
      <div className="hdr-right">
        <ChainBadge rpc={rpc} />
        {!agentOpen && <button className="hdr-iconbtn" title="Ask CitrateScan" onClick={onToggleAgent}><Icon name="spark" size={17} /></button>}
        <LanguagePicker />
        <button className="hdr-iconbtn" title="Settings" onClick={() => scan.nav("account")}><Icon name="settings" size={17} /></button>
        {auth.authenticated ? (
          <button className="btn-login authed" title="Sign out" onClick={() => auth.logout()}>
            <Icon name="user" size={15} /> <span className="mono">{shortAddr(auth.address)}</span>
          </button>
        ) : (
          <button className="btn-login" title="Log in" onClick={() => auth.login()}>
            <Icon name="user" size={15} /> Log in
          </button>
        )}
      </div>
    </header>
  );
}

function Shell() {
  const scan = useScan();
  const { route, agentOpen, setAgentOpen, agentRef, tweaks } = scan;
  const [cmd, setCmd] = useState(false);
  const [dismissed, setDismissed] = useState({});

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCmd((c) => !c); }
      else if (e.key === "/" && document.activeElement && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); setCmd(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const states = { indexer: tweaks.showIndexer && !dismissed.indexer, rpc: tweaks.rpcReconnecting && !dismissed.rpc };
  const tweaksForScreens = { theme: tweaks.theme, verbosity: tweaks.verbosity, reducedMotion: tweaks.reducedMotion, warming: tweaks.summaryWarming };

  let view;
  const r = route;
  if (r.name === "tx") view = <TxScreen hash={r.id} tweaks={tweaksForScreens} />;
  else if (r.name === "block") view = <BlockScreen id={r.id} tweaks={tweaksForScreens} />;
  else if (r.name === "address") view = <AddressScreen addr={r.id} tweaks={tweaksForScreens} />;
  else if (r.name === "contract") view = <ContractScreen addr={r.id} tweaks={tweaksForScreens} />;
  else if (r.name === "verify") view = <VerifyScreen addr={r.id} />;
  else if (r.name === "token") view = <TokenScreen addr={r.id} tweaks={tweaksForScreens} />;
  else if (r.name === "dag") view = <DagView reducedMotion={tweaks.reducedMotion} />;
  else if (r.name === "dev") view = <DevHub />;
  else if (r.name === "settings") view = <SettingsScreen tweaks={tweaks} />;
  else view = <Home tweaks={tweaksForScreens} />;

  return (
    <div className="app">
      <Header onSearch={scan.search} onCmd={() => setCmd(true)} agentOpen={agentOpen} onToggleAgent={() => setAgentOpen(true)} rpc={states.rpc} />
      <Banners states={states} dismiss={(k) => setDismissed((d) => ({ ...d, [k]: true }))} />
      <div className="main">
        <div className="content" id="main-content" role="main" tabIndex={-1}>{view}</div>
        <AgentPanel open={agentOpen} setOpen={setAgentOpen} verbosity={tweaks.verbosity} agentRef={agentRef} />
      </div>
      <SiteFooter />
      <CommandPalette open={cmd} onClose={() => setCmd(false)} />
    </div>
  );
}

export function CitrateScanApp() {
  return (
    <AuthProvider>
      <ScanProvider>
        <Shell />
      </ScanProvider>
    </AuthProvider>
  );
}
