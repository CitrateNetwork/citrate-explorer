import type { Metadata } from "next";
import "../scan/scan.css";
import "../scan/scan-ui.css";
import { ConsentProvider } from "@/lib/consent/client";
import { ConsentBanner } from "@/components/consent-banner";

export const metadata: Metadata = {
  title: "CitrateScan — AI-native block explorer",
  description:
    "Explore the Citrate Network (GHOSTDAG BlockDAG, chain 40204). Plain-English " +
    "answers, a built-in AI agent, contract verification, and a programmable API.",
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
        <ConsentProvider>
          {children}
          <ConsentBanner />
        </ConsentProvider>
      </body>
    </html>
  );
}
