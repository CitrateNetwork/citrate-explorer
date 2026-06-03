import type { Metadata } from "next";
import { LegalShell } from "@/components/legal-shell";

export const metadata: Metadata = {
  title: "Terms of Use — CitrateScan",
  description: "Terms for using CitrateScan, the AI-native explorer for the Citrate Network.",
};

export default function TermsPage() {
  return (
    <LegalShell title="Terms of Use" updated="2026-06-03">
      <p>
        By using CitrateScan you agree to these terms. CitrateScan is provided by
        the Citrate Foundation as <strong>experimental testnet software</strong>.
      </p>

      <h2>No warranty</h2>
      <p>
        The service is provided “as is”, without warranty of any kind. Data is
        read from a test network and may be incomplete, delayed, or reset. Do not
        rely on it for production, financial, or legal decisions.
      </p>

      <h2>Read-only, non-custodial</h2>
      <p>
        CitrateScan never holds your funds and never signs transactions on your
        behalf. Any write (for example, calling a contract) requires your explicit
        action in your own wallet. The AI agent is strictly read-only.
      </p>

      <h2>Not financial advice</h2>
      <p>
        Nothing here is financial, investment, legal, or tax advice. Plain-English
        explanations are conveniences, not guarantees of correctness.
      </p>

      <h2>Acceptable use</h2>
      <ul>
        <li>Do not abuse the API or attempt to disrupt the service (rate limits and protections apply).</li>
        <li>Do not use the service to break the law or infringe others’ rights.</li>
        <li>API keys are personal to your account; keep them secret.</li>
      </ul>

      <h2>Changes</h2>
      <p>
        We may update these terms; the “last updated” date reflects the current
        version. Continued use after a change constitutes acceptance.
      </p>

      <h2>Contact</h2>
      <p>
        Questions: <a href="mailto:legal@citrate.ai">legal@citrate.ai</a>. See also
        our <a href="/privacy">Privacy Policy</a> and{" "}
        <a href="/cookies">Cookie Policy</a>.
      </p>
    </LegalShell>
  );
}
