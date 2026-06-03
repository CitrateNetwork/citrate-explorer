"use client";

/**
 * Site footer — used in the explorer shell and on the legal pages. Network +
 * build provenance, navigation, legal links, and a control to reopen cookie
 * settings (a GDPR requirement: consent must be withdrawable as easily as given).
 */
import Link from "next/link";
import { useConsent } from "@/lib/consent/client";

const COMMIT = (process.env.NEXT_PUBLIC_COMMIT_SHA || "dev").slice(0, 7);
const VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "0.1.0";

export function SiteFooter() {
  const { reopen } = useConsent();
  return (
    <footer style={wrap}>
      <div style={inner}>
        <div style={brandCol}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}>CitrateScan</div>
          <div style={muted}>The AI-native explorer for the Citrate Network.</div>
          <div style={{ ...mono, marginTop: 8 }}>
            Citrate testnet · chain 40204 · SALT
          </div>
          <div style={{ ...mono, color: "var(--text-3)" }}>
            v{VERSION} · {COMMIT}
          </div>
        </div>

        <nav style={col} aria-label="Explore">
          <div style={head}>Explore</div>
          <Link href="/" style={ln}>Explorer</Link>
          <Link href="/#/dag" style={ln}>Live DAG</Link>
          <Link href="/#/apis" style={ln}>Developer hub</Link>
        </nav>

        <nav style={col} aria-label="Resources">
          <div style={head}>Resources</div>
          <a href="https://github.com/CitrateNetwork/citrate-explorer" style={ln} rel="noreferrer">Source</a>
          <a href="https://citrate.ai" style={ln} rel="noreferrer">Citrate Network</a>
          <a href="/.well-known/security.txt" style={ln}>Security</a>
        </nav>

        <nav style={col} aria-label="Legal">
          <div style={head}>Legal</div>
          <Link href="/privacy" style={ln}>Privacy</Link>
          <Link href="/terms" style={ln}>Terms</Link>
          <Link href="/cookies" style={ln}>Cookie policy</Link>
          <button type="button" onClick={reopen} style={btnLink}>Cookie settings</button>
        </nav>
      </div>
      <div style={bottom}>
        <span style={muted}>© {new Date().getFullYear()} Citrate Foundation. Experimental testnet software — no warranty.</span>
      </div>
    </footer>
  );
}

const wrap: React.CSSProperties = {
  borderTop: "1px solid var(--border, #dbdcd5)",
  background: "var(--surface, #faf8f3)",
  color: "var(--text-2, #555851)",
  fontFamily: "var(--font-sans, system-ui), sans-serif",
  fontSize: 13,
};
const inner: React.CSSProperties = {
  maxWidth: "var(--maxw, 1140px)",
  margin: "0 auto",
  padding: "32px 24px 20px",
  display: "grid",
  gridTemplateColumns: "1.4fr 1fr 1fr 1fr",
  gap: 24,
};
const brandCol: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4 };
const col: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 7, alignItems: "flex-start" };
const head: React.CSSProperties = {
  fontFamily: "var(--font-mono, monospace)",
  fontSize: 11,
  letterSpacing: ".14em",
  textTransform: "uppercase",
  color: "var(--text-3, #8a8c84)",
  marginBottom: 2,
};
const ln: React.CSSProperties = { color: "var(--text-2, #555851)", textDecoration: "none" };
const btnLink: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
  color: "var(--text-2, #555851)",
  font: "inherit",
};
const muted: React.CSSProperties = { color: "var(--text-3, #8a8c84)", fontSize: 12.5, lineHeight: 1.5 };
const mono: React.CSSProperties = { fontFamily: "var(--font-mono, monospace)", fontSize: 12 };
const bottom: React.CSSProperties = {
  borderTop: "1px solid var(--border-2, #e6e5df)",
  padding: "12px 24px",
  maxWidth: "var(--maxw, 1140px)",
  margin: "0 auto",
};
