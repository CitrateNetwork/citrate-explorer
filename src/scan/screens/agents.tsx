// @ts-nocheck
/* eslint-disable */
"use client";

/**
 * AgentSBT screens (HUP US-7.1 AC2): the registered-agents list (#/agents) and one
 * agent (#/agent/<tokenId>) with its DID, holder, parent organization, mint
 * transaction and who sent it. Members mint their own agents (gated on the
 * membership SBT), so the minter is read from the mint transaction, never assumed. Live only: there is no sample fallback, so an empty registry
 * renders "No agents registered yet." instead of invented agents.
 *
 * Data source (Rule 11): /api/agents and /api/agents/[tokenId] (AgentSBT over live RPC).
 */
import React, { useEffect } from "react";
import { SD } from "@/scan/data";
import { Icon } from "@/scan/icons";
import { EntityChip, CopyBtn, SummaryCard, KV, Crumb } from "@/scan/components";
import { useScan } from "@/scan/context";
import { useLiveAgents, useLiveAgent } from "@/scan/live";
import { AGENT_ISSUANCE_LINE } from "@/scan/agentView";
import { ScreenLoading, ScreenError } from "@/scan/screens/states";

function Mono({ text }) {
  return (
    <span className="row" style={{ gap: 6 }}>
      <span className="mono" style={{ fontSize: 12, wordBreak: "break-all" }}>{text}</span>
      {text && text !== "—" && <CopyBtn text={text} />}
    </span>
  );
}

export function AgentsScreen({ before }) {
  const scan = useScan();
  const live = useLiveAgents(before || null);
  const v = live.data;
  useEffect(() => { scan.setCtx("registered agents"); }, []);
  if (!v) return live.loading ? <ScreenLoading label="Loading agents…" /> : <ScreenError error={live.error} />;
  return (
    <div className="wrap">
      <Crumb items={[{ label: "Home", route: "" }, { label: "Agents" }]} />
      <div className="pagehead">
        <div>
          <h1 className="row" style={{ gap: 10 }}><Icon name="shieldCheck" size={24} />Registered agents</h1>
          <div className="sub row" style={{ gap: 8 }}>
            {v.registry ? (
              <React.Fragment><span>AgentSBT</span><EntityChip value={v.registry} kind="contract" noMenu /></React.Fragment>
            ) : <span>No AgentSBT in the address book</span>}
            <span className="badge" style={{ height: 20 }}>{v.total.toLocaleString()} minted</span>
          </div>
        </div>
      </div>

      {v.rows.length === 0 ? (
        <div className="card"><div className="empty" style={{ padding: 50 }} data-testid="agents-empty">
          <div className="ic"><Icon name="user" size={28} /></div>
          <h3>{v.emptyLine}</h3>
          <p>{AGENT_ISSUANCE_LINE} Agents appear here once they are minted on chain {SD.CHAIN.chainId}.</p>
        </div></div>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl"><thead><tr><th>Agent</th><th>Holder</th><th>Parent org</th><th>DID</th><th>Status</th></tr></thead>
            <tbody>{v.rows.map((r) => (
              <tr key={r.tokenId} onClick={() => scan.nav(`agent/${r.tokenId}`)} style={{ cursor: "pointer" }}>
                <td className="mono">#{r.tokenId}</td>
                <td>{r.owner ? <EntityChip value={r.owner} kind="address" noMenu /> : "—"}</td>
                <td className="mono">#{r.parentOrgId}</td>
                <td className="mono" style={{ fontSize: 12 }}>{r.didNamed ? r.didLabel : SD.short(r.didLabel)}</td>
                <td>{r.quarantined ? <span className="badge red"><span className="d" /> quarantined</span> : <span className="badge green"><span className="d" /> active</span>}</td>
              </tr>
            ))}</tbody></table>
          {v.nextBefore && (
            <div className="row" style={{ justifyContent: "center", marginTop: 12 }}>
              <button className="btn sm" onClick={() => scan.nav(`agents/${v.nextBefore}`)}>Older agents <Icon name="arrowright" size={14} /></button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AgentScreen({ id, tweaks }) {
  const scan = useScan();
  const live = useLiveAgent(id);
  const a = live.data;
  useEffect(() => { if (a) scan.setCtx("agent #" + a.tokenId); }, [id, a]);
  if (!a) {
    if (live.loading) return <ScreenLoading label="Loading agent…" />;
    return (
      <div className="wrap">
        <div className="empty" style={{ padding: "90px 20px" }}>
          <div className="ic"><Icon name="search" size={40} /></div>
          <h3>No agent #{id}</h3>
          <p>{live.error || "This token id is not registered."}</p>
          <div className="row" style={{ justifyContent: "center", marginTop: 16 }}><button className="btn" onClick={() => scan.nav("agents")}>All agents</button></div>
        </div>
      </div>
    );
  }
  const org = a.parentOrg;
  return (
    <div className="wrap">
      <Crumb items={[{ label: "Home", route: "" }, { label: "Agents", route: "agents" }, { label: "#" + a.tokenId }]} />
      <div className="pagehead">
        <div>
          <h1 className="row" style={{ gap: 10 }}><Icon name="shieldCheck" size={24} />Agent #{a.tokenId}</h1>
          <div className="sub row" style={{ gap: 8 }}><span>AgentSBT</span><EntityChip value={a.registry} kind="contract" noMenu /></div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {a.quarantined ? <span className="badge red"><span className="d" /> quarantined</span> : <span className="badge green"><span className="d" /> active</span>}
          <span className="badge" style={{ height: 22 }}>soulbound</span>
        </div>
      </div>
      <div style={{ marginBottom: 18 }}><SummaryCard label="What this is" text={{ full: a.summary, short: a.summary }} seed="explain" verbosity={tweaks ? tweaks.verbosity : "full"} /></div>

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="card">
          <div className="card-h"><span className="t">Identity</span></div>
          <div className="card-bd">
            <KV k="Holder">{a.owner ? <EntityChip value={a.owner} kind="address" /> : "—"}</KV>
            <KV k="Minted by">{a.mintSender ? (
              <span className="row" style={{ gap: 6 }}><EntityChip value={a.mintSender} kind="address" noMenu />{a.mintedByHolder && <span className="badge" style={{ height: 20 }}>holder</span>}</span>
            ) : <span className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>mint transaction not in the scanned history</span>}</KV>
            <KV k="DID">{a.didNamed ? <Mono text={a.didLabel} /> : <span className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>not a did:citrate:agent for this holder</span>}</KV>
            <KV k="DID hash"><Mono text={a.didHash} /></KV>
            <KV k="Key fingerprint"><Mono text={a.fingerprint} /></KV>
            <KV k="Token id" v={a.tokenId} mono />
          </div>
        </div>
        <div className="card">
          <div className="card-h"><span className="t">Parent organization</span></div>
          <div className="card-bd">
            <KV k="Org id" v={"#" + org.id} mono />
            <KV k="Status" v={org.active === true ? "active" : org.active === false ? "inactive" : "unknown"} green={org.active === true} />
            <KV k="OrganizationSBT">{org.contract ? <EntityChip value={org.contract} kind="contract" noMenu /> : "—"}</KV>
            <KV k="Signing authority">{org.signingAuthority ? <EntityChip value={org.signingAuthority} kind="address" noMenu /> : "—"}</KV>
            <KV k="Org DID hash"><Mono text={org.did || "—"} /></KV>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <div className="list-head"><div className="eyebrow">Mint and transfers</div></div>
        <div className="tbl-wrap">
          {a.transfers.length ? (
            <table className="tbl"><thead><tr><th>Event</th><th>Transaction</th><th>From</th><th>To</th><th className="num">Block</th></tr></thead>
              <tbody>{a.transfers.map((t, i) => (
                <tr key={i} onClick={() => t.txHash && scan.nav(`tx/${t.txHash}`)} style={{ cursor: t.txHash ? "pointer" : "default" }}>
                  <td><span className="badge" style={{ height: 20 }}>{t.kind}</span></td>
                  <td>{t.txHash ? <EntityChip value={t.txHash} kind="tx" label={SD.short(t.txHash)} noMenu /> : "—"}</td>
                  <td>{t.kind === "mint" ? <span className="mono" style={{ color: "var(--text-3)" }}>mint</span> : <EntityChip value={t.from} kind="address" noMenu />}</td>
                  <td>{t.kind === "burn" ? <span className="mono" style={{ color: "var(--text-3)" }}>burn</span> : <EntityChip value={t.to} kind="address" noMenu />}</td>
                  <td className="num mono">{t.blockNumber ?? "—"}</td>
                </tr>
              ))}</tbody></table>
          ) : <div className="empty" style={{ padding: 40 }}><p>No Transfer logs in the scanned range.</p></div>}
          <div className="note" style={{ marginTop: 10 }}><span className="ic"><Icon name="info" size={15} /></span> {a.historyNote}</div>
        </div>
      </div>
    </div>
  );
}
