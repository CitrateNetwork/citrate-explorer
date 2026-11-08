"use client";
/**
 * The approval dialog's view (EXP-AGENT). Presentational only: every fact it
 * shows comes from a PreparedWrite the server just prepared from the user's
 * wallet (POST /api/agent/prepare), never from model text. State and the rules
 * for when Approve is allowed live in src/lib/agent/approval.ts; the container
 * with the wallet hooks is src/scan/approval.tsx.
 *
 * Shows: target (verified or not, proxy), decoded method and args, value in
 * SALT, simulation outcome, gas estimate, risk flags, and the network (Citrate,
 * chain 40204). Elevated flags require typing the confirmation phrase.
 */
import type { ReactNode } from "react";
import type { ApprovalState, ExecutionPath } from "@/lib/agent/approval";
import type { WriteExplanation } from "@/lib/agent/explain";
import { unwrapUntrusted } from "@/lib/agent/untrusted";
import type { DecodedValue, PreparedWrite } from "@/lib/contracts/types";

export interface ApprovalViewProps {
  state: ApprovalState | null;
  explanation: WriteExplanation | null;
  connected: string | null;
  blockers: string[];
  loading: boolean;
  error: string | null;
  busy: boolean;
  editing: boolean;
  editArgs: string[];
  editValue: string;
  relayAvailable: boolean;
  onTyped(v: string): void;
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

const text = (v: unknown): string => {
  if (typeof v === "string") return unwrapUntrusted(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
};

function VerificationBadge({ p }: { p: PreparedWrite }) {
  const t = p.target;
  if (!t.isContract) return <span className="badge red">No contract code</span>;
  if (t.abiSource === "implementation") {
    return t.verification === "verified" ? <span className="badge green">Proxy · implementation verified</span> : <span className="badge amber">Proxy · implementation not verified</span>;
  }
  if (t.verification === "verified") return <span className="badge green">Verified</span>;
  if (t.verification === "partial-match") return <span className="badge amber">Partial match · not verified</span>;
  if (t.verification === "unavailable") return <span className="badge amber">Verification unknown</span>;
  return <span className="badge red">Unverified</span>;
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="apv-row">
      <div className="apv-k">{k}</div>
      <div className="apv-v">{children}</div>
    </div>
  );
}

function ArgsTable({ args }: { args: DecodedValue[] }) {
  if (args.length === 0) return <span className="apv-muted">no arguments</span>;
  return (
    <table className="apv-args">
      <tbody>
        {args.map((a, i) => (
          <tr key={i}>
            <td className="mono">{a.name || `arg${i}`}</td>
            <td className="mono apv-muted">{a.type}</td>
            <td className="mono apv-break">{text(a.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ApprovalView(props: ApprovalViewProps) {
  const { state, explanation, connected, blockers, loading, error, busy } = props;
  const p = state?.prepared ?? null;
  const done = state && (state.phase === "submitted" || state.phase === "executed" || state.phase === "failed" || state.phase === "rejected");

  return (
    <div className="apv" role="dialog" aria-modal="true" aria-labelledby="apv-title">
      <div className="apv-h">
        <h3 id="apv-title">Review transaction</h3>
        <span className="badge info" title="Citrate network">Citrate · chain 40204</span>
      </div>
      <p className="apv-lead">
        Nothing has been sent. CitrateScan prepared this call and simulated it; you decide. Approving opens your wallet to sign.
      </p>

      {loading && <div className="note">Simulating from your wallet…</div>}
      {error && <div className="note apv-danger" role="alert">{error}</div>}

      {p && (
        <>
          <section className="apv-sec" aria-label="Target">
            <Row k="Network">Citrate (chain {p.chainId})</Row>
            <Row k="Target">
              <span className="mono apv-break">{p.target.address}</span>
              {p.target.label && <span className="apv-muted"> · {text(p.target.label)}</span>}
              <div className="apv-badges">
                <VerificationBadge p={p} />
                {p.target.contractName && <span className="apv-muted mono">{text(p.target.contractName)}</span>}
              </div>
              {p.target.proxy.isProxy && (
                <div className="apv-muted apv-small">
                  {p.target.proxy.kind} proxy → implementation <span className="mono">{p.target.proxy.implementation ?? "unreadable"}</span>
                </div>
              )}
            </Row>
            <Row k="Method">
              <span className="mono">{p.call.signature}</span> <span className="apv-muted mono">{p.call.selector}</span>
            </Row>
            <Row k="Arguments">
              {props.editing ? (
                <div className="apv-edit">
                  {p.call.args.map((a, i) => (
                    <label key={i}>
                      <span className="mono apv-small">
                        {a.name || `arg${i}`} ({a.type})
                      </span>
                      <input className="mono" value={props.editArgs[i] ?? ""} onChange={(e) => props.onEditArg(i, e.target.value)} />
                    </label>
                  ))}
                </div>
              ) : (
                <ArgsTable args={p.call.args} />
              )}
            </Row>
            <Row k="Value">
              {props.editing && p.call.stateMutability === "payable" ? (
                <input className="mono" aria-label="Value in SALT" value={props.editValue} onChange={(e) => props.onEditValue(e.target.value)} />
              ) : (
                <span className="mono">{p.value.salt} SALT</span>
              )}
            </Row>
            <Row k="Simulation">
              {p.simulation.ok ? (
                <span className="apv-ok">Succeeds</span>
              ) : p.simulation.revertReason ? (
                <span className="apv-danger-text">Reverts: {text(p.simulation.revertReason)}</span>
              ) : (
                <span className="apv-warn-text">Could not simulate</span>
              )}
              <div className="apv-muted apv-small">
                from <span className="mono">{p.simulation.from ?? "no sender"}</span> at block {p.simulation.blockNumber ?? "?"}
              </div>
            </Row>
            <Row k="Gas">
              {p.simulation.gasEstimate ? (
                <span className="mono">
                  {p.simulation.gasEstimate} gas{p.simulation.feeSalt ? ` ≈ ${p.simulation.feeSalt} SALT` : ""}
                </span>
              ) : (
                <span className="apv-muted">no estimate</span>
              )}
            </Row>
          </section>

          <section className="apv-sec" aria-label="Risks">
            <div className="apv-k">Risk flags</div>
            {p.risk.flags.length === 0 ? (
              <div className="apv-muted">No specific risk flags.</div>
            ) : (
              <ul className="apv-flags">
                {p.risk.flags.map((f, i) => (
                  <li key={i} className={`apv-flag ${f.severity}`}>
                    <span className={`badge ${f.severity === "elevated" ? "red" : f.severity === "warn" ? "amber" : "info"}`}>{f.severity === "elevated" ? "high" : f.severity}</span>
                    <span>{f.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {explanation && (
            <section className="apv-sec" aria-label="What this does">
              <div className="apv-k">What this does</div>
              <p className="apv-explain">{explanation.summary}</p>
              <p className="apv-explain apv-muted">{explanation.cost}</p>
            </section>
          )}

          {!done && !props.editing && (
            <section className="apv-sec" aria-label="How to send">
              <div className="apv-k">Send with</div>
              <div className="apv-paths" role="radiogroup">
                <label className={state?.path === "wallet" ? "on" : ""}>
                  <input type="radio" name="apv-path" checked={state?.path === "wallet"} onChange={() => props.onPath("wallet")} /> Your wallet (you pay gas)
                </label>
                <label className={state?.path === "relay" ? "on" : ""} title={p.relay.eligible ? "" : (p.relay.reason ?? "")}>
                  <input
                    type="radio"
                    name="apv-path"
                    disabled={!p.relay.eligible || !props.relayAvailable}
                    checked={state?.path === "relay"}
                    onChange={() => props.onPath("relay")}
                  />{" "}
                  Gasless relay {p.relay.eligible ? "(you sign, the Foundation pays gas)" : `(unavailable: ${p.relay.reason})`}
                </label>
              </div>
              {p.risk.elevated && (
                <label className="apv-confirm">
                  <span>
                    This call is flagged. Type <strong className="mono">{p.risk.confirmPhrase}</strong> to confirm.
                  </span>
                  <input className="mono" aria-label="Confirmation" value={state?.typed ?? ""} onChange={(e) => props.onTyped(e.target.value)} autoComplete="off" spellCheck={false} />
                </label>
              )}
              {blockers.length > 0 && (
                <ul className="apv-blockers" aria-label="Before you can approve">
                  {blockers.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {state && state.txHash && (
            <section className="apv-sec" aria-label="Result">
              <Row k="Transaction">
                <a className="mono apv-break" onClick={() => props.onOpenTx?.(state.txHash!)}>
                  {state.txHash}
                </a>
              </Row>
              <Row k="Status">{state.phase === "executed" ? "Executed" : state.phase === "failed" ? `Failed${state.error ? `: ${state.error}` : ""}` : "Submitted, waiting for the receipt…"}</Row>
            </section>
          )}
          {state && state.phase === "failed" && !state.txHash && <div className="note apv-danger">Not sent: {state.error}</div>}
          {state && state.phase === "rejected" && <div className="note">Rejected. Nothing was sent.</div>}
        </>
      )}

      <div className="apv-actions">
        {done || !p ? (
          <button className="btn" onClick={props.onClose}>
            Close
          </button>
        ) : props.editing ? (
          <>
            <button className="btn" onClick={props.onCancelEdit} disabled={busy}>
              Cancel edit
            </button>
            <button className="btn primary" onClick={props.onResimulate} disabled={busy}>
              Re-simulate
            </button>
          </>
        ) : (
          <>
            <button className="btn" onClick={props.onReject} disabled={busy}>
              Reject
            </button>
            <button className="btn" onClick={props.onEdit} disabled={busy}>
              Edit
            </button>
            {!connected ? (
              <button className="btn primary" onClick={props.onConnect}>
                Connect wallet
              </button>
            ) : (
              <button className="btn primary" onClick={props.onApprove} disabled={busy || blockers.length > 0}>
                {busy ? "Waiting for your wallet…" : "Approve and sign"}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
