"use client";

/**
 * Events, selectors, decompiled view and the proxy banner (EXP-S3).
 *
 * Data sources (Rule 7): eth_getLogs (events, upgrade history) through the kit's
 * ChainReader; the bundled signature subset; the offline decompiler worker
 * (decompiler.ts), which reports "not available" when none is configured.
 */
import { useEffect, useState } from "react";
import type { Abi, Hex } from "viem";
import { decodeLog, recentLogs, type DecodedLog } from "@/lib/contract/events";
import { implementationHistory, type ImplementationChange, type ProxyInfo } from "@/lib/contract/proxy";
import type { AbiGuess } from "@/lib/contract/abiGuess";
import { functionSignature } from "@/lib/contract/codec";
import { canonicalSignature, lookupEvent } from "@/lib/contract/signatures";
import { decompilerFromEnv, type DecompilationResult } from "@/lib/contract/decompiler";
import type { ChainReader } from "@/lib/contract/types";

const short = (a: string, h = 8, t = 6) => (a.length > h + t + 1 ? `${a.slice(0, h)}…${a.slice(-t)}` : a);

type Nav = (route: string) => void;

/* ---------------- events ---------------- */

export function EventsPane({ address, abi, reader, nav, abiLabel }: { address: string; abi: Abi | null; reader: ChainReader; nav: Nav; abiLabel: string }) {
  const [rows, setRows] = useState<DecodedLog[]>([]);
  const [scanned, setScanned] = useState<{ fromBlock: bigint; toBlock: bigint } | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const apply = (r: Awaited<ReturnType<typeof recentLogs>>, older: boolean) => {
    const decoded = r.logs.map((l) => decodeLog(l, abi));
    setRows((cur) => (older ? [...cur, ...decoded] : decoded));
    setScanned((cur) => (cur && older ? { fromBlock: r.scanned.fromBlock, toBlock: cur.toBlock } : r.scanned));
    setMore(r.more);
  };
  // First page on mount; the parent remounts this pane for a new address.
  useEffect(() => {
    let off = false;
    recentLogs(reader, address, { pages: 5 }).then(
      (r) => { if (!off) { apply(r, false); setBusy(false); } },
      (e) => { if (!off) { setErr((e as Error).message); setBusy(false); } },
    );
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reader, address]);
  const older = async (before: bigint) => {
    setBusy(true);
    setErr(null);
    try {
      apply(await recentLogs(reader, address, { pages: 5, before }), true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="muted small" style={{ marginTop: 0 }}>
        Logs read from the node with eth_getLogs, decoded with {abiLabel}, then the bundled signature subset.
        {scanned && <> Scanned blocks {scanned.fromBlock.toLocaleString()} to {scanned.toBlock.toLocaleString()}.</>}
      </p>
      {err && <div className="cx-banner bad">{err}</div>}
      {rows.length === 0 && !busy && !err && <div className="cx-empty">No events from this contract in the scanned blocks.</div>}
      {rows.length > 0 && (
        <div className="cx-tbl-wrap">
          <table className="cx-tbl">
            <thead><tr><th scope="col">Block</th><th scope="col">Tx</th><th scope="col">Event</th><th scope="col">Decoded</th></tr></thead>
            <tbody>
              {rows.map((d, i) => (
                <tr key={`${d.log.transactionHash}-${d.log.logIndex}-${i}`}>
                  <td className="nw mono">{d.log.blockNumber !== null ? <button type="button" className="cx-link" onClick={() => nav(`block/${d.log.blockNumber}`)}>{d.log.blockNumber.toLocaleString()}</button> : "pending"}</td>
                  <td className="nw mono">{d.log.transactionHash ? <button type="button" className="cx-link" onClick={() => nav(`tx/${d.log.transactionHash}`)}>{short(d.log.transactionHash, 6, 4)}</button> : ""}</td>
                  <td className="nw mono">
                    {d.name ?? <span className="muted">unknown {short(d.log.topics[0] ?? "", 10, 4)}</span>}
                    {d.source === "signature-subset" && <div className="muted small">from the signature subset</div>}
                  </td>
                  <td className="mono brk small">
                    {d.args.length ? d.args.map((a) => <div key={a.name}><span className="muted">{a.name}{a.indexed ? " (indexed)" : ""}:</span> {a.display}</div>) : <span className="muted">{d.log.data === "0x" ? "no data" : short(d.log.data, 18, 8)}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="cx-row" style={{ marginTop: 12 }}>
        {more && scanned && <button type="button" className="cx-btn ghost" disabled={busy} onClick={() => void older(scanned.fromBlock)}>{busy ? "Reading" : "Read 5,000 older blocks"}</button>}
        {busy && !more && <span className="muted small">Reading logs</span>}
      </div>
    </div>
  );
}

/* ---------------- selectors ---------------- */

export function SelectorsPane({ guess }: { guess: AbiGuess }) {
  const resolved = guess.functions.filter((f) => f.resolved).length;
  return (
    <div>
      <p className="muted small" style={{ marginTop: 0 }}>
        Selectors found in the bytecode by whatsabi, resolved against the bundled signature subset (the explorer&apos;s known
        ABIs plus standard interfaces). {guess.functions.length} found, {resolved} resolved. There is no runtime 4byte lookup, so an
        unknown selector stays unknown. This is a guessed ABI; no source is known.
      </p>
      <div className="cx-tbl-wrap">
        <table className="cx-tbl">
          <thead><tr><th scope="col">Selector</th><th scope="col">Signature</th><th scope="col">Bytecode hint</th></tr></thead>
          <tbody>
            {guess.functions.map((f) => (
              <tr key={f.selector}>
                <td className="nw mono">{f.selector}</td>
                <td className="mono brk">
                  {f.resolved ? functionSignature(f.resolved) : <span className="muted">no match</span>}
                  {f.alternatives.length > 0 && <div className="muted small">also: {f.alternatives.map(functionSignature).join(", ")}</div>}
                </td>
                <td className="nw muted">{f.payable ? "no CALLVALUE check" : f.stateMutability ?? "unknown"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {guess.eventTopics.length > 0 && (
        <section className="cx-sec" style={{ marginTop: 20 }}>
          <h2 className="cx-sec-h">Event topics in the bytecode</h2>
          <div className="cx-tbl-wrap">
            <table className="cx-tbl">
              <tbody>
                {guess.eventTopics.map((t) => {
                  const ev = lookupEvent(t)[0];
                  return (
                    <tr key={t}>
                      <td className="mono brk small">{t}</td>
                      <td className="mono brk">{ev ? canonicalSignature(ev) : <span className="muted">no match</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

/* ---------------- decompiled ---------------- */

export function DecompiledPane({ chainId, address, codeHash }: { chainId: number; address: string; codeHash: Hex }) {
  const [r, setR] = useState<DecompilationResult | null>(null);
  useEffect(() => {
    let off = false;
    decompilerFromEnv().load(chainId, address, codeHash).then((x) => { if (!off) setR(x); });
    return () => { off = true; };
  }, [chainId, address, codeHash]);
  return (
    <div>
      <div className="cx-banner warn">
        <strong>Decompiled, not source.</strong> Output from an offline decompiler worker run on the runtime bytecode. Names are
        guesses. Do not rely on it for audits or for Write calls.
      </div>
      {!r && <div className="cx-empty">Checking the decompiler worker</div>}
      {r && r.status !== "ok" && (
        <div className="cx-banner info">
          <strong>{r.status === "not-available" ? "Not available yet." : r.status === "pending" ? "Not decompiled yet." : "Could not load."}</strong>
          <p>{r.reason}</p>
        </div>
      )}
      {r?.status === "ok" && (
        <>
          <p className="muted small">{r.decompiler.name} {r.decompiler.version}, generated {r.generatedAt}, for code hash <span className="mono">{short(r.codeHash, 10, 6)}</span>.</p>
          <pre className="cx-codeblock">{r.source}</pre>
        </>
      )}
    </div>
  );
}

/* ---------------- proxy banner ---------------- */

const KIND_LABEL: Record<ProxyInfo["kind"], string> = {
  eip1167: "EIP-1167 minimal proxy",
  eip1967: "EIP-1967 proxy",
  "eip1967-beacon": "EIP-1967 beacon proxy",
  eip1822: "EIP-1822 (UUPS) proxy",
};

const HISTORY_PAGES = 10n;

export function ProxyBanner({ proxy, address, reader, nav, implementationStatus }: {
  proxy: ProxyInfo;
  address: string;
  reader: ChainReader;
  nav: Nav;
  implementationStatus: string;
}) {
  const [hist, setHist] = useState<{ entries: ImplementationChange[]; scanned: { fromBlock: bigint; toBlock: bigint } } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scan = async () => {
    setBusy(true);
    setErr(null);
    try {
      const head = await reader.blockNumber();
      const from = head - HISTORY_PAGES * 1000n + 1n;
      setHist(await implementationHistory(reader, address, { fromBlock: from > 0n ? from : 0n, toBlock: head }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="cx-banner proxy">
      <strong>{KIND_LABEL[proxy.kind]}.</strong> Implementation{" "}
      <button type="button" className="cx-link mono" onClick={() => nav(`contract/${proxy.implementation}`)}>{short(proxy.implementation)}</button>{" "}
      <span className="muted">
        {proxy.slot ? <>read from slot <span className="mono small">{short(proxy.slot, 6, 6)}</span></> : "read from the clone bytecode"}
        {proxy.beacon && <> through beacon <span className="mono small">{short(proxy.beacon)}</span></>}
      </span>{" "}
      <span className="cx-tag">{implementationStatus}</span>
      {proxy.admin && <p>Admin <span className="mono">{short(proxy.admin)}</span></p>}
      {proxy.kind !== "eip1167" && (
        <details onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && !hist && !busy) void scan(); }}>
          <summary>Implementation history</summary>
          {busy && <p>Reading Upgraded events</p>}
          {err && <p className="cx-err">{err}</p>}
          {hist && (
            <>
              {hist.entries.length === 0 ? (
                <p>No Upgraded or BeaconUpgraded events in the last {(HISTORY_PAGES * 1000n).toLocaleString()} blocks.</p>
              ) : (
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {hist.entries.map((h, i) => (
                    <li key={i} className="small">
                      <button type="button" className="cx-link mono" onClick={() => nav(`contract/${h.implementation}`)}>{short(h.implementation)}</button>{" "}
                      <span className="muted">{h.event} at block {h.blockNumber?.toLocaleString() ?? "pending"}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p>
                Scanned blocks {hist.scanned.fromBlock.toLocaleString()} to {hist.scanned.toBlock.toLocaleString()}. Older history needs the
                indexer&apos;s logs table or historical eth_getStorageAt (CNV-RPC).
              </p>
            </>
          )}
        </details>
      )}
    </div>
  );
}
