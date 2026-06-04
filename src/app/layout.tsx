import type { Metadata } from "next";
import "../scan/scan.css";
import "../scan/scan-ui.css";
import { ConsentProvider } from "@/lib/consent/client";
import { ConsentBanner } from "@/components/consent-banner";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://explorer.citrate.ai";
const TITLE = "CitrateScan — AI-native block explorer";
const DESCRIPTION =
  "Explore the Citrate Network (GHOSTDAG BlockDAG, chain 40204). Plain-English " +
  "answers, a built-in AI agent, contract verification, and a programmable API.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: "%s · CitrateScan" },
  description: DESCRIPTION,
  applicationName: "CitrateScan",
  keywords: [
    "Citrate",
    "block explorer",
    "GHOSTDAG",
    "BlockDAG",
    "SALT",
    "blockchain",
    "AI explorer",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "CitrateScan",
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="light">
      <head>
        {/* No-flash theme: apply the saved theme/accent before first paint. */}
        <script
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
        <ConsentProvider>
          {children}
          <ConsentBanner />
        </ConsentProvider>
      </body>
    </html>
  );
}
