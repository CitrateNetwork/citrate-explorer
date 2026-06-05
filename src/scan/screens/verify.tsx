// @ts-nocheck
/* eslint-disable */
"use client";
// scan-verify.jsx → LIVE. Submit a contract's source to the recompile-and-diff
// engine (POST /api/verify) and show the real pass/fail + full/partial verdict.
import { useState } from "react";
import { SD } from "@/scan/data";
import { Icon } from "@/scan/icons";
import { Crumb, EntityChip } from "@/scan/components";
import { useScan } from "@/scan/context";

export function VerifyScreen({ addr }) {
  const scan = useScan();
  const [address, setAddress] = useState(addr || "");
  const [compilerVersion, setCompilerVersion] = useState("0.8.26");
  const [optimizationRuns, setOptimizationRuns] = useState(200);
  const [evmVersion, setEvmVersion] = useState("cancun");
  const [format, setFormat] = useState("solidity-single-file");
  const [source, setSource] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address) || !source.trim() || busy) return;
    setBusy(true); setResult(null);
    try {
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, format, compilerVersion, source, optimizationRuns: Number(optimizationRuns) || 0, evmVersion }),
      });
      setResult(await res.json());
    } catch (e) {
      setResult({ status: "fail", message: e.message });
    } finally { setBusy(false); }
  };

  const ok = result && result.status === "pass";
  return (
    <div className="wrap narrow">
      <Crumb items={[{ label: "Home", route: "" }, { label: "Verify contract" }]} />
      <div className="pagehead"><div><h1 className="row" style={{ gap: 10 }}><Icon name="shield" size={24} /> Verify a contract</h1><div className="sub">Recompile the source and diff the bytecode against the on-chain code. A match marks the contract verified and unlocks decoded reads + source.</div></div></div>

      <div className="card"><div className="card-bd" style={{ display: "grid", gap: 14 }}>
        <label className="vfield"><span className="vlbl">Contract address</span>
          <input className="vinput mono" value={address} onChange={(e) => setAddress(e.target.value.trim())} placeholder="0x…" /></label>
        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <label className="vfield"><span className="vlbl">Compiler</span>
            <input className="vinput mono" value={compilerVersion} onChange={(e) => setCompilerVersion(e.target.value.trim())} placeholder="0.8.26" /></label>
          <label className="vfield"><span className="vlbl">Optimizer runs</span>
            <input className="vinput mono" type="number" value={optimizationRuns} onChange={(e) => setOptimizationRuns(e.target.value)} placeholder="200" /></label>
          <label className="vfield"><span className="vlbl">EVM version</span>
            <input className="vinput mono" value={evmVersion} onChange={(e) => setEvmVersion(e.target.value.trim())} placeholder="cancun" /></label>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className={"btn sm" + (format === "solidity-single-file" ? " primary" : "")} onClick={() => setFormat("solidity-single-file")}>Single / flattened file</button>
          <button className={"btn sm" + (format === "solidity-standard-json-input" ? " primary" : "")} onClick={() => setFormat("solidity-standard-json-input")}>Standard-JSON input</button>
        </div>
        <label className="vfield"><span className="vlbl">{format === "solidity-standard-json-input" ? "Standard-JSON input" : "Solidity source"}</span>
          <textarea className="vinput mono" style={{ minHeight: 240, resize: "vertical" }} value={source} onChange={(e) => setSource(e.target.value)} placeholder={format === "solidity-standard-json-input" ? '{ "language": "Solidity", "sources": { … } }' : "// SPDX-License-Identifier: …\npragma solidity 0.8.26;\ncontract … { … }"} /></label>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <span className="note-sm" style={{ color: "var(--text-3)", fontSize: 12 }}>Immutables + CBOR metadata are handled automatically.</span>
          <button className="btn primary" onClick={submit} disabled={busy}>{busy ? "Compiling + diffing…" : <><Icon name="shield" size={15} /> Verify</>}</button>
        </div>
      </div></div>

      {result && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-h"><span className="t">Result</span><span className="spacer" />
            <span className={"badge " + (ok ? "green" : "red")} style={{ height: 22 }}><span className="d" /> {result.status}{result.matchType ? ` · ${result.matchType}` : ""}</span></div>
          <div className="card-bd">
            {ok && <div className="note" style={{ marginBottom: 10, color: "var(--accent-text)" }}><Icon name="check" size={15} /> {result.contractName} verified ({result.matchType} match) with {result.compilerVersion}.</div>}
            <div className="stat-rows">
              {result.guid && <div className="stat-row"><span className="k">guid</span><span className="v mono" style={{ fontSize: 12 }}>{result.guid}</span></div>}
              <div className="stat-row"><span className="k">Message</span><span className="v" style={{ textAlign: "right", maxWidth: 460 }}>{result.message}</span></div>
            </div>
            {ok && <div style={{ marginTop: 12 }}><button className="btn sm" onClick={() => scan.nav(`contract/${address}`)}>Open verified contract <Icon name="arrowright" size={14} /></button></div>}
          </div>
        </div>
      )}
    </div>
  );
}
