"use client";

/**
 * Write Contract (EXP-S3): ABI-generated forms, SALT value for payable functions,
 * then the contract kit's prepareWrite (calldata, eth_call simulation with the
 * revert reason, gas, risk flags, gasless eligibility). Sending always goes through
 * the one approval dialog (src/scan/approval.tsx), shared with the agent: it
 * re-prepares from the connected wallet, kit approveWrite runs in its Approve
 * click handler, and kit executeWrite hands the PreparedWrite to the user's wallet
 * (eth_sendTransaction) or to the gasless relay (EIP-712 ForwardRequest signed in
 * the wallet). Nothing auto-signs.
 *
 * Data sources (Rule 7): the Citrate RPC (simulation, gas), the user's wallet via
 * wagmi (src/lib/citrate/config.ts), and POST /api/relay for gasless sends.
 */
import { useMemo, useState } from "react";
import { parseEther, type Abi, type AbiFunction, type Address, type Hex } from "viem";
import { useConnect, useConnection, useConnectors } from "wagmi";
import { emptyValue, parseArgs, type FormValue } from "@/lib/contract/abiForm";
import { functionSignature } from "@/lib/contract/codec";
import { prepareWrite, type AbiSource, type PreparedWrite, type ProxyInfo, type WritePath } from "@/lib/contract/kit";
import type { ChainReader, VerificationStatus } from "@/lib/contract/types";
import { PROJECT_ADDRESSES } from "@/lib/citrate/addresses";
import { ApprovalDialog, type Preparer } from "@/scan/approval";
import { AbiInput } from "./AbiInput";
import { PreparedSummary } from "./PreparedSummary";

export { PreparedSummary } from "./PreparedSummary";

const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;

interface WriteTarget {
  address: string;
  abi: Abi;
  abiSource: AbiSource;
  abiVerified: boolean;
  viaProxy: boolean;
  /** Verification status of the code whose ABI encodes the call. */
  verification: VerificationStatus;
  proxy: ProxyInfo | null;
  reader: ChainReader;
}

function WriteFn({ fn, index, target, onSent }: { fn: AbiFunction; index: number; target: WriteTarget; onSent: (hash: Hex, path: WritePath) => void }) {
  const { address, abi, abiSource, abiVerified, viaProxy, reader } = target;
  const { address: from } = useConnection();
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState<FormValue[]>(() => fn.inputs.map(emptyValue));
  const [value, setValue] = useState("");
  const [errors, setErrors] = useState<{ path: string; error: string }[]>([]);
  const [prepared, setPrepared] = useState<PreparedWrite | null>(null);
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const payable = fn.stateMutability === "payable";

  const kitPrepare = (args: readonly unknown[], wei: bigint, sender: Address | null) =>
    prepareWrite({
      reader,
      address,
      abi,
      abiSource,
      abiVerified,
      fn,
      args,
      value: wei,
      from: sender,
      viaProxy,
      proxy: target.proxy,
      verification: target.verification,
      hasCode: true,
      forwarder: (PROJECT_ADDRESSES.forwarder as Address | undefined) ?? null,
    });

  // The dialog re-prepares this exact call (same args and value) from whichever wallet is connected.
  const preparer: Preparer | null = prepared
    ? (sender) =>
        kitPrepare(
          prepared.args.map((a) => a.value),
          prepared.value,
          sender,
        ).then((p) => ({ prepared: p, target: { label: null, contractName: null, viaImplementation: viaProxy && abiSource === "proxy-implementation" }, explanation: null }))
    : null;

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
      setPrepared(await kitPrepare(p.args, wei, (from as Address | undefined) ?? null));
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
      {dialog && preparer && (
        <ApprovalDialog preparer={preparer} origin="ui" onClose={() => setDialog(false)} onSent={(h, path) => { setPrepared(null); onSent(h, path); }} />
      )}
    </div>
  );
}

export function WritePane(props: WriteTarget & { onOpenTx: (hash: string) => void }) {
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
            <WriteFn key={functionSignature(fn)} fn={fn} index={i} target={props} onSent={(hash, path) => setSent({ hash, path })} />
          ))}
        </div>
      )}
    </div>
  );
}
