import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Space_Grotesk, Geist, Geist_Mono } from "next/font/google";
import "../scan/scan.css";
import "../scan/scan-ui.css";
// Direction B (2026-11-07): the Citrate design-system tokens, then the explorer
// layer (dark theme, legacy-token remap, lx-* components). Loaded last so the
// kit wins over the older CitrateScan tokens.
import "../explorer/kit/tokens.css";
import "../explorer/ledger.css";
import "../scan/approval.css";
import { ConsentProvider } from "@/lib/consent/client";
import { ConsentBanner } from "@/components/consent-banner";
import { TestnetResetBanner } from "@/components/testnet-reset-banner";
import { DESCRIPTION, KEYWORDS, TITLE, TWITTER_DESCRIPTION } from "@/lib/site/metadata";

// The design system's three faces, self-hosted via next/font (no external
// request, so the CSP stays tight): Space Grotesk for display, Geist for the UI,
// Geist Mono for data and compliance labels.
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk", display: "swap" });
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });
const fontVars = `${spaceGrotesk.variable} ${geist.variable} ${geistMono.variable}`;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://explorer.citrate.ai";
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: "%s · CitrateScan" },
  description: DESCRIPTION,
  applicationName: "CitrateScan",
  category: "technology",
  keywords: KEYWORDS,
  authors: [{ name: "Citrate" }],
  creator: "Citrate",
  publisher: "Citrate",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "CitrateScan",
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: TWITTER_DESCRIPTION,
  },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large" } },
};

export const viewport: Viewport = {
  themeColor: "#0f2a1a",
  colorScheme: "light dark",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Per-request CSP nonce from the proxy (SECREM-02 WP 7.1). Reading headers()
  // makes every route dynamic — required: a nonce'd CSP cannot serve build-time
  // prerendered HTML (its inline scripts would carry a stale or missing nonce).
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" className={fontVars} suppressHydrationWarning>
      <head>
        {/* No-flash theme: apply the saved theme/accent before first paint.
            Nonce'd so it survives the strict (no unsafe-inline) script-src. */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `(function(){var d=document.documentElement,t={};try{t=JSON.parse(localStorage.getItem("citrate.tweaks")||"{}")||{};}catch(e){}var p=t.theme==="light"||t.theme==="dark"?t.theme:"system";var m=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches;d.setAttribute("data-theme",p==="system"?(m?"dark":"light"):p);if(t.accent)d.style.setProperty("--accent",t.accent);})();`,
          }}
        />
      </head>
      <body>
        {/* Keyboard skip link — first focusable element; jumps past the header. */}
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        {/* Server-rendered fallback for non-JS crawlers / AI indexers (the live
            explorer is a client SPA). Honest, mirrors the product. */}
        <noscript>
          <div style={{ maxWidth: 760, margin: "48px auto", padding: 24, fontFamily: "system-ui, sans-serif", lineHeight: 1.5 }}>
            <h1>CitrateScan, the block explorer for the Citrate Network</h1>
            <p>{DESCRIPTION}</p>
            <p>
              Citrate is a GHOSTDAG BlockDAG (chain 40204) built for AI: on-chain models, LoRA
              adapters, federated learning, autonomous agents, x402 payments, and DePIN compute.
              It is EVM-compatible.
            </p>
            <p>
              The interactive explorer needs JavaScript. Reference pages:{" "}
              <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/cookies">Cookies</a>.
            </p>
          </div>
        </noscript>
        {/* r1007 testnet reset notice. Date: CITRATE_TESTNET_RESET_DATE (YYYY-MM-DD), else "to be announced". */}
        <TestnetResetBanner resetDate={process.env.CITRATE_TESTNET_RESET_DATE} />
        <ConsentProvider>
          {children}
          <ConsentBanner />
        </ConsentProvider>
      </body>
    </html>
  );
}
