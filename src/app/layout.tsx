import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Space_Grotesk, Geist, Geist_Mono, Cormorant } from "next/font/google";
import "../scan/scan.css";
import "../scan/scan-ui.css";
import { ConsentProvider } from "@/lib/consent/client";
import { ConsentBanner } from "@/components/consent-banner";

// Brand type system, self-hosted via next/font (no external request — keeps the
// CSP tight and kills FOUT). Space Grotesk = display/titles, Geist Mono = data,
// Cormorant = editorial/supporting serif, Geist = neutral UI body.
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk", display: "swap" });
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });
const cormorant = Cormorant({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-cormorant", display: "swap" });
const fontVars = `${spaceGrotesk.variable} ${geist.variable} ${geistMono.variable} ${cormorant.variable}`;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://explorer.citrate.ai";
const TITLE = "CitrateScan — AI-native block explorer for the Citrate Network";
const DESCRIPTION =
  "CitrateScan is the AI-native block explorer for the Citrate Network — a GHOSTDAG " +
  "BlockDAG built for AI. Track on-chain models, LoRA adapters, federated learning " +
  "rounds, autonomous agents, x402 payments and DePIN compute; search any address, " +
  "tx or block; watch the live DAG; verify contracts; or just ask the built-in agent " +
  "in plain English. EVM-compatible and gasless, with an Etherscan-compatible API and " +
  "an MCP endpoint so your own agents can read the chain.";

// Broad but honest term coverage. The product really does touch all of these —
// it's an explorer for an AI/DePIN L1 in the orbit of these ecosystems.
const KEYWORDS = [
  "CitrateScan", "Citrate", "Citrate Network", "block explorer", "blockchain explorer",
  "GHOSTDAG", "BlockDAG", "SALT", "chain 40204", "EVM", "smart contracts",
  "contract verification", "Etherscan", "Etherscan-compatible API", "MCP", "web3",
  "AI blockchain", "AI-native blockchain", "decentralized AI", "on-chain AI", "AI agents",
  "autonomous agents", "agentic", "inference", "model registry", "LoRA", "LoRA adapters",
  "federated learning", "DePIN", "x402", "micropayments", "compute marketplace",
  "Ethereum", "Solana", "Akash", "Render", "Bittensor", "crypto", "L1",
];

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
    description:
      "The AI-native explorer for the Citrate Network — a GHOSTDAG BlockDAG for AI: " +
      "models, LoRAs, federated learning, agents, x402, DePIN. Ask the chain in plain English.",
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
    <html lang="en" data-theme="light" className={fontVars} suppressHydrationWarning>
      <head>
        {/* No-flash theme: apply the saved theme/accent before first paint.
            Nonce'd so it survives the strict (no unsafe-inline) script-src. */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=JSON.parse(localStorage.getItem("citrate.tweaks")||"{}");if(t.theme)document.documentElement.setAttribute("data-theme",t.theme);if(t.accent)document.documentElement.style.setProperty("--accent",t.accent);}catch(e){}})();`,
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
            <h1>CitrateScan — AI-native block explorer for the Citrate Network</h1>
            <p>{DESCRIPTION}</p>
            <p>
              Citrate is a GHOSTDAG BlockDAG (chain 40204, native SALT) built for AI: on-chain
              models, LoRA adapters, federated learning, autonomous agents, x402 payments, and
              DePIN compute. EVM-compatible and gasless, in the orbit of Ethereum, Solana, Akash,
              Render, and Bittensor.
            </p>
            <p>
              The interactive explorer needs JavaScript. Reference pages:{" "}
              <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/cookies">Cookies</a>.
            </p>
          </div>
        </noscript>
        <ConsentProvider>
          {children}
          <ConsentBanner />
        </ConsentProvider>
      </body>
    </html>
  );
}
