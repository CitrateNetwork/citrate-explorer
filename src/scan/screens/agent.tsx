// @ts-nocheck
/* eslint-disable */
"use client";
// scan-agent.jsx → LIVE. Ask CitrateScan: persistent drawer wired to POST /api/chat
// (Vercel AI SDK v6 useChat). Streams real answers, shows the actual read-only tool
// calls the agent made, and renders every on-chain reference as a clickable chip.
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { SD } from "@/scan/data";
import { Icon } from "@/scan/icons";
import { EntityChip } from "@/scan/components";
import { useScan } from "@/scan/context";
import { useAuth } from "@/lib/auth/client";

const AG = SD.AGENT;

const ENT = {
  alice:      { value: SD.L.alice.addr, kind: "address" },
  bob:        { value: SD.L.bob.addr, kind: "address" },
  foundation: { value: SD.L.foundation.addr, kind: "address", label: "Citrate Foundation" },
  router:     { value: SD.L.router.addr, kind: "contract" },
  treasury:   { value: SD.L.treasury.addr, kind: "contract" },
  market:     { value: SD.L.market.addr, kind: "contract" },
  tipblock:   { value: SD.TIP_BLOCK.hash, kind: "block", label: "#" + SD.TIP_BLOCK.height },
};

// Inline markdown-ish renderer: **bold**, `code`, {{entity}} placeholders, AND raw
// 0x addresses / tx-or-block hashes the agent cites → clickable EntityChips.
function Inline({ text }) {
  const scan = useScan();
  const parts = String(text)
    .split(/(\{\{\w+\}\}|\*\*[^*]+\*\*|`[^`]+`|0x[0-9a-fA-F]{64}|0x[0-9a-fA-F]{40})/g)
    .filter(Boolean);
  return parts.map((p, i) => {
    let m;
    if ((m = p.match(/^\{\{(\w+)\}\}$/))) {
      if (m[1] === "dag") return <a key={i} className="chip labelled" style={{ display: "inline-flex" }} onClick={() => scan.nav("dag")}>Live DAG</a>;
      const e = ENT[m[1]];
      if (e) return <EntityChip key={i} value={e.value} kind={e.kind} label={e.label} noMenu />;
      return <span key={i}>{m[1]}</span>;
    }
    if (/^0x[0-9a-fA-F]{64}$/.test(p)) return <EntityChip key={i} value={p} kind="tx" noMenu />;
    if (/^0x[0-9a-fA-F]{40}$/.test(p)) return <EntityChip key={i} value={p} kind="address" noMenu />;
    if ((m = p.match(/^\*\*([^*]+)\*\*$/))) return <strong key={i}>{m[1]}</strong>;
    if ((m = p.match(/^`([^`]+)`$/))) return <code key={i}>{m[1]}</code>;
    return <span key={i}>{p}</span>;
  });
}

function renderRich(text) {
  const lines = String(text).split("\n");
  const blocks = [];
  let list = null, listType = null;
  const flush = () => { if (list) { blocks.push({ type: listType, items: list }); list = null; listType = null; } };
  lines.forEach((ln) => {
    const t = ln.trim();
    if (!t) { flush(); return; }
    let m;
    if ((m = t.match(/^(\d+)\.\s+(.*)/))) { if (listType !== "ol") { flush(); listType = "ol"; list = []; } list.push(m[2]); }
    else if ((m = t.match(/^[-*]\s+(.*)/))) { if (listType !== "ul") { flush(); listType = "ul"; list = []; } list.push(m[1]); }
    else { flush(); blocks.push({ type: "p", text: t }); }
  });
  flush();
  return blocks.map((b, i) => {
    if (b.type === "p") return <p key={i}><Inline text={b.text} /></p>;
    const Tag = b.type === "ol" ? "ol" : "ul";
    return <Tag key={i}>{b.items.map((it, j) => <li key={j}><Inline text={it} /></li>)}</Tag>;
  });
}

/** Plain text the model has streamed so far. */
function textOf(m) {
  return (m.parts || []).filter((p) => p.type === "text").map((p) => p.text).join("");
}

/** The real read-only tool calls from a message's parts (AI SDK v6 tool parts). */
function toolStepsOf(m) {
  return (m.parts || [])
    .filter((p) => (typeof p.type === "string" && p.type.startsWith("tool-")) || p.type === "dynamic-tool")
    .map((p) => {
      const tool = p.type === "dynamic-tool" ? p.toolName : p.type.slice(5);
      const inp = p.input ?? p.args ?? {};
      let args = "";
      try { args = Object.values(inp).map((v) => (typeof v === "string" && v.length > 18 ? SD.short(v) : v)).join(", "); } catch {}
      const done = p.state === "output-available" || p.state === "result";
      return { tool, args, done };
    });
}

function ToolTrace({ steps, busy }) {
  if (!steps.length && !busy) return null;
  return (
    <div className="trace">
      <div className="trace-h"><span className="ic"><Icon name="terminal" size={13} /></span> tool trace · read-only harness</div>
      {steps.map((s, i) => (
        <div className="trace-step" key={i}>
          <span className="tool">{s.tool}</span>
          <span className="args">({s.args})</span>
          {s.done ? <span className="tick"><Icon name="check" size={13} /></span>
                  : <span className="typing"><i /><i /><i /></span>}
        </div>
      ))}
      {busy && <div className="trace-step"><span className="typing"><i /><i /><i /></span><span className="note" style={{ marginLeft: 8 }}>calling tools…</span></div>}
    </div>
  );
}

const SEED_Q = {
  tx: "Explain this transaction", fail: "Why did this transaction fail?",
  holders: "Who holds the most SALT?", dag: "How does GHOSTDAG order blocks?",
  gas: "Why didn't I pay any gas?", explain: "Explain this",
};

export function AgentPanel({ open, setOpen, defaultOpen, verbosity, agentRef }) {
  const scan = useScan();
  const auth = useAuth();
  const [context, setContext] = useState(null);
  const [input, setInput] = useState("");
  const [token, setToken] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => { auth.getToken().then(setToken).catch(() => {}); }, [auth.authenticated]);

  const transport = useMemo(
    () => new DefaultChatTransport({
      api: "/api/chat",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    }),
    [token],
  );

  const { messages, sendMessage, status, error } = useChat({ transport });
  const busy = status === "submitted" || status === "streaming";

  // Seed an ask, attaching the current entity from the route so the agent can
  // call the right tool (e.g. "Explain this transaction (tx 0x…)").
  const ask = useCallback((seedOrText, label) => {
    setOpen(true);
    let q = SEED_Q[seedOrText] || seedOrText;
    const r = scan && scan.route;
    if (r && r.id && SEED_Q[seedOrText]) q = `${q} (${r.name} ${r.id})`;
    if (label) setContext(label);
    sendMessage({ text: q });
  }, [scan, sendMessage, setOpen]);

  useEffect(() => {
    if (!agentRef) return;
    agentRef.current.ask = ask;
    agentRef.current.setContext = (label) => setContext(label);
  }, [agentRef, ask]);

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages, status]);

  const submit = () => { const t = input.trim(); if (!t || busy) return; setInput(""); sendMessage({ text: t }); };

  if (!open) {
    return (
      <div className="agent collapsed">
        <div className="agent-rail">
          <button className="open-btn" title="Ask CitrateScan" onClick={() => setOpen(true)}>
            <Icon name="spark" size={18} />
            <span className="pulse" />
          </button>
          <span className="vtext">Ask CitrateScan</span>
        </div>
      </div>
    );
  }

  const lastId = messages.length ? messages[messages.length - 1].id : null;

  return (
    <div className="agent">
      <div className="agent-h">
        <span className="spark"><Icon name="spark" size={17} /></span>
        <span className="ttl">Ask CitrateScan</span>
        <span className="spacer" />
        <button title="Collapse" onClick={() => setOpen(false)}><Icon name="arrowright" size={16} /></button>
      </div>
      {context && <div className="agent-ctx"><span className="ic"><Icon name="link" size={13} /></span> Context: {context}</div>}
      <div className="agent-scroll" ref={scrollRef} role="log" aria-live="polite" aria-relevant="additions text" aria-label="Agent conversation">
        {messages.length === 0 && (
          <div className="agent-empty">
            <div className="spark"><Icon name="spark" size={26} /></div>
            <p>I read the chain live, then answer with the exact tools I called and the data I observed. Every on-chain reference is clickable.</p>
            <div className="ec">
              {AG.prompts.map((p, i) => (
                <button key={i} onClick={() => sendMessage({ text: p })}><span className="ic"><Icon name="arrowright" size={15} /></span> {p}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => {
          if (m.role === "user") {
            return <div className="msg user" key={m.id}><div className="bubble">{textOf(m)}</div></div>;
          }
          const steps = toolStepsOf(m);
          const text = textOf(m);
          const streamingThis = busy && m.id === lastId;
          return (
            <div className="msg assistant" key={m.id}>
              <ToolTrace steps={steps} busy={streamingThis && !text} />
              {text && (
                <div className="bubble">
                  {renderRich(text)}
                  {steps.length > 0 && (
                    <div className="sources">
                      <div className="lbl">Sources · reads I made</div>
                      {steps.map((s, i) => <div className="s" key={i}><span className="ic"><Icon name="check" size={12} /></span> {s.tool}({s.args})</div>)}
                    </div>
                  )}
                </div>
              )}
              {!text && !steps.length && streamingThis && (
                <div className="bubble"><span className="typing"><i /><i /><i /></span></div>
              )}
            </div>
          );
        })}
        {error && (
          <div className="msg assistant">
            <div className="bubble" style={{ color: "var(--danger)" }}>
              The agent is unavailable right now — the inference endpoint may not be configured. Live chain reads still work across the explorer.
            </div>
          </div>
        )}
      </div>
      <div className="agent-input">
        <div className="box">
          <textarea rows={1} value={input} placeholder="Ask about this page, or anything on-chain…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} />
          <button className="send" disabled={!input.trim() || busy} onClick={submit}><Icon name="arrowup" size={16} /></button>
        </div>
      </div>
    </div>
  );
}
