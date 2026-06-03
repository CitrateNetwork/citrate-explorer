"use client";

/**
 * First-visit cookie/storage consent banner. Region-aware (GDPR opt-in, CCPA
 * opt-out, standard). Shown until a choice is recorded; reopenable from the
 * footer. Uses the design's tokens so it reads as part of CitrateScan.
 */
import { useState } from "react";
import Link from "next/link";
import { useConsent } from "@/lib/consent/client";

export function ConsentBanner() {
  const { needed, managing, regime, acceptAll, rejectAll, save, setManaging } = useConsent();
  const [analytics, setAnalytics] = useState(false);
  const [preferences, setPreferences] = useState(true);

  if (!needed && !managing) return null;

  const gdpr = regime === "gdpr";
  const ccpa = regime === "ccpa";

  return (
    <div role="dialog" aria-label="Cookie and storage consent" style={scrim}>
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <strong style={{ fontFamily: "var(--font-display)", fontSize: 16 }}>
            Your data, your choice
          </strong>
          <span style={pill}>{regime.toUpperCase()}</span>
        </div>

        <p style={copy}>
          CitrateScan uses <strong>essential</strong> local storage to keep you
          signed in and remember your preferences. We do <strong>not</strong> use
          advertising or cross-site tracking. {gdpr && "Non-essential storage stays off until you accept."}
          {ccpa && " We do not sell or share your personal information."} See our{" "}
          <Link href="/cookies" style={link}>Cookie Policy</Link> and{" "}
          <Link href="/privacy" style={link}>Privacy Policy</Link>.
        </p>

        {managing && (
          <div style={{ margin: "10px 0", display: "grid", gap: 8 }}>
            <Row label="Essential" desc="Login session, theme, this consent record." checked disabled />
            <Row label="Preferences" desc="Remember view settings across visits." checked={preferences} onChange={setPreferences} />
            <Row label="Analytics" desc="Anonymous usage to improve the explorer (none today)." checked={analytics} onChange={setAnalytics} />
          </div>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
          {managing ? (
            <button style={btnPrimary} onClick={() => save({ analytics, preferences })}>
              Save choices
            </button>
          ) : (
            <>
              <button style={btnPrimary} onClick={acceptAll}>Accept all</button>
              <button style={btn} onClick={rejectAll}>
                {gdpr ? "Reject non-essential" : "Essential only"}
              </button>
              <button style={btnGhost} onClick={() => setManaging(true)}>Manage</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  desc,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: disabled ? "default" : "pointer" }}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange && onChange(e.target.checked)}
        style={{ marginTop: 3 }}
      />
      <span>
        <span style={{ fontWeight: 500 }}>{label}</span>
        <span style={{ display: "block", color: "var(--text-3)", fontSize: 12.5 }}>{desc}</span>
      </span>
    </label>
  );
}

const scrim: React.CSSProperties = {
  position: "fixed",
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 200,
  display: "flex",
  justifyContent: "center",
  padding: 16,
  pointerEvents: "none",
};
const card: React.CSSProperties = {
  pointerEvents: "auto",
  maxWidth: 560,
  width: "100%",
  background: "var(--surface-2, #fff)",
  border: "1px solid var(--border, #dbdcd5)",
  borderRadius: "var(--r-3, 14px)",
  boxShadow: "var(--shadow-lift, 0 14px 38px -18px rgba(14,15,12,.3))",
  padding: 18,
  color: "var(--text-1, #0e0f0c)",
  fontFamily: "var(--font-sans, system-ui), sans-serif",
};
const copy: React.CSSProperties = { fontSize: 13.5, lineHeight: 1.55, color: "var(--text-2, #555851)", margin: 0 };
const link: React.CSSProperties = { color: "var(--accent-text, #4f7304)" };
const pill: React.CSSProperties = {
  fontFamily: "var(--font-mono, monospace)",
  fontSize: 10,
  letterSpacing: ".1em",
  padding: "2px 7px",
  borderRadius: 999,
  border: "1px solid var(--border, #dbdcd5)",
  color: "var(--text-3, #8a8c84)",
};
const btnBase: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: "var(--r-1, 6px)",
  fontSize: 13,
  cursor: "pointer",
  fontFamily: "inherit",
};
const btnPrimary: React.CSSProperties = { ...btnBase, background: "var(--accent, #8ecc09)", color: "#0e0f0c", border: "1px solid var(--accent, #8ecc09)" };
const btn: React.CSSProperties = { ...btnBase, background: "var(--surface, #faf8f3)", color: "var(--text-1, #0e0f0c)", border: "1px solid var(--border, #dbdcd5)" };
const btnGhost: React.CSSProperties = { ...btnBase, background: "transparent", color: "var(--text-2, #555851)", border: "1px solid transparent" };
