"use client";

/**
 * Direction-B primitives: page header, sections with a named data source,
 * key-value records, figures, status pills (the kit's Pill), the GhostDAG color
 * chip with a shape cue, and the honest "not available yet" panel.
 */
import { useState, type ReactNode } from "react";
import type { BlockColor, FinalityState } from "./model";
import { fmtNum, heightRef, shortHash } from "./format";

export const R1007_PENDING = "Available after the r1007 upgrade";

export function href(kind: "block" | "tx" | "address" | "contract" | "dag", id: string | number): string {
  return `#/${kind}/${id}`;
}

export function PageHead({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
  return (
    <div className="lx-pg">
      <span className="lx-eyebrow">{eyebrow} · chain 40204</span>
      <h1 tabIndex={-1}>{title}</h1>
      {sub ? <span className="lx-pg-sub">{sub}</span> : null}
    </div>
  );
}

export function Section({ title, source, children, id }: { title: string; source?: string; children: ReactNode; id?: string }) {
  return (
    <section className="lx-sec" id={id}>
      <h2 className="lx-sec-h">{title}</h2>
      {children}
      {source ? <Source text={source} /> : null}
    </section>
  );
}

export function Source({ text }: { text: string }) {
  return (
    <p className="lx-src">
      <b>Source</b> {text}
    </p>
  );
}

export type KVRow = [string, ReactNode, string?];

/** One record row; a function so JSX values are arguments, not array items. */
export function row(k: string, v: ReactNode, hint?: string): KVRow {
  return [k, v, hint];
}

export function KV({ rows }: { rows: Array<KVRow | null | false> }) {
  return (
    <dl className="lx-kv">
      {rows.filter((r): r is KVRow => !!r).map(([k, v, hint]) => (
        <div className="lx-kv-r" key={k}>
          <dt>
            {k}
            {hint ? <span className="lx-kv-h">{hint}</span> : null}
          </dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Fig({ label, value, unit, sub, na, compact }: { label: string; value?: ReactNode; unit?: string; sub: ReactNode; na?: string; compact?: boolean }) {
  return (
    <div className="lx-fig">
      <span className="lx-eyebrow">{label}</span>
      {na ? (
        <span className="lx-fig-v na">{na}</span>
      ) : (
        <span className={`lx-fig-v${compact ? " compact" : ""}`}>
          {value}
          {unit ? <small>{unit}</small> : null}
        </span>
      )}
      <span className="lx-fig-s">{sub}</span>
    </div>
  );
}

export type PillTone = "settled" | "pending" | "blocked" | "notice" | "draft" | "onrecord";

export function Pill({ tone, children, sm, dashed }: { tone: PillTone; children: ReactNode; sm?: boolean; dashed?: boolean }) {
  return (
    <span className={`lx-pill ${tone}${sm ? " sm" : ""}${dashed ? " dashed" : ""}`}>
      <i aria-hidden="true" />
      {children}
    </span>
  );
}

const COLOR_LABEL: Record<BlockColor, string> = {
  chain: "Selected chain",
  blue: "Blue",
  red: "Red",
  unmerged: "Not merged yet",
  unknown: "Color after r1007",
};
const COLOR_TONE: Record<BlockColor, PillTone> = { chain: "onrecord", blue: "notice", red: "blocked", unmerged: "draft", unknown: "draft" };

export function ColorChip({ color, sm }: { color: BlockColor; sm?: boolean }) {
  return (
    <span className={`lx-pill ${COLOR_TONE[color]}${sm ? " sm" : ""}${color === "unknown" ? " dashed" : ""}`} title={color === "unknown" ? "Blue or red comes from citrate_getGhostdagData, which this node does not serve yet" : undefined}>
      <span className={`lx-sq ${color}`} aria-hidden="true" />
      {COLOR_LABEL[color]}
    </span>
  );
}

export function FinChip({ state, checkpoint, pct }: { state: FinalityState; checkpoint?: number | null; pct?: number | null }) {
  if (state === "finalized") return <Pill tone="settled">Finalized{checkpoint != null ? ` · checkpoint ${fmtNum(checkpoint)}` : ""}</Pill>;
  if (state === "voting") return <Pill tone="pending">Voting{pct != null ? ` · ${pct.toFixed(0)}% of stake` : ""}</Pill>;
  if (state === "above") return <Pill tone="notice">Above checkpoint</Pill>;
  return <Pill tone="draft" dashed>Finality after r1007</Pill>;
}

export function TxStatus({ status }: { status: string }) {
  if (status === "success") return <Pill tone="settled">Success</Pill>;
  if (status === "reverted" || status === "failed") return <Pill tone="blocked">Reverted</Pill>;
  if (status.startsWith("skipped")) return <Pill tone="pending">Skipped, {status.replace("skipped:", "")}</Pill>;
  return <Pill tone="pending">Pending</Pill>;
}

export function NotYet({ title, why, method }: { title?: string; why: string; method?: string }) {
  return (
    <div className="lx-na" role="note">
      <span className="lx-na-t">{title ?? R1007_PENDING}</span>
      <p>
        {why}
        {method ? (
          <>
            {" "}
            Reads <span className="lx-mono">{method}</span> when the node serves it; this page checks every minute.
          </>
        ) : null}
      </p>
    </div>
  );
}

export function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="lx-copy"
      aria-label="Copy to clipboard"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1200);
          },
          () => undefined,
        );
      }}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

export function BlockLink({ hash, height, dag }: { hash: string; height?: number | null; dag?: boolean }) {
  const to = dag ? href("dag", hash) : href("block", hash);
  if (height == null) return <a className="lx-link lx-mono" href={to}>{shortHash(hash, 8, 6)}</a>;
  const r = heightRef(height, hash);
  return (
    <a className="lx-link lx-mono" href={to}>
      {r.height}
      <span className="lx-hsuf"> {r.prefix}</span>
    </a>
  );
}

export function TxLink({ hash }: { hash: string }) {
  return <a className="lx-link lx-mono" href={href("tx", hash)}>{shortHash(hash, 10, 6)}</a>;
}

export function AddrLink({ addr }: { addr: string | null }) {
  if (!addr) return <span className="lx-muted">contract creation</span>;
  return <a className="lx-link lx-mono" href={href("address", addr)}>{shortHash(addr, 8, 6)}</a>;
}

export function Method({ id, isCreate }: { id: string | null; isCreate?: boolean }) {
  const t = isCreate ? "create" : id ?? "transfer";
  return <span className="lx-pill draft sm lx-mono">{t}</span>;
}

export function Loading({ what }: { what: string }) {
  return <p className="lx-loading" role="status">Reading {what} from the node…</p>;
}

export function Failure({ what, error }: { what: string; error: string }) {
  return (
    <div className="lx-err" role="alert">
      Could not read {what}: {error}. Nothing is shown in its place. The page retries on its own.
    </div>
  );
}
