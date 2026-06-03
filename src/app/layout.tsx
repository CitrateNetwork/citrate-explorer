import type { Metadata } from "next";
import "../scan/scan.css";
import "../scan/scan-ui.css";

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
      <body>{children}</body>
    </html>
  );
}
