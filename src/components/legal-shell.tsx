import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";

/** Shared frame for the SSR legal pages — header, readable article, footer. */
export function LegalShell({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "var(--canvas, #f1eee6)" }}>
      <style
        dangerouslySetInnerHTML={{
          __html: `
          .legal { color: var(--text-1,#0e0f0c); font-family: var(--font-sans,system-ui),sans-serif; }
          .legal h1 { font-family: var(--font-display,sans-serif); font-weight:500; font-size:30px; letter-spacing:-.015em; margin:0 0 6px; }
          .legal h2 { font-family: var(--font-display,sans-serif); font-weight:500; font-size:19px; margin:30px 0 10px; }
          .legal p, .legal li { font-size:15px; line-height:1.65; color:var(--text-2,#555851); }
          .legal a { color: var(--accent-text,#4f7304); }
          .legal ul { padding-left:20px; }
          .legal .updated { font-family: var(--font-mono,monospace); font-size:12px; color:var(--text-3,#8a8c84); margin-bottom:24px; }
          .legal strong { color: var(--text-1,#0e0f0c); }
          .legal code { font-family: var(--font-mono,monospace); font-size:13px; background:var(--surface-sunk,#ecebe4); padding:1px 5px; border-radius:4px; }
        `,
        }}
      />
      <header
        style={{
          borderBottom: "1px solid var(--border,#dbdcd5)",
          background: "var(--surface,#faf8f3)",
          padding: "14px 24px",
        }}
      >
        <Link
          href="/"
          style={{ fontFamily: "var(--font-display)", fontWeight: 600, color: "var(--text-1,#0e0f0c)", textDecoration: "none" }}
        >
          CitrateScan
        </Link>
      </header>
      <main style={{ flex: 1, width: "100%", maxWidth: 760, margin: "0 auto", padding: "44px 24px 64px" }}>
        <article className="legal">
          <h1>{title}</h1>
          <p className="updated">Last updated {updated}</p>
          {children}
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
