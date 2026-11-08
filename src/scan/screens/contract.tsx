"use client";

/**
 * Contract page (EXP-S3, design direction B). Verified contracts get Code (source
 * tree next to opcodes with source-map cross-highlighting), Read, Write and Events;
 * proxies read and write through the implementation ABI; unverified contracts get
 * the disassembly, selectors (bundled signature subset), Read/Write on the guessed
 * ABI, Events and the decompiled view.
 *
 * Every chain fact goes through the contract kit (src/lib/contract/kit.ts), the
 * same code the explorer agent calls. Data sources (Rule 7):
 *   - the Citrate RPC (eth_getCode, eth_getStorageAt, eth_call, eth_estimateGas,
 *     eth_getLogs) through createRpcReader();
 *   - verified source through a ContractInfoSource: today GET /api/contract/{a}/source;
 *     the verification v2 adapter (infoSources.ts) is wired when v2 is public;
 *   - token facts and the known-address label from GET /api/contract/{a}.
 */
import "@/scan/contract/contract.css";
import { useEffect, useMemo, useState } from "react";
import type { Abi } from "viem";
import { useScan } from "@/scan/context";
import { createRpcReader } from "@/lib/contract/rpcReader";
import { createApiSourceV1 } from "@/lib/contract/infoSources";
import { resolveAbi, type AbiSource, type ResolvedAbi } from "@/lib/contract/kit";
import type { VerificationStatus } from "@/lib/contract/types";
import { DisassemblyPane, VerifiedCodePane } from "@/scan/contract/CodePane";
import { ReadPane } from "@/scan/contract/ReadPane";
import { WritePane } from "@/scan/contract/WritePane";
import { DecompiledPane, EventsPane, ProxyBanner, SelectorsPane } from "@/scan/contract/panes";

type TabId = "code" | "read" | "write" | "events" | "selectors" | "decompiled";

interface Meta {
  label?: string | null;
  token?: { standard: string; name?: string | null; symbol?: string | null; decimals?: number | null; totalSupply?: string | null } | null;
}

const STATUS_TAG: Record<VerificationStatus, { text: string; cls: string }> = {
  verified: { text: "verified, full match", cls: "ok" },
  "partial-match": { text: "partial match, not verified", cls: "warn" },
  "similar-match": { text: "similar match, not verified here", cls: "warn" },
  unverified: { text: "unverified", cls: "" },
  unavailable: { text: "verification unknown", cls: "warn" },
};

const ABI_LABEL: Record<AbiSource, string> = {
  verified: "the verified ABI",
  "partial-match": "the partial-match ABI",
  "similar-match": "the similar-match ABI",
  "proxy-implementation": "the implementation's ABI",
  "signature-subset": "the guessed ABI",
  signature: "a supplied signature",
  none: "no ABI",
};

const short = (a: string) => `${a.slice(0, 10)}…${a.slice(-8)}`;

function CopyText({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="cx-btn ghost sm"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); }, () => {});
      }}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

export function ContractScreen({ addr }: { addr: string; tweaks?: unknown }) {
  // Keyed by address so every address starts from a clean state.
  return <ContractView key={(addr || "").toLowerCase()} addr={addr || ""} />;
}

function ContractView({ addr }: { addr: string }) {
  const scan = useScan() as unknown as { nav: (r: string) => void; setCtx?: (s: string) => void };
  const reader = useMemo(() => createRpcReader(), []);
  const info = useMemo(() => createApiSourceV1(), []);
  const valid = /^0x[0-9a-fA-F]{40}$/.test(addr || "");
  const [res, setRes] = useState<ResolvedAbi | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [tab, setTab] = useState<TabId>("code");
  const [asProxy, setAsProxy] = useState(true);

  useEffect(() => {
    if (!valid) return;
    let off = false;
    resolveAbi({ address: addr, reader, info }).then(
      (r) => { if (!off) setRes(r); },
      (e) => { if (!off) setErr((e as Error).message); },
    );
    fetch(`/api/contract/${addr}`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (!off && j) setMeta(j); }).catch(() => {});
    return () => { off = true; };
  }, [addr, valid, reader, info]);

  const name = res?.implementationInfo?.contractName ?? res?.info.contractName ?? meta?.label ?? meta?.token?.name ?? null;
  useEffect(() => {
    if (res && scan?.setCtx) scan.setCtx(`contract ${name ?? addr}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res, name]);

  if (!valid) {
    return (
      <div className="cx">
        <div className="cx-banner bad">That is not a contract address. An address is 0x followed by 40 hex characters.</div>
      </div>
    );
  }

  const head = (
    <header className="cx-head">
      <div style={{ minWidth: 0 }}>
        <div className="cx-eyebrow">Contract</div>
        <h1 className="cx-title">{name ?? "Contract"}</h1>
        <div className="cx-sub">
          <span className="mono brk">{addr}</span>
          <CopyText text={addr} />
        </div>
      </div>
      <button type="button" className="cx-btn ghost" onClick={() => scan.nav(`address/${addr}`)}>Address view</button>
    </header>
  );

  if (err) return <div className="cx">{head}<div className="cx-banner bad">Could not read this contract from the node: {err}</div></div>;
  if (!res) return <div className="cx">{head}<div className="cx-empty">Reading code, proxy slots and verification</div></div>;
  if (!res.hasCode) {
    return (
      <div className="cx">
        {head}
        <div className="cx-banner info">This address has no contract code. It is an externally owned account, or code that has not been deployed on this chain.</div>
      </div>
    );
  }

  const own = res.info;
  const proxy = res.proxy;
  const implInfo = res.implementationInfo;
  // Through a proxy, the implementation's ABI is the default ("as proxy"); the proxy's own ABI is the alternative when it has one.
  const useImpl = !!proxy && res.abiSource === "proxy-implementation" && asProxy;
  const abi: Abi = useImpl ? res.abi : proxy && res.abiSource === "proxy-implementation" ? own.abi ?? [] : res.abi;
  const abiSource: AbiSource = useImpl ? "proxy-implementation" : proxy && res.abiSource === "proxy-implementation" ? (own.verified ? "verified" : own.abi ? (own.status as AbiSource) : "none") : res.abiSource;
  const abiVerified = useImpl ? !!implInfo?.verified : abiSource === "verified";
  const hasSource = own.sources.length > 0 && own.status !== "unverified" && own.status !== "unavailable";
  const guessed = abiSource === "signature-subset";
  const status = STATUS_TAG[own.status];

  const tabs: Array<{ id: TabId; label: string; n?: number }> = [
    { id: "code", label: hasSource ? "Code" : "Disassembly" },
    ...(!hasSource && res.guess ? [{ id: "selectors" as TabId, label: "Selectors", n: res.guess.functions.length }] : []),
    { id: "read", label: useImpl ? "Read as proxy" : "Read contract", n: abi.filter((x) => x.type === "function" && (x.stateMutability === "view" || x.stateMutability === "pure")).length },
    { id: "write", label: useImpl ? "Write as proxy" : "Write contract", n: abi.filter((x) => x.type === "function" && x.stateMutability !== "view" && x.stateMutability !== "pure").length },
    { id: "events", label: "Events" },
    ...(!hasSource ? [{ id: "decompiled" as TabId, label: "Decompiled" }] : []),
  ];
  const runtimeSize = (res.runtimeCode.length - 2) / 2;
  const tok = meta?.token;

  return (
    <div className="cx">
      {head}
      {proxy && (
        <>
          <ProxyBanner
            proxy={proxy}
            address={addr}
            reader={reader}
            nav={scan.nav}
            implementationStatus={implInfo ? STATUS_TAG[implInfo.status].text : "implementation not checked"}
          />
          {res.abiSource === "proxy-implementation" && own.abi && (
            <div className="cx-toolbar">
              <label className="cx-row" style={{ gap: 6 }}>
                <input type="checkbox" style={{ width: "auto" }} checked={asProxy} onChange={(e) => setAsProxy(e.target.checked)} />
                Read and write as proxy (use the implementation&apos;s ABI)
              </label>
            </div>
          )}
        </>
      )}
      <div className="cx-tags">
        <span className={"cx-tag " + status.cls}>{status.text}</span>
        {own.compilerVersion && <span className="cx-tag">{own.compilerVersion.replace(/\+.*/, "")}</span>}
        {guessed && <span className="cx-tag warn">guessed ABI</span>}
        {tok && <span className="cx-tag info">{tok.standard}</span>}
      </div>
      {own.note && hasSource && <p className="muted small" style={{ marginTop: -6 }}>{own.note}</p>}
      <div className="cx-stats">
        <div className="cx-stat"><div className="cx-stat-k">Runtime size</div><div className="cx-stat-v">{runtimeSize.toLocaleString()} bytes</div></div>
        <div className="cx-stat"><div className="cx-stat-k">Code hash</div><div className="cx-stat-v mono" style={{ fontSize: 14 }}>{res.codeHash ? short(res.codeHash) : ""}</div></div>
        <div className="cx-stat"><div className="cx-stat-k">ABI</div><div className="cx-stat-v" style={{ fontSize: 15 }}>{ABI_LABEL[abiSource]}</div></div>
        {tok ? (
          <div className="cx-stat"><div className="cx-stat-k">Token</div><div className="cx-stat-v" style={{ fontSize: 15 }}>{[tok.name, tok.symbol].filter(Boolean).join(" · ") || tok.standard}</div></div>
        ) : (
          <div className="cx-stat"><div className="cx-stat-k">Match</div><div className="cx-stat-v" style={{ fontSize: 15 }}>{own.runtimeMatch ? `runtime ${own.runtimeMatch}${own.creationMatch ? `, creation ${own.creationMatch}` : ""}` : "none"}</div></div>
        )}
      </div>

      <div className="cx-tabs" role="tablist" aria-label="Contract views">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" id={`cx-tab-${t.id}`} aria-controls={`cx-tp-${t.id}`} aria-selected={tab === t.id} className="cx-tab" onClick={() => setTab(t.id)}>
            {t.label}{t.n !== undefined && <span className="n">{t.n}</span>}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`cx-tp-${tab}`} aria-labelledby={`cx-tab-${tab}`}>
        {tab === "code" && (hasSource ? <VerifiedCodePane info={own} runtimeCode={res.runtimeCode} /> : (
          <>
            {own.status === "unavailable" ? (
              <div className="cx-banner warn"><strong>Verification unknown.</strong> {own.note}</div>
            ) : (
              <div className="cx-banner info">
                <strong>Not verified.</strong> No source has been matched for this address.{" "}
                <button type="button" className="cx-link" onClick={() => scan.nav(`verify/${addr}`)}>Verify and publish the source</button>
              </div>
            )}
            <DisassemblyPane runtimeCode={res.runtimeCode} />
          </>
        ))}
        {tab === "selectors" && res.guess && <SelectorsPane guess={res.guess} />}
        {tab === "read" && <ReadPane address={addr} abi={abi} reader={reader} unverified={guessed} />}
        {tab === "write" && (
          <WritePane
            address={addr}
            abi={abi}
            abiSource={abiSource}
            abiVerified={abiVerified}
            viaProxy={useImpl}
            verification={useImpl ? (implInfo?.status ?? "unverified") : own.status}
            proxy={useImpl ? proxy : null}
            reader={reader}
            onOpenTx={(h) => scan.nav(`tx/${h}`)}
          />
        )}
        {tab === "events" && <EventsPane address={addr} abi={abi.length ? abi : null} reader={reader} nav={scan.nav} abiLabel={ABI_LABEL[abiSource]} />}
        {tab === "decompiled" && res.codeHash && <DecompiledPane chainId={reader.chainId} address={addr} codeHash={res.codeHash} />}
      </div>
    </div>
  );
}
