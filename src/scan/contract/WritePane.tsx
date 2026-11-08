"use client";

/**
 * Write Contract (EXP-S3): ABI-generated forms, SALT value for payable functions,
 * then the contract kit's prepareWrite (calldata, eth_call simulation with the
 * revert reason, gas, risk flags, gasless eligibility). Sending always goes through
 * the approval dialog: approveWrite runs in its click handler, and executeWrite
 * hands the PreparedWrite to the user's wallet (eth_sendTransaction) or to the
 * gasless relay (EIP-712 ForwardRequest signed in the wallet). Nothing auto-signs.
 *
 * Data sources (Rule 7): the Citrate RPC (simulation, gas), the user's wallet via
 * wagmi (src/lib/citrate/config.ts), and POST /api/relay for gasless sends.
 */
import { useMemo, useState } from "react";
import { formatEther, parseEther, type Abi, type AbiFunction, type Address, type Hex } from "viem";
import { useConnect, useConnection, useConnectors, useSendTransaction, useSwitchChain } from "wagmi";
import { emptyValue, parseArgs, type FormValue } from "@/lib/contract/abiForm";
import { functionSignature } from "@/lib/contract/codec";
import {
  approveWrite,
  executeWrite,
  prepareWrite,
  type AbiSource,
  type PreparedWrite,
  type RiskCode,
  type WriteExecutor,
  type WritePath,
} from "@/lib/contract/kit";
import type { ChainReader } from "@/lib/contract/types";
import { citrate } from "@/lib/citrate/chain";
import { PROJECT_ADDRESSES } from "@/lib/citrate/addresses";
import { useSponsoredWrite } from "@/lib/citrate/use-sponsored-write";
import { AbiInput } from "./AbiInput";

const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;

function sevTag(sev: "info" | "warn" | "high") {
  return <span className={"cx-tag sev " + (sev === "high" ? "bad" : sev === "warn" ? "warn" : "info")}>{sev}</span>;
}

export function PreparedSummary({ p }: { p: PreparedWrite }) {
  return (
    <dl className="cx-kv tight">
      <div className="cx-kv-r"><dt>method</dt><dd className="mono">{p.method.signature} <span className="muted">{p.method.selector}</span></dd></div>
      {p.args.map((a) => (
        <div className="cx-kv-r" key={a.name}><dt className="mono" style={{ textTransform: "none", letterSpacing: 0 }}>{a.name}</dt><dd className="mono brk">{a.display} <span className="muted">{a.type}</span></dd></div>
      ))}
      <div className="cx-kv-r"><dt>to</dt><dd className="mono brk">{p.to}</dd></div>
      <div className="cx-kv-r"><dt>from</dt><dd className="mono brk">{p.from ?? "no wallet connected"}</dd></div>
      <div className="cx-kv-r"><dt>value</dt><dd className="mono">{formatEther(p.value)} SALT</dd></div>
      <div className="cx-kv-r"><dt>gas</dt><dd className="mono">{p.gas.estimate !== null ? p.gas.estimate.toLocaleString() : <span className="muted">{p.gas.error}</span>}</dd></div>
      <div className="cx-kv-r"><dt>simulation</dt><dd>
        {p.simulation.status === "ok" && <span className="cx-tag ok">succeeds at latest</span>}
        {p.simulation.status === "reverted" && <span className="cx-err mono">reverts: {p.simulation.revert?.message ?? p.simulation.error}</span>}
        {p.simulation.status === "skipped" && <span className="muted">{p.simulation.reason}</span>}
      </dd></div>
      <div className="cx-kv-r"><dt>data</dt><dd><pre className="cx-pre">{p.data}</pre></dd></div>
    </dl>
  );
}

function ApprovalDialog({ p, onClose, onSent }: { p: PreparedWrite; onClose: () => void; onSent: (hash: Hex, path: WritePath) => void }) {
  const { address, chainId } = useConnection();
  const send = useSendTransaction();
  const switchChain = useSwitchChain();
  const sponsored = useSponsoredWrite();
  const highs = p.risks.filter((r) => r.severity === "high");
  const [ack, setAck] = useState<Set<RiskCode>>(new Set());
  const [path, setPath] = useState<WritePath>(p.gasless.eligible ? "gasless" : "wallet");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const walletExecutor: WriteExecutor = {
    path: "wallet",
    async send(w) {
      if (chainId !== citrate.id) await switchChain.mutateAsync({ chainId: citrate.id });
      // The wallet shows its own confirmation; the user signs there.
      return send.mutateAsync({ to: w.to, data: w.data, value: w.value, chainId: citrate.id, gas: w.gas.estimate !== null ? (w.gas.estimate * 12n) / 10n : undefined });
    },
  };
  const gaslessExecutor: WriteExecutor = {
    path: "gasless",
    async send(w) {
      // The wallet asks the user to sign the EIP-712 ForwardRequest; the relayer pays gas.
      const hash = await sponsored.sponsor({ to: w.to, data: w.data, value: 0n });
      if (!hash) throw new Error(sponsored.error ?? "The gasless relay did not accept the request.");
      return hash as Hex;
    },
  };

  const approve = async () => {
    setErr(null);
    let approval;
    try {
      // Runs inside this click handler, so the approval is tied to a real user gesture.
      approval = approveWrite(p, { path, acknowledged: [...ack] });
    } catch (e) {
      setErr((e as Error).message);
      return;
    }
    setBusy(true);
    try {
      const hash = await executeWrite(p, approval, path === "gasless" ? gaslessExecutor : walletExecutor);
      onSent(hash, path);
    } catch (e) {
      const m = e as { shortMessage?: string; message?: string };
      setErr(m.shortMessage ?? m.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const ready = highs.every((r) => ack.has(r.code)) && !!address && !busy;
  return (
    <div className="cx-scrim" role="presentation" onClick={onClose}>
      <div className="cx-modal" role="dialog" aria-modal="true" aria-labelledby="cx-approve-h" onClick={(e) => e.stopPropagation()}>
        <h3 id="cx-approve-h">Review this transaction</h3>
        <p className="muted small" style={{ margin: 0 }}>Nothing is sent until you approve here and then sign in your wallet.</p>
        <PreparedSummary p={p} />
        {p.risks.length > 0 && (
          <ul className="cx-risks">
            {p.risks.map((r) => (
              <li className="cx-risk" key={r.code}>
                {sevTag(r.severity)}
                {r.severity === "high" ? (
                  <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <input type="checkbox" style={{ width: "auto" }} checked={ack.has(r.code)} onChange={(e) => { const n = new Set(ack); if (e.target.checked) n.add(r.code); else n.delete(r.code); setAck(n); }} />
                    <span>{r.message} I understand.</span>
                  </label>
                ) : (
                  <span>{r.message}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        <div role="radiogroup" aria-label="How to send" style={{ display: "grid", gap: 8 }}>
          <label className="cx-choice" aria-disabled={!p.gasless.eligible}>
            <input type="radio" name="cx-path" checked={path === "gasless"} disabled={!p.gasless.eligible} onChange={() => setPath("gasless")} />
            <span><strong>Gasless</strong> <span className="muted">· {p.gasless.reason}</span></span>
          </label>
          <label className="cx-choice">
            <input type="radio" name="cx-path" checked={path === "wallet"} onChange={() => setPath("wallet")} />
            <span><strong>Your wallet pays gas</strong> <span className="muted">· {address ? `from ${short(address)}` : "connect a wallet first"}</span></span>
          </label>
        </div>
        {err && <div className="cx-result bad" role="alert">{err}</div>}
        <div className="actions">
          <button type="button" className="cx-btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="cx-btn primary" onClick={approve} disabled={!ready}>
            {busy ? "Waiting for your wallet" : path === "gasless" ? "Approve and sign request" : "Approve and sign transaction"}
          </button>
        </div>
      </div>
    </div>
  );
}

function WriteFn({ fn, index, address, abi, abiSource, abiVerified, viaProxy, reader, onSent }: {
  fn: AbiFunction;
  index: number;
  address: string;
  abi: Abi;
  abiSource: AbiSource;
  abiVerified: boolean;
  viaProxy: boolean;
  reader: ChainReader;
  onSent: (hash: Hex, path: WritePath) => void;
}) {
  const { address: from } = useConnection();
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState<FormValue[]>(() => fn.inputs.map(emptyValue));
  const [value, setValue] = useState("");
  const [errors, setErrors] = useState<{ path: string; error: string }[]>([]);
  const [prepared, setPrepared] = useState<PreparedWrite | null>(null);
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const payable = fn.stateMutability === "payable";

  const prepare = async () => {
    const p = parseArgs(fn.inputs, vals);
    const errs = p.ok ? [] : [...p.errors];
    let wei = 0n;
    if (payable && value.trim()) {
      try {
        wei = parseEther(value.trim());
        if (wei < 0n) throw new Error();
      } catch {
        errs.push({ path: "value", error: "enter an amount of SALT, like 0.5" });
      }
    }
    setErrors(errs);
    if (!p.ok || errs.length) return setPrepared(null);
    setBusy(true);
    try {
      setPrepared(await prepareWrite({ reader, address, abi, abiSource, abiVerified, fn, args: p.args, value: wei, from: (from as Address | undefined) ?? null, viaProxy, forwarder: PROJECT_ADDRESSES.forwarder ?? null }));
    } catch (e) {
      setErrors([{ path: fn.name, error: (e as Error).message }]);
      setPrepared(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cx-fn">
      <button type="button" className="cx-fn-h" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="nm">{index + 1}. {fn.name}</span>
        {payable && <span className="cx-tag warn">payable</span>}
        <span className="sig">{functionSignature(fn)}</span>
      </button>
      {open && (
        <form className="cx-fn-bd" onSubmit={(e) => { e.preventDefault(); void prepare(); }}>
          {payable && (
            <div className="cx-field">
              <label htmlFor={`w-${index}-value`}>value <span className="mono muted">SALT</span></label>
              <input id={`w-${index}-value`} className="mono" inputMode="decimal" autoComplete="off" placeholder="0.0" value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
          )}
          {fn.inputs.map((p, i) => (
            <AbiInput key={i} param={p} id={`w-${index}-${i}`} value={vals[i]} onChange={(v) => setVals(vals.map((x, k) => (k === i ? v : x)))} />
          ))}
          {errors.map((e) => <span key={e.path} className="cx-err" role="alert">{e.path}: {e.error}</span>)}
          <div className="cx-row">
            <button className="cx-btn" type="submit" disabled={busy}>{busy ? "Simulating" : "Preview and simulate"}</button>
            {prepared && (
              <button type="button" className="cx-btn primary" onClick={() => setDialog(true)} disabled={!from}>
                {from ? "Review and send" : "Connect a wallet to send"}
              </button>
            )}
          </div>
          {prepared && (
            <div className={prepared.simulation.status === "reverted" ? "cx-result bad" : "cx-result"}>
              <div className="lbl">transaction preview (not sent)</div>
              <PreparedSummary p={prepared} />
            </div>
          )}
        </form>
      )}
      {dialog && prepared && (
        <ApprovalDialog p={prepared} onClose={() => setDialog(false)} onSent={(h, path) => { setDialog(false); setPrepared(null); onSent(h, path); }} />
      )}
    </div>
  );
}

export function WritePane(props: {
  address: string;
  abi: Abi;
  abiSource: AbiSource;
  abiVerified: boolean;
  viaProxy: boolean;
  reader: ChainReader;
  onOpenTx: (hash: string) => void;
}) {
  const { address: from, isConnected } = useConnection();
  const connectors = useConnectors();
  const connect = useConnect();
  const [sent, setSent] = useState<{ hash: Hex; path: WritePath } | null>(null);
  const writes = useMemo(
    () => props.abi.filter((x): x is AbiFunction => x.type === "function" && x.stateMutability !== "view" && x.stateMutability !== "pure"),
    [props.abi],
  );
  return (
    <div>
      {isConnected && from ? (
        <div className="cx-banner ok">Connected: <span className="mono">{short(from)}</span></div>
      ) : (
        <div className="cx-banner info">
          <div className="cx-row" style={{ justifyContent: "space-between" }}>
            <span>Connect a wallet to send transactions. Previews and simulations work without one.</span>
            <button type="button" className="cx-btn" disabled={!connectors[0] || connect.isPending} onClick={() => connectors[0] && connect.mutate({ connector: connectors[0] })}>
              {connect.isPending ? "Connecting" : "Connect wallet"}
            </button>
          </div>
          {connect.error && <p className="cx-err">{connect.error.message}</p>}
        </div>
      )}
      {!props.abiVerified && (
        <div className="cx-banner warn">
          <strong>Unverified contract.</strong> What these calls do cannot be checked against source. Every send needs your explicit approval and shows these risks first.
        </div>
      )}
      {sent && (
        <div className="cx-banner ok">
          Submitted {sent.path === "gasless" ? "through the gasless relay" : "from your wallet"}:{" "}
          <button type="button" className="cx-link mono" onClick={() => props.onOpenTx(sent.hash)}>{short(sent.hash)}</button>
        </div>
      )}
      {writes.length === 0 ? (
        <div className="cx-empty">No write functions are known for this contract.</div>
      ) : (
        <div className="cx-fnlist">
          {writes.map((fn, i) => (
            <WriteFn
              key={functionSignature(fn)}
              fn={fn}
              index={i}
              address={props.address}
              abi={props.abi}
              abiSource={props.abiSource}
              abiVerified={props.abiVerified}
              viaProxy={props.viaProxy}
              reader={props.reader}
              onSent={(hash, path) => setSent({ hash, path })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
