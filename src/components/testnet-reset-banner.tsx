"use client";

/**
 * Site-wide testnet reset notice (r1007). Copy, date and dismiss key come from
 * src/lib/notice/testnetReset.ts; the date is the server config value
 * CITRATE_TESTNET_RESET_DATE, passed in by the root layout.
 *
 * Styling uses the Citrate design kit tokens (citrate-design-system-244c4cdf:
 * --font-sans, --font-mono, --t-xs, --tr-eyebrow, semantic warning colors),
 * falling back to CitrateScan's own theme tokens, which carry the same kit
 * values in light and dark.
 *
 * Accessibility: a labelled region (not an alert, it is not urgent), real text
 * contrast on the warning wash, a keyboard-reachable dismiss button with an
 * accessible name. Dismissal is remembered in localStorage per reset date.
 */
import { useState, useSyncExternalStore } from "react";
import { testnetResetNotice } from "@/lib/notice/testnetReset";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function readDismissed(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false; // Storage blocked: the notice simply stays visible.
  }
}

export function TestnetResetBanner({ resetDate }: { resetDate?: string }) {
  const n = testnetResetNotice(resetDate);
  // Server render: not dismissed. Client: the stored choice for this reset date.
  const stored = useSyncExternalStore(subscribe, () => readDismissed(n.dismissKey), () => false);
  const [dismissedNow, setDismissedNow] = useState(false);
  const hidden = stored || dismissedNow;

  if (hidden) return null;

  const dismiss = () => {
    setDismissedNow(true);
    try {
      window.localStorage.setItem(n.dismissKey, "1");
    } catch {
      // Storage blocked: dismissed for this page view only.
    }
  };

  return (
    <section aria-label="Testnet reset notice" style={wrap}>
      <div style={inner}>
        <span style={eyebrow}>{n.title}</span>
        <p style={copy}>
          {n.body}{" "}
          <span style={{ whiteSpace: "nowrap" }}>
            Reset date:{" "}
            {n.dateIso ? <time dateTime={n.dateIso}><strong>{n.dateLabel}</strong></time> : <strong>{n.dateLabel}</strong>}.
          </span>{" "}
          <a href={n.href} style={link}>
            {n.linkLabel}
          </a>
        </p>
        <button type="button" onClick={dismiss} aria-label={n.dismissLabel} style={close}>
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
          </svg>
        </button>
      </div>
    </section>
  );
}

const wrap: React.CSSProperties = {
  background: "var(--warning-bg, var(--semantic-warning-bg, #fff1c4))",
  color: "var(--warning-text, var(--citrate-yellow-dark, #6e5100))",
  borderBottom: "1px solid color-mix(in srgb, var(--warning, var(--semantic-warning, #b07b00)) 30%, transparent)",
  fontFamily: "var(--font-sans, system-ui), sans-serif",
};
const inner: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 12,
  padding: "8px 16px",
  maxWidth: 1440,
  margin: "0 auto",
};
const eyebrow: React.CSSProperties = {
  fontFamily: "var(--font-mono, ui-monospace), monospace",
  fontSize: "var(--t-3xs, 11px)",
  letterSpacing: "var(--tr-eyebrow, 0.14em)",
  textTransform: "uppercase",
  fontWeight: 600,
  paddingTop: 3,
  flexShrink: 0,
};
const copy: React.CSSProperties = {
  margin: 0,
  flex: 1,
  minWidth: 0,
  fontSize: "var(--t-xs, 13px)",
  lineHeight: 1.45,
};
const link: React.CSSProperties = { color: "inherit", textDecoration: "underline", textUnderlineOffset: 2, fontWeight: 500 };
const close: React.CSSProperties = {
  flexShrink: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 32,
  minHeight: 32,
  margin: "-6px -8px -6px 0",
  background: "none",
  border: "none",
  borderRadius: "var(--r-1, 6px)",
  color: "inherit",
  cursor: "pointer",
};
