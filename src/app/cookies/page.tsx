import type { Metadata } from "next";
import { LegalShell } from "@/components/legal-shell";

export const metadata: Metadata = {
  title: "Cookie Policy — CitrateScan",
  description: "How CitrateScan uses local storage and cookies, and how to control them.",
};

export default function CookiesPage() {
  return (
    <LegalShell title="Cookie Policy" updated="2026-06-03">
      <p>
        CitrateScan uses browser storage (localStorage and, where applicable,
        cookies) in a few narrow ways. We do <strong>not</strong> use advertising
        or cross-site tracking. You control non-essential storage from the consent
        banner and from “Cookie settings” in the footer.
      </p>

      <h2>Categories</h2>
      <ul>
        <li>
          <strong>Essential</strong> (always on) — keeping you signed in (your
          authentication session) and remembering this consent choice. The site
          cannot function without these.
        </li>
        <li>
          <strong>Preferences</strong> (optional) — remembering view settings such
          as theme and reading density across visits.
        </li>
        <li>
          <strong>Analytics</strong> (optional, off by default) — we run{" "}
          <strong>no analytics today</strong>. If we add anonymous usage
          measurement, it will load only after you opt in.
        </li>
      </ul>

      <h2>Authentication storage</h2>
      <p>
        Signing in sets secure, httpOnly session cookies (not readable by page
        scripts) so requests can be attributed to you. When the Citrate identity
        authority is used, it may set its own essential cookies as part of the
        standard OIDC sign-in flow.
      </p>

      <h2>Your choices</h2>
      <ul>
        <li>In the EU/EEA/UK, non-essential storage stays off until you accept (opt-in).</li>
        <li>In California, you may decline non-essential storage; we do not sell or share your data.</li>
        <li>Change your choice any time via <strong>Cookie settings</strong> in the footer, or by clearing site data in your browser.</li>
      </ul>

      <h2>Contact</h2>
      <p>
        Questions: <a href="mailto:privacy@citrate.ai">privacy@citrate.ai</a>. See
        also our <a href="/privacy">Privacy Policy</a>.
      </p>
    </LegalShell>
  );
}
