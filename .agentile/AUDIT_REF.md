---
created: 2026-06-09T00:00:00Z
author: Fable 5 (Claude Code)
status: active
audit_id: 2026-06-09-federation-followup-security-audit
---

# Active audit reference — `citrate-explorer`

> This repo's link into the centralized federation audit trail. The canonical
> audit home is the `citrate-security` repo.

This repo received its **first dedicated security audit** in the
**2026-06-09 Federation Follow-up Security Audit**.

- Audit root: `citrate-security/audits/2026-06-09-federation-followup-security-audit/`
- This repo's report: `.../per-repo/citrate-explorer/REPORT.md`
- Findings roll-up: `.../06_FINDINGS.md`
- Team board (task delegation): `.../08_TEAM_BOARD.md`
- Audit index: `citrate-security/audits/AUDIT_INDEX.md`
- Standard: `citrate-security/.agentile/standard/AGENTILE_AUDIT_STANDARD.md`

Findings are PROVISIONAL-A (single-model pass, Fable 5); a blind second-model
quorum is pending per the Agentile-Audit standard.

## 2026-06-20 Federation-Wide Audit (FWA-C12) — remediation

This repo's web-perimeter / contract-verify findings were re-audited in the
**2026-06-20 Federation-Wide Audit**, chunk **FWA-C12**.

- Audit report: `citrate-security/audits/2026-06-20-federation-wide-audit/per-chunk/FWA-C12/REPORT.md`
- **Remediation log (this repo):** `.agentile/audits/2026-06-21-fwa-remediation/REMEDIATION_LOG.md`
- Branch: `remediation/fwa-2026-06`

Findings closed here (all MEDIUM, red-test-driven):

| ID | Title | Status |
|----|-------|--------|
| FWA-C12-03 | Contract-verify compiles untrusted Solidity in-process | **CLOSED** — input bounding + version-shape pin; microVM remains the documented WS-2b follow-up |
| FWA-C12-04 | Spoofable rate-limit IP + per-instance concurrency cap | **CLOSED** — trusted-hop `clientIp()` + global Redis-backed `CompileGate` |
| FWA-C12-05 | Partial match grants the "verified" badge | **CLOSED** — centralized `verificationBadge()`; partial ≠ verified |

(The supply-chain findings FWA-C12-01/02 are owned by a separate agent and are NOT
closed by this remediation.)
