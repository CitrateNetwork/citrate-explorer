import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "CitrateScan — AI-native BlockDAG explorer",
  description:
    "Explore the Citrate Network (GHOSTDAG BlockDAG, chain 40204). Plain-English " +
    "answers, a built-in AI agent, contract verification, and a programmable API.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
