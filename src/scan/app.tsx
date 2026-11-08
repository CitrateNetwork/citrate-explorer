// @ts-nocheck
/* eslint-disable */
"use client";

/**
 * CitrateScan app shell. Direction B (owner pick 2026-11-07): the design-system
 * left rail and top line (src/explorer/Shell.tsx) around the hash router, the
 * ⌘K command palette, status banners and the persistent Ask agent panel, which
 * receives the page on screen as a typed AgentContext. Home, DAG, block, tx and
 * address use the direction-B screens in src/explorer/screens on live data; the
 * other screens (contract, verify, token, agents, developer hub, settings) are
 * owned by other lanes and render unchanged inside the new shell.
 */
import { useState, useEffect, useRef, useMemo, Fragment } from "react";
import { ScanProvider, useScan } from "./context";
import { AuthProvider, useAuth } from "@/lib/auth/client";
import { SiteFooter } from "@/components/site-footer";
import { SD } from "./data";
import { SH } from "./harness";
import { Icon } from "./icons";
import { LanguagePicker } from "./language-picker";
import { Banners } from "./components";
import { TokenScreen } from "./screens/entity";
import { ContractScreen } from "./screens/contract";
import { VerifyScreen } from "./screens/verify";
import { AgentsScreen, AgentScreen } from "./screens/agents";
import { AgentPanel } from "./screens/agent";
import { ApproveScreen } from "./approval";
import { SettingsScreen, DevHub } from "./screens/settings";
import { ExplorerFrame } from "@/explorer/Shell";
import { agentContextFromRoute, agentContextLabel } from "@/explorer/agentContext";
import { Home } from "@/explorer/screens/Home";
import { Dag } from "@/explorer/screens/Dag";
import { Block } from "@/explorer/screens/Block";
import { Tx } from "@/explorer/screens/Tx";
import { Address } from "@/explorer/screens/Address";

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
    { label: "DAG ledger", icon: "lattice", route: "dag" },
    { label: "Registered agents", icon: "shieldCheck", route: "agents" },
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
          <input ref={inputRef} value={q} onChange={(e) => { setQ(e.target.value); setIdx(0); }} onKeyDown={onKey} placeholder="Search address, tx, block or token, or ask a question…" />
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

function TopRight() {
  const scan = useScan();
  const auth = useAuth();
  const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
  return (
    <>
      <LanguagePicker />
      <button className="lx-tbtn" title="Settings" aria-label="Settings" onClick={() => scan.nav("account")}><Icon name="settings" size={15} /></button>
      {auth.authenticated ? (
        <button className="lx-tbtn" title="Sign out" onClick={() => auth.logout()}>
          <Icon name="user" size={15} /> <span className="lx-mono">{shortAddr(auth.address)}</span>
        </button>
      ) : (
        <button className="lx-tbtn" title="Log in" onClick={() => auth.login()}>
          <Icon name="user" size={15} /> Log in
        </button>
      )}
    </>
  );
}

const NEW_SCREENS = new Set(["home", "dag", "block", "tx", "address"]);

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

  // The agent's slot: the page on screen, as a typed AgentContext (EXP-AGENT consumes it).
  const agentContext = useMemo(() => agentContextFromRoute(route), [route.name, route.id]);
  const agentLabel = agentContextLabel(agentContext);
  useEffect(() => { scan.setCtx(agentLabel); }, [agentLabel]);

  const states = { indexer: tweaks.showIndexer && !dismissed.indexer, rpc: tweaks.rpcReconnecting && !dismissed.rpc };
  const tweaksForScreens = { theme: tweaks.theme, verbosity: tweaks.verbosity, reducedMotion: tweaks.reducedMotion, warming: tweaks.summaryWarming };

  let view;
  const r = route;
  if (r.name === "tx") view = <Tx key={r.id} hash={r.id} />;
  else if (r.name === "block") view = <Block key={r.id} id={r.id} />;
  else if (r.name === "address") view = <Address key={r.id} addr={r.id} />;
  else if (r.name === "contract") view = <ContractScreen addr={r.id} tweaks={tweaksForScreens} />;
  else if (r.name === "verify") view = <VerifyScreen addr={r.id} />;
  else if (r.name === "token") view = <TokenScreen addr={r.id} tweaks={tweaksForScreens} />;
  else if (r.name === "agents") view = <AgentsScreen before={r.id} />;
  else if (r.name === "agent") view = <AgentScreen id={r.id} tweaks={tweaksForScreens} />;
  else if (r.name === "dag") view = <Dag selected={r.id || null} />;
  else if (r.name === "dev") view = <DevHub />;
  else if (r.name === "settings") view = <SettingsScreen tweaks={tweaks} />;
  else if (r.name === "approve") view = <ApproveScreen payload={r.id || ""} onDone={() => scan.nav("")} onOpenTx={(h) => scan.nav(`tx/${h}`)} />;
  else view = <Home />;

  return (
    <ExplorerFrame
      routeName={r.name}
      agentContext={agentContext}
      agentOpen={agentOpen}
      onAsk={() => setAgentOpen(true)}
      onSearch={scan.search}
      onCmd={() => setCmd(true)}
      theme={tweaks.theme}
      onTheme={(t) => scan.setTweak("theme", t)}
      topRight={<TopRight />}
      legacy={!NEW_SCREENS.has(r.name)}
      footer={<SiteFooter />}
      agent={<AgentPanel open={agentOpen} setOpen={setAgentOpen} verbosity={tweaks.verbosity} agentRef={agentRef} pageContext={agentContext} pageContextLabel={agentLabel} />}
    >
      <Banners states={states} dismiss={(k) => setDismissed((d) => ({ ...d, [k]: true }))} />
      {view}
      <CommandPalette open={cmd} onClose={() => setCmd(false)} />
    </ExplorerFrame>
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
