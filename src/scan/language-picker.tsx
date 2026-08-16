// @ts-nocheck
/* eslint-disable */
"use client";

/**
 * CitrateScan header language switcher. Browser-first: the explorer is authored in
 * English so the browser auto-offers native translation; this lets a visitor force
 * any language, translated on-device where the browser supports it (CSP-clean, no
 * network). Chain data — addresses, hashes, block/tx ids, anything `.mono` or
 * translate="no" — is never translated.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { FEATURED_LANGUAGES, LANGUAGES, findLanguage } from "@/lib/i18n/languages";
import {
  currentLanguage, engineSupported, getSavedLanguage, initFromSaved,
  restoreEnglish, saveLanguage, translateTo,
} from "@/lib/i18n/engine";

function Globe({ size = 17 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" />
    </svg>
  );
}

export function LanguagePicker() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState("en");
  const [status, setStatus] = useState("idle");
  const [query, setQuery] = useState("");
  const [hint, setHint] = useState(null);
  const rootRef = useRef(null);

  useEffect(() => {
    setActive(getSavedLanguage() || "en");
    initFromSaved((s) => setStatus(s)).then(() => setActive(currentLanguage()));
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const activeLang = findLanguage(active) || LANGUAGES[0];
  const busy = status === "checking" || status === "downloading" || status === "translating";

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return LANGUAGES.filter((l) =>
      l.name.toLowerCase().includes(q) || l.native.toLowerCase().includes(q) || l.code.toLowerCase().includes(q));
  }, [query]);

  async function choose(code) {
    setHint(null);
    saveLanguage(code);
    setActive(code);
    setOpen(false);
    setQuery("");
    if (code === "en") { restoreEnglish(); setStatus("idle"); return; }
    const ok = await translateTo(code, (s) => setStatus(s));
    if (!ok) {
      const lang = findLanguage(code);
      setHint(`Your browser can't translate on-device here. Use its built-in “Translate to ${lang ? lang.native : code}” — the translate icon in the address bar, or right-click → Translate.`);
    }
  }

  const row = (l) => (
    <button
      key={l.code}
      type="button"
      role="menuitemradio"
      aria-checked={l.code === active}
      onClick={() => choose(l.code)}
      lang={l.code}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
        width: "100%", padding: "8px 11px", border: "none",
        background: l.code === active ? "var(--accent-tint)" : "transparent",
        color: "var(--text-1)", fontFamily: "var(--font-sans)", fontSize: 13,
        borderRadius: "var(--r-1)", cursor: "pointer", textAlign: "left",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--accent-tint)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = l.code === active ? "var(--accent-tint)" : "transparent")}
    >
      <span style={{ fontWeight: 500 }} translate="no">{l.native}</span>
      <span style={{ fontSize: 11, color: "var(--text-3)" }} translate="no">{l.name === l.native ? l.code : l.name}</span>
    </button>
  );

  return (
    <div ref={rootRef} style={{ position: "relative" }} translate="no">
      <button
        className="hdr-iconbtn"
        title={`Language: ${activeLang.native}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Language: ${activeLang.native}. Change language`}
        onClick={() => setOpen((v) => !v)}
        style={busy ? { borderColor: "rgba(142,204,9,.5)" } : undefined}
      >
        <Globe size={17} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Choose language"
          style={{
            position: "absolute", top: "calc(100% + 8px)", right: 0, width: 300, maxHeight: 430,
            display: "flex", flexDirection: "column",
            background: "var(--surface-2)", border: "1px solid var(--border)",
            borderRadius: "var(--r-2)", boxShadow: "var(--shadow-lift)", overflow: "hidden", zIndex: 200,
          }}
        >
          <div style={{ padding: 9, borderBottom: "1px solid var(--border)" }}>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search 40+ languages…"
              aria-label="Search languages"
              translate="no"
              style={{
                width: "100%", height: 34, padding: "0 10px",
                border: "1px solid var(--border)", borderRadius: "var(--r-1)",
                background: "var(--surface-sunk)", color: "var(--text-1)",
                fontFamily: "var(--font-sans)", fontSize: 13, outline: "none",
              }}
            />
          </div>

          <div style={{ overflowY: "auto", padding: 7 }}>
            <button
              type="button"
              role="menuitemradio"
              aria-checked={active === "en"}
              onClick={() => choose("en")}
              style={{
                display: "flex", width: "100%", justifyContent: "space-between", padding: "8px 11px",
                border: "none", background: active === "en" ? "var(--accent-tint)" : "transparent",
                color: "var(--text-1)", fontFamily: "var(--font-sans)", fontSize: 13,
                borderRadius: "var(--r-1)", cursor: "pointer",
              }}
            >
              <span style={{ fontWeight: 500 }}>English</span>
              <span style={{ fontSize: 11, color: "var(--text-3)" }}>original</span>
            </button>

            {results ? (
              results.length ? results.map(row) : (
                <div style={{ padding: 15, fontSize: 13, color: "var(--text-3)", fontFamily: "var(--font-sans)" }}>No match.</div>
              )
            ) : (
              <>
                <div style={sectionLabel}>Popular</div>
                {FEATURED_LANGUAGES.filter((l) => l.code !== "en").map(row)}
                <div style={sectionLabel}>All languages</div>
                {LANGUAGES.filter((l) => l.code !== "en" && !l.featured).map(row)}
              </>
            )}
          </div>

          <div style={{ padding: "8px 11px", borderTop: "1px solid var(--border)", fontSize: 11, lineHeight: 1.4, color: "var(--text-3)", fontFamily: "var(--font-sans)" }}>
            {hint
              ? hint
              : engineSupported()
                ? "Translated in your browser, on-device. Chain data stays as-is. Pick English to restore."
                : "Your browser will offer to translate automatically. Pick a language to set your preference."}
          </div>
        </div>
      )}
    </div>
  );
}

const sectionLabel = {
  padding: "9px 11px 4px", fontSize: 10, letterSpacing: "0.08em",
  textTransform: "uppercase", color: "var(--text-3)", fontFamily: "var(--font-mono)",
};
