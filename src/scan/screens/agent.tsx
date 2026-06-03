// @ts-nocheck
/* eslint-disable */
"use client";
// scan-agent.jsx — Ask CitrateScan. Persistent drawer. Simulated tool-calling:
// shows AgentToolTrace, streams cited answers, renders on-chain refs as clickable chips.
import { useState, useEffect, useRef, useCallback } from "react";
import { SD } from "@/scan/data";
import { Icon } from "@/scan/icons";
import { EntityChip } from "@/scan/components";
import { useScan } from "@/scan/context";

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

function Inline({ text }) {
  const scan = useScan();
  const parts = String(text).split(/(\{\{\w+\}\}|\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((p, i) => {
    let m;
    if ((m = p.match(/^\{\{(\w+)\}\}$/))) {
      if (m[1] === "dag") return <a key={i} className="chip labelled" style={{ display: "inline-flex" }} onClick={() => scan.nav("dag")}>Live DAG</a>;
      const e = ENT[m[1]];
      if (e) return <EntityChip key={i} value={e.value} kind={e.kind} label={e.label} noMenu />;
      return <span key={i}>{m[1]}</span>;
    }
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

function ToolTrace({ steps, revealed }) {
  return (
    <div className="trace">
      <div className="trace-h"><span className="ic"><Icon name="terminal" size={13} /></span> tool trace · read-only harness</div>
      {steps.slice(0, revealed).map((s, i) => (
        <div className="trace-step" key={i}>
          <span className="tool">{s.tool}</span>
          <span className="args">({s.args})</span>
          <span className="note">{s.note}</span>
          <span className="tick"><Icon name="check" size={13} /></span>
        </div>
      ))}
      {revealed < steps.length && (
        <div className="trace-step"><span className="typing"><i /><i /><i /></span><span className="note" style={{ marginLeft: 8 }}>calling tools…</span></div>
      )}
    </div>
  );
}

function resolveScript(q) {
  for (const s of AG.scripts) if (s.match.test(q)) return s;
  return null;
}
const SEED_Q = {
  tx: "Explain this transaction", fail: "Why did this transaction fail?",
  holders: "Who holds the most SALT?", dag: "How does GHOSTDAG order blocks?",
  gas: "Why didn't I pay any gas?", explain: "Explain this entity",
};

export function AgentPanel({ open, setOpen, defaultOpen, verbosity, agentRef }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [context, setContext] = useState(null);
  const scrollRef = useRef(null);

  const pushAnswer = useCallback((questionText, ctxLabel) => {
    const script = resolveScript(questionText) || { trace: AG.fallback.trace, answer: AG.fallback.answer, sources: AG.fallback.sources };
    const id = "m" + Date.now();
    setMessages((prev) => [...prev,
      { id: id + "u", role: "user", text: questionText },
      { id, role: "assistant", trace: script.trace, answer: script.answer, sources: script.sources, revealed: 0, streaming: true },
    ]);
    // reveal trace steps then answer
    let step = 0;
    const iv = setInterval(() => {
      step += 1;
      setMessages((prev) => prev.map((m) => m.id === id ? { ...m, revealed: Math.min(step, m.trace.length) } : m));
      if (step >= script.trace.length) {
        clearInterval(iv);
        setTimeout(() => setMessages((prev) => prev.map((m) => m.id === id ? { ...m, streaming: false } : m)), 380);
      }
    }, 520);
  }, []);

  // imperative API for app / affordances
  useEffect(() => {
    if (!agentRef) return;
    agentRef.current.ask = (seedOrText, label) => {
      setOpen(true);
      const q = SEED_Q[seedOrText] || seedOrText;
      if (label) setContext(label);
      setTimeout(() => pushAnswer(q, label), 120);
    };
    agentRef.current.setContext = (label) => setContext(label);
  }, [agentRef, pushAnswer, setOpen]);

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages]);

  const submit = () => { const t = input.trim(); if (!t) return; setInput(""); pushAnswer(t); };

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

  return (
    <div className="agent">
      <div className="agent-h">
        <span className="spark"><Icon name="spark" size={17} /></span>
        <span className="ttl">Ask CitrateScan</span>
        <span className="spacer" />
        <button title="Collapse" onClick={() => setOpen(false)}><Icon name="arrowright" size={16} /></button>
      </div>
      {context && <div className="agent-ctx"><span className="ic"><Icon name="link" size={13} /></span> Context: {context}</div>}
      <div className="agent-scroll" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="agent-empty">
            <div className="spark"><Icon name="spark" size={26} /></div>
            <p>I read the chain and the index live, then answer with the exact tools I called and the block I observed. Every on-chain reference is clickable.</p>
            <div className="ec">
              {AG.prompts.map((p, i) => (
                <button key={i} onClick={() => pushAnswer(p)}><span className="ic"><Icon name="arrowright" size={15} /></span> {p}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          m.role === "user" ? (
            <div className="msg user" key={m.id}><div className="bubble">{m.text}</div></div>
          ) : (
            <div className="msg assistant" key={m.id}>
              <ToolTrace steps={m.trace} revealed={m.revealed} />
              {!m.streaming && (
                <div className="bubble">
                  {renderRich(m.answer)}
                  <div className="sources">
                    <div className="lbl">Sources · reads I made</div>
                    {m.sources.map((s, i) => <div className="s" key={i}><span className="ic"><Icon name="check" size={12} /></span> {s}</div>)}
                  </div>
                </div>
              )}
            </div>
          )
        ))}
      </div>
      <div className="agent-input">
        <div className="box">
          <textarea rows={1} value={input} placeholder="Ask about this page, or anything on-chain…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} />
          <button className="send" disabled={!input.trim()} onClick={submit}><Icon name="arrowup" size={16} /></button>
        </div>
      </div>
    </div>
  );
}
