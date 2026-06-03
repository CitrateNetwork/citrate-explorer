import type { Metadata } from "next";
import { LegalShell } from "@/components/legal-shell";

export const metadata: Metadata = {
  title: "Privacy Policy — CitrateScan",
  description: "What CitrateScan stores, why, and your data rights (access, export, erasure).",
};

export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy" updated="2026-06-03">
      <p>
        CitrateScan is a public block explorer for the Citrate Network. This
        policy explains what we store, why, and your rights. Citrate is
        experimental testnet software.
      </p>

      <h2>What we store</h2>
      <ul>
        <li><strong>Login session</strong> — handled by our authentication seam (OIDC). We read your subject id and wallet address from a signed token only to scope your data.</li>
        <li><strong>Settings</strong> — end-to-end encrypted with a key derived in your browser from a wallet signature. We store only ciphertext we cannot read.</li>
        <li><strong>API keys you issue</strong> — stored as a salted hash; the key itself is shown once and is never recoverable.</li>
        <li><strong>Third-party provider keys</strong> you add for the agent — encrypted at rest with a per-user key, used only to run tools on your behalf.</li>
        <li><strong>Watchlist and chat threads</strong> — scoped to your account; message bodies are encrypted.</li>
        <li><strong>Audit log</strong> — the read-only tools the AI agent called on your behalf, kept for your transparency.</li>
        <li><strong>Local storage</strong> — your login session, theme, and cookie-consent choice.</li>
      </ul>
      <p>
        We do <strong>not</strong> use advertising, cross-site tracking, or sell
        or share your personal information. We do not currently run analytics; if
        we add it, it will be opt-in and disclosed in the consent banner.
      </p>

      <h2>On-chain data is public and permanent</h2>
      <p>
        Blocks, transactions, and addresses you view are public on the Citrate
        Network and are <strong>not</strong> controlled by us. We cannot edit or
        erase on-chain data, and neither can anyone else — that is the point of a
        blockchain.
      </p>

      <h2>Your rights</h2>
      <ul>
        <li><strong>Access &amp; portability</strong> — export everything we store about you via <code>GET /api/account/export</code> (Settings → Privacy &amp; Data → Export my data).</li>
        <li><strong>Erasure</strong> — delete your account-scoped data via <code>DELETE /api/account</code> (Settings → Privacy &amp; Data → Delete account). On-chain data is unaffected.</li>
        <li><strong>Withdraw consent</strong> — change your cookie/storage choices any time via “Cookie settings” in the footer.</li>
      </ul>

      <h2>Contact</h2>
      <p>
        Privacy questions: <a href="mailto:privacy@citrate.ai">privacy@citrate.ai</a>.
        Security reports: see <a href="/.well-known/security.txt">security.txt</a>.
      </p>
      <p>
        See also our <a href="/cookies">Cookie Policy</a> and{" "}
        <a href="/terms">Terms of Use</a>.
      </p>
    </LegalShell>
  );
}
