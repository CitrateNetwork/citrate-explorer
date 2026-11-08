"use client";

/**
 * Read Contract (EXP-S3): ABI-generated forms, a real eth_call through the contract
 * kit at latest or a chosen block (only when the node serves historical state;
 * feature-detected), decoded outputs and revert reasons.
 *
 * Data source (Rule 7): the Citrate RPC via the kit's ChainReader.
 */
import { useEffect, useMemo, useState } from "react";
import type { Abi, AbiFunction, Hex } from "viem";
import { emptyValue, parseArgs, type FormValue } from "@/lib/contract/abiForm";
import { functionSignature } from "@/lib/contract/codec";
import { rawCall, readCall, supportsHistoricalState, type ReadResult } from "@/lib/contract/kit";
import type { BlockSelector, ChainReader } from "@/lib/contract/types";
import { AbiInput } from "./AbiInput";

function RevertBox({ r }: { r: Extract<ReadResult, { ok: false }> }) {
  return (
    <div className="cx-result bad" role="status">
      <div className="lbl">{r.revert ? "reverted" : "call failed"}</div>
      <div className="mono">{r.error}</div>
      {r.revert && r.revert.kind === "custom" && r.revert.fromSignatureSubset && (
        <div className="muted small">Error name from the bundled signature subset, not the verified ABI.</div>
      )}
    </div>
  );
}

function ReadFn({ fn, address, reader, abi, block, index, unverified }: {
  fn: AbiFunction;
  address: string;
  reader: ChainReader;
  abi: Abi;
  block: BlockSelector;
  index: number;
  unverified: boolean;
}) {
  const [open, setOpen] = useState(fn.inputs.length === 0 && index < 8);
  const [vals, setVals] = useState<FormValue[]>(() => fn.inputs.map(emptyValue));
  const [errors, setErrors] = useState<{ path: string; error: string }[]>([]);
  const [res, setRes] = useState<ReadResult | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    const p = parseArgs(fn.inputs, vals);
    if (!p.ok) {
      setErrors(p.errors);
      setRes(null);
      return;
    }
    setErrors([]);
    setBusy(true);
    try {
      setRes(await readCall({ reader, address, abi, fn, args: p.args, block }));
    } finally {
      setBusy(false);
    }
  };
  // Zero-argument reads run as soon as they open, like a block explorer's overview.
  // (The parent keys this component by block, so a block change starts fresh.)
  const auto = open && fn.inputs.length === 0;
  useEffect(() => {
    if (!auto) return;
    let off = false;
    readCall({ reader, address, abi, fn, args: [], block }).then((r) => { if (!off) setRes(r); });
    return () => { off = true; };
  }, [auto, reader, address, abi, fn, block]);

  const outTypes = fn.outputs.map((o) => o.type).join(", ");
  return (
    <div className="cx-fn">
      <button type="button" className="cx-fn-h" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="nm">{index + 1}. {fn.name}</span>
        <span className="sig">{functionSignature(fn)}{outTypes ? ` returns (${outTypes})` : ""}</span>
      </button>
      {open && (
        <form className="cx-fn-bd" onSubmit={(e) => { e.preventDefault(); void run(); }}>
          {fn.inputs.map((p, i) => (
            <AbiInput key={i} param={p} id={`r-${index}-${i}`} value={vals[i]} onChange={(v) => setVals(vals.map((x, k) => (k === i ? v : x)))} />
          ))}
          {errors.map((e) => <span key={e.path} className="cx-err" role="alert">{e.path}: {e.error}</span>)}
          <div className="cx-row">
            <button className="cx-btn" type="submit" disabled={busy}>{busy ? "Querying" : "Query"}</button>
            {res?.ok === true && <span className="muted small mono">calldata {res.calldata.slice(0, 10)}…</span>}
          </div>
          {res?.ok === true && (
            <div className="cx-result" role="status">
              <div className="lbl">result{unverified ? " · decoded with a guessed ABI (selector match only)" : ""}</div>
              {fn.outputs.length === 0 && <div className="muted">no return values</div>}
              {fn.outputs.map((o, i) => (
                <div key={i} className="mono brk">
                  <span className="muted">{o.name || `[${i}]`} {o.type}: </span>{res.display[i]}
                </div>
              ))}
            </div>
          )}
          {res?.ok === false && <RevertBox r={res} />}
        </form>
      )}
    </div>
  );
}

/** A raw eth_call for selectors the signature subset could not name. */
function RawCall({ address, reader }: { address: string; reader: ChainReader }) {
  const [data, setData] = useState("");
  const [out, setOut] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async () => {
    const r = await rawCall({ reader, address, data: data.trim() as Hex });
    if (r.ok) setOut({ ok: true, text: r.words.length ? r.words.map((w, i) => `[${i}] ${w}`).join("\n") : "(no data)" });
    else setOut({ ok: false, text: r.error });
  };
  return (
    <section className="cx-sec" style={{ marginTop: 24 }}>
      <h2 className="cx-sec-h">Raw call (unverified raw)</h2>
      <p className="muted small">For selectors with no known signature. The result is shown as raw 32-byte words; nothing is decoded or trusted.</p>
      <form className="cx-fn-bd" onSubmit={(e) => { e.preventDefault(); void run(); }}>
        <div className="cx-field">
          <label htmlFor="raw-calldata">calldata <span className="mono muted">bytes</span></label>
          <input id="raw-calldata" className="mono" autoComplete="off" spellCheck={false} placeholder="0x70a08231…" value={data} onChange={(e) => setData(e.target.value)} />
        </div>
        <div><button className="cx-btn" type="submit">Call</button></div>
        {out && <pre className={out.ok ? "cx-result mono" : "cx-result bad mono"} style={{ margin: 0, whiteSpace: "pre-wrap" }}>{out.text}</pre>}
      </form>
    </section>
  );
}

export function ReadPane({ address, abi, reader, unverified }: { address: string; abi: Abi; reader: ChainReader; unverified: boolean }) {
  const reads = useMemo(() => abi.filter((x): x is AbiFunction => x.type === "function" && (x.stateMutability === "view" || x.stateMutability === "pure")), [abi]);
  const [hist, setHist] = useState<{ supported: boolean; reason: string | null } | null>(null);
  const [mode, setMode] = useState<"latest" | "height">("latest");
  const [height, setHeight] = useState("");
  useEffect(() => {
    let off = false;
    supportsHistoricalState(reader, address).then((r) => { if (!off) setHist(r); });
    return () => { off = true; };
  }, [reader, address]);
  const block: BlockSelector = mode === "height" && /^\d+$/.test(height) ? BigInt(height) : "latest";

  return (
    <div>
      <div className="cx-toolbar">
        <label htmlFor="rd-block" className="cx-legend">Block</label>
        <select id="rd-block" value={mode} onChange={(e) => setMode(e.target.value as "latest" | "height")}>
          <option value="latest">latest</option>
          <option value="height" disabled={!hist?.supported}>a past height{hist && !hist.supported ? " (not served by this node)" : ""}</option>
        </select>
        {mode === "height" && (
          <input aria-label="Block height" className="mono" style={{ width: 160 }} inputMode="numeric" placeholder="height" value={height} onChange={(e) => setHeight(e.target.value.replace(/\D/g, ""))} />
        )}
        <span className="muted small">
          {hist === null ? "checking whether the node serves past state" : hist.supported ? "the node serves past state" : "Reads run at the node's executed head. Past-block reads need historical state on the node (CNV-RPC)."}
        </span>
      </div>
      {unverified && (
        <div className="cx-banner warn">
          <strong>Unverified contract.</strong> These functions were matched by selector against the bundled signature subset. The
          names and types are guesses until the source is verified.
        </div>
      )}
      {reads.length === 0 ? (
        <div className="cx-empty">No read functions are known for this contract.</div>
      ) : (
        <div className="cx-fnlist">
          {reads.map((fn, i) => (
            <ReadFn key={`${functionSignature(fn)}@${String(block)}`} fn={fn} index={i} address={address} reader={reader} abi={abi} block={block} unverified={unverified} />
          ))}
        </div>
      )}
      {unverified && <RawCall address={address} reader={reader} />}
    </div>
  );
}
