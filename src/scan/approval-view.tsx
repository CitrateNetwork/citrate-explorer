"use client";
/**
 * The ONE approval dialog's view, for every explorer write: the contract page's
 * Write tab, the chat "Prepared transaction" card and MCP approval links.
 * Presentational only. Every fact comes from a kit PreparedWrite prepared in the
 * browser from the user's connected wallet (src/lib/contract/request.ts), never
 * from model text. The rules for when Approve is allowed live in
 * src/lib/agent/approval.ts over kit approveWrite / executeWrite; the container
 * with the wallet hooks is src/scan/approval.tsx.
 *
 * Shows: the network (Citrate, chain 40204), the target (verified or not, proxy),
 * the decoded method and args, the value in SALT, the simulation outcome or
 * revert reason, the gas estimate, calldata, and the risk flags. Every high risk
 * has an "I understand" box (kit rule) and an elevated write also needs the
 * function name typed (agent rule). Built from the kit's components and `.cx`
 * classes (src/scan/contract/).
 */
import type { ReactNode } from "react";
import type { ApprovalState, ExecutionPath } from "@/lib/agent/approval";
import type { WriteExplanation } from "@/lib/agent/explain";
import { unwrapUntrusted } from "@/lib/agent/untrusted";
import type { RiskCode } from "@/lib/contract/kit";
import { PreparedSummary, SevTag } from "./contract/PreparedSummary";

/** Facts about the target that the kit's resolution knows and the PreparedWrite does not carry. */
export interface TargetFacts {
  label: string | null;
  contractName: string | null;
  /** True when the call is encoded with a proxy's implementation ABI. */
  viaImplementation: boolean;
}

export interface ApprovalViewProps {
  state: ApprovalState | null;
  target: TargetFacts | null;
  explanation: WriteExplanation | null;
  connected: string | null;
  blockers: string[];
  loading: boolean;
  error: string | null;
  busy: boolean;
  /** The call can be edited here (agent requests); the contract page edits in its own form. */
  editable: boolean;
  editing: boolean;
  editArgs: string[];
  editValue: string;
  relayAvailable: boolean;
  onTyped(v: string): void;
  onAck(code: RiskCode, on: boolean): void;
  onPath(p: ExecutionPath): void;
  onApprove(): void;
  onReject(): void;
  onEdit(): void;
  onEditArg(i: number, v: string): void;
  onEditValue(v: string): void;
  onResimulate(): void;
  onCancelEdit(): void;
  onConnect(): void;
  onClose(): void;
  onOpenTx?(hash: string): void;
}

const text = (v: unknown): string => (typeof v === "string" ? unwrapUntrusted(v) : String(v ?? ""));

function VerificationBadge({ s, t }: { s: ApprovalState; t: TargetFacts | null }) {
  const p = s.prepared;
  if (!p.target.isContract) return <span className="cx-tag bad">No contract code</span>;
  const v = p.target.verification;
  if (t?.viaImplementation) {
    return v === "verified" ? <span className="cx-tag ok">Proxy · implementation verified</span> : <span className="cx-tag warn">Proxy · implementation not verified</span>;
  }
  if (p.abiSource === "signature") return <span className="cx-tag warn">Encoded from a supplied signature</span>;
  if (v === "verified") return <span className="cx-tag ok">Verified</span>;
  if (v === "partial-match" || v === "similar-match") return <span className="cx-tag warn">{v === "partial-match" ? "Partial match" : "Similar match"} · not verified</span>;
  if (v === "unavailable") return <span className="cx-tag warn">Verification unknown</span>;
  return <span className="cx-tag bad">Unverified</span>;
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="cx-kv-r">
      <dt>{k}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function ApprovalView(props: ApprovalViewProps) {
  const { state, target, explanation, connected, blockers, loading, error, busy } = props;
  const p = state?.prepared ?? null;
  const done = state && (state.phase === "submitted" || state.phase === "executed" || state.phase === "failed" || state.phase === "rejected");

  return (
    <div className="cx-approval-body" role="dialog" aria-modal="true" aria-labelledby="apv-title">
      <div className="cx-row" style={{ justifyContent: "space-between" }}>
        <h3 id="apv-title">Review transaction</h3>
        <span className="cx-tag info" title="Citrate network">Citrate · chain 40204</span>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Nothing has been sent. This call was prepared and simulated from your wallet; you decide. Approving opens your wallet to sign.
      </p>

      {loading && <div className="cx-result">Simulating from your wallet…</div>}
      {error && <div className="cx-result bad" role="alert">{error}</div>}

      {p && state && (
        <>
          <dl className="cx-kv tight" aria-label="Target">
            <Row k="network">Citrate (chain {p.chainId})</Row>
            <Row k="target">
              <span className="mono brk">{p.to}</span>
              {target?.label && <span className="muted"> · {text(target.label)}</span>}
              <div className="cx-row" style={{ marginTop: 6 }}>
                <VerificationBadge s={state} t={target} />
                {target?.contractName && <span className="muted mono">{text(target.contractName)}</span>}
              </div>
              {p.target.proxy && (
                <div className="muted small">
                  {p.target.proxy.kind} proxy → implementation <span className="mono">{p.target.proxy.implementation}</span>
                </div>
              )}
            </Row>
          </dl>

          {props.editing ? (
            <div className="cx-group" aria-label="Edit the call">
              {p.args.map((a, i) => (
                <div className="cx-field" key={i}>
                  <label htmlFor={`apv-arg-${i}`} className="mono small">{a.name} ({a.type})</label>
                  <input id={`apv-arg-${i}`} className="mono" value={props.editArgs[i] ?? ""} onChange={(e) => props.onEditArg(i, e.target.value)} />
                </div>
              ))}
              {p.method.stateMutability === "payable" && (
                <div className="cx-field">
                  <label htmlFor="apv-value" className="mono small">value (SALT)</label>
                  <input id="apv-value" className="mono" aria-label="Value in SALT" value={props.editValue} onChange={(e) => props.onEditValue(e.target.value)} />
                </div>
              )}
            </div>
          ) : (
            <PreparedSummary p={p} />
          )}

          <section aria-label="Risks">
            {p.risks.length === 0 ? (
              <div className="muted small">No specific risk flags.</div>
            ) : (
              <ul className="cx-risks">
                {p.risks.map((r) => (
                  <li className="cx-risk" key={r.code}>
                    <SevTag sev={r.severity} />
                    {r.severity === "high" && !done ? (
                      <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                        <input
                          type="checkbox"
                          style={{ width: "auto" }}
                          checked={state.acknowledged.includes(r.code)}
                          onChange={(e) => props.onAck(r.code, e.target.checked)}
                          aria-label={`I understand: ${r.code}`}
                        />
                        <span>{text(r.message)} I understand.</span>
                      </label>
                    ) : (
                      <span>{text(r.message)}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {explanation && (
            <section aria-label="What this does">
              <p className="small" style={{ margin: 0 }}>{explanation.summary}</p>
              <p className="muted small" style={{ margin: "4px 0 0" }}>{explanation.cost}</p>
            </section>
          )}

          {!done && !props.editing && (
            <section aria-label="How to send" style={{ display: "grid", gap: 8 }}>
              <div role="radiogroup" aria-label="Send with" style={{ display: "grid", gap: 8 }}>
                <label className="cx-choice">
                  <input type="radio" name="apv-path" checked={state.path === "wallet"} onChange={() => props.onPath("wallet")} />
                  <span><strong>Your wallet pays gas</strong> <span className="muted">· {connected ? `from ${connected.slice(0, 8)}…${connected.slice(-6)}` : "connect a wallet first"}</span></span>
                </label>
                <label className="cx-choice" aria-disabled={!p.gasless.eligible || !props.relayAvailable}>
                  <input type="radio" name="apv-path" disabled={!p.gasless.eligible || !props.relayAvailable} checked={state.path === "gasless"} onChange={() => props.onPath("gasless")} />
                  <span><strong>Gasless</strong> <span className="muted">· {p.gasless.reason}</span></span>
                </label>
              </div>
              {p.elevated && (
                <label className="cx-field">
                  <span className="small">
                    This call is flagged. Type <strong className="mono">{p.confirmPhrase}</strong> to confirm.
                  </span>
                  <input className="mono" aria-label="Confirmation" value={state.typed} onChange={(e) => props.onTyped(e.target.value)} autoComplete="off" spellCheck={false} />
                </label>
              )}
              {blockers.length > 0 && (
                <ul className="cx-blockers small" aria-label="Before you can approve">
                  {blockers.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {state.txHash && (
            <dl className="cx-kv tight" aria-label="Result">
              <Row k="transaction">
                <button type="button" className="cx-link mono brk" onClick={() => props.onOpenTx?.(state.txHash!)}>
                  {state.txHash}
                </button>
              </Row>
              <Row k="status">{state.phase === "executed" ? "Executed" : state.phase === "failed" ? `Failed${state.error ? `: ${state.error}` : ""}` : "Submitted, waiting for the receipt…"}</Row>
            </dl>
          )}
          {state.phase === "failed" && !state.txHash && <div className="cx-result bad">Not sent: {state.error}</div>}
          {state.phase === "rejected" && <div className="cx-result">Rejected. Nothing was sent.</div>}
        </>
      )}

      <div className="actions">
        {done || !p ? (
          <button type="button" className="cx-btn" onClick={props.onClose}>
            Close
          </button>
        ) : props.editing ? (
          <>
            <button type="button" className="cx-btn ghost" onClick={props.onCancelEdit} disabled={busy}>
              Cancel edit
            </button>
            <button type="button" className="cx-btn primary" onClick={props.onResimulate} disabled={busy}>
              Re-simulate
            </button>
          </>
        ) : (
          <>
            <button type="button" className="cx-btn ghost" onClick={props.onReject} disabled={busy}>
              Reject
            </button>
            {props.editable && (
              <button type="button" className="cx-btn" onClick={props.onEdit} disabled={busy}>
                Edit
              </button>
            )}
            {!connected ? (
              <button type="button" className="cx-btn primary" onClick={props.onConnect}>
                Connect wallet
              </button>
            ) : (
              <button type="button" className="cx-btn primary" onClick={props.onApprove} disabled={busy || blockers.length > 0}>
                {busy ? "Waiting for your wallet…" : state?.path === "gasless" ? "Approve and sign request" : "Approve and sign"}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
