"use client";

/**
 * Direction-B app shell: the deep-evergreen left rail of the kit's operator
 * console (white marquee), a top line with search, live chain status, the Ask
 * button for the agent, language and sign-in, and the document column. The
 * agent panel is passed in as a slot and docks on the right.
 */
import { useState, type ReactNode } from "react";
import { Icon as ScanIcon } from "@/scan/icons";
import { useLedger } from "./api";
import { fmtNum } from "./format";
import { agentContextLabel, type AgentContext } from "./agentContext";

/** The app's 1.5 px single-stroke icon set (src/scan/icons.tsx, untyped), typed for this file. */
const Icon = ScanIcon as unknown as (p: { name: string; size?: number }) => ReactNode;

export type ThemePref = "system" | "light" | "dark";

interface NavItem {
  label: string;
  route: string;
  icon: string;
  match: string[];
}

const NAV: Array<{ section: string; items: NavItem[] }> = [
  {
    section: "Network",
    items: [
      { label: "Network state", route: "", icon: "gauge", match: ["home"] },
      { label: "DAG ledger", route: "dag", icon: "lattice", match: ["dag"] },
    ],
  },
  {
    section: "Agents",
    items: [{ label: "Registered agents", route: "agents", icon: "shieldCheck", match: ["agents", "agent"] }],
  },
  {
    section: "Build",
    items: [
      { label: "Developer API", route: "apis", icon: "code", match: ["dev"] },
      { label: "Settings", route: "account", icon: "settings", match: ["settings"] },
    ],
  },
];

function LiveStatus() {
  const { data, error } = useLedger(60);
  if (!data) return <span className="lx-live">{error ? <><span className="lx-live-dot off" aria-hidden="true" />Node not answering</> : "Connecting…"}</span>;
  const fin = data.finality?.published ? data.finality.finalized?.height ?? null : null;
  return (
    <span className="lx-live" title="eth_blockNumber and citrate_getDagStats tips; finality from citrate_getFinalityStatus">
      <span className={`lx-live-dot${data._stale ? " off" : ""}`} aria-hidden="true" />
      HEIGHT {fmtNum(data.head)} · TIPS {data.dag?.tipsCount ?? "n/a"}
      {fin != null ? ` · FIN ${fmtNum(fin)}` : ""}
    </span>
  );
}

export function ExplorerFrame({
  routeName,
  agentContext,
  agentOpen,
  onAsk,
  onSearch,
  onCmd,
  theme,
  onTheme,
  topRight,
  agent,
  footer,
  legacy,
  children,
}: {
  routeName: string;
  agentContext: AgentContext;
  agentOpen: boolean;
  onAsk: () => void;
  onSearch: (q: string) => void;
  onCmd: () => void;
  theme: ThemePref;
  onTheme: (t: ThemePref) => void;
  topRight: ReactNode;
  agent: ReactNode;
  footer: ReactNode;
  legacy: boolean;
  children: ReactNode;
}) {
  const [q, setQ] = useState("");
  const nextTheme: ThemePref = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
  return (
    <div className="lx-frame">
      <div className="lx-rail-col">
      <aside className="lx-rail" aria-label="Explorer navigation">
        <a className="lx-mark" href="#/" aria-label="CitrateScan home" translate="no">
          {/* The canonical marquee, white on the evergreen rail (kit README, console sidebar). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/citrate_marquee_white.svg" alt="Citrate" width={70} height={22} />
          <span className="lx-mark-s">Scan · chain 40204</span>
        </a>
        <nav className="lx-nav" aria-label="Main">
          {NAV.map((s) => (
            <div key={s.section} style={{ display: "contents" }}>
              <span className="lx-nav-l">{s.section}</span>
              {s.items.map((it) => (
                <a key={it.label} href={`#/${it.route}`} aria-current={it.match.includes(routeName) ? "page" : undefined}>
                  <Icon name={it.icon} size={16} />
                  <span>{it.label}</span>
                </a>
              ))}
            </div>
          ))}
        </nav>
        <div className="lx-rail-foot">
          <span className="lx-rf-note">
            <span className="lx-mono">Citrate testnet</span> · chain 40204. Read-only views of live RPC.
          </span>
          <button className="lx-rbtn" type="button" onClick={() => onTheme(nextTheme)} aria-label={`Theme: ${theme}. Switch to ${nextTheme}`}>
            Theme: {theme === "system" ? "System" : theme === "light" ? "Light" : "Dark"}
          </button>
        </div>
      </aside>
      </div>
      <div className="lx-doc">
        <div className="lx-top">
          <form
            className="lx-search"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              if (q.trim()) {
                onSearch(q.trim());
                setQ("");
              }
            }}
          >
            <span className="lx-si"><Icon name="search" size={16} /></span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Block height or hash, transaction, address, or a question" aria-label="Search block, transaction or address, or ask the agent" />
            <kbd onClick={onCmd} title="Command palette">⌘K</kbd>
          </form>
          <LiveStatus />
          <div className="lx-top-r">
            {!agentOpen ? (
              <button type="button" className="lx-tbtn lx-ask" onClick={onAsk} title={`Ask about: ${agentContextLabel(agentContext)}`}>
                <Icon name="spark" size={15} /> Ask
              </button>
            ) : null}
            {topRight}
          </div>
        </div>
        <main className={`lx-main${legacy ? " lx-legacy" : ""}`} id="main-content" tabIndex={-1}>
          {children}
        </main>
        {footer}
      </div>
      {agent}
    </div>
  );
}
