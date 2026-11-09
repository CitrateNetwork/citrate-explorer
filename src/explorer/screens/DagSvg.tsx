"use client";

/**
 * The DAG ledger drawing (direction B): one ruled column per blue score, a
 * heavier rule every 10, square nodes, orthogonal merge edges, an ink spine for
 * the selected chain, hatched red, dashed outline where the color is not
 * reported. Geometry comes from model.dagLayout.
 */
import { useEffect, useId, useRef, type ReactNode } from "react";
import { dagLayout, type BlockColor, type LedgerBlock } from "../model";
import { fmtNum } from "../format";

const LABEL: Record<BlockColor, string> = { chain: "selected chain", blue: "blue", red: "red", unmerged: "not merged yet", unknown: "color not reported" };

export interface DagSelection {
  hash: string;
  mergeset: Set<string>;
  anticone: Set<string>;
  past: Set<string>;
}

export function DagSvg({
  blocks,
  chainSet,
  colors,
  tips,
  maxBlocks,
  compact,
  selection,
  finalizedHeight,
  onPick,
}: {
  blocks: LedgerBlock[];
  chainSet: Set<string>;
  colors: Record<string, BlockColor>;
  tips: string[];
  maxBlocks: number;
  compact?: boolean;
  selection?: DagSelection | null;
  finalizedHeight?: number | null;
  onPick?: (hash: string) => void;
}) {
  const hatch = useId().replace(/:/g, "");
  const L = dagLayout(blocks, chainSet, maxBlocks);
  if (!L.order.length) return <p className="lx-muted lx-small" style={{ padding: "var(--s-4)" }}>No blocks in the window.</p>;
  const sx = compact ? 20 : 28, ly = compact ? 20 : 34, padX = 24;
  const band = compact ? 0 : 22;
  const top = band + (compact ? 12 : 26), bot = compact ? 10 : 28;
  const H = top + bot + (L.maxLane - L.minLane) * ly;
  const W = padX * 2 + (L.maxBlueScore - L.minBlueScore) * sx;
  const X = (col: number) => padX + col * sx;
  const Y = (lane: number) => top + (lane - L.minLane) * ly;
  const tipSet = new Set(tips);
  const r = compact ? 5 : 7;

  const grid = [];
  for (let bs = L.minBlueScore; bs <= L.maxBlueScore; bs++) {
    const x = X(bs - L.minBlueScore);
    const heavy = bs % 10 === 0, mid = bs % 5 === 0;
    grid.push(<line key={`g${bs}`} className={heavy ? "lx-g2" : "lx-g1"} x1={x} x2={x} y1={band} y2={H - bot + 4} />);
    if (!compact && mid) grid.push(<text key={`t${bs}`} x={x} y={H - 10} textAnchor="middle" className={heavy ? "t-strong" : ""}>{fmtNum(bs)}</text>);
  }
  for (let l = L.minLane; l <= L.maxLane; l++) grid.push(<line key={`l${l}`} className="lx-g1" x1={0} x2={W} y1={Y(l)} y2={Y(l)} />);

  // finality strip: shaded up to the last block at or below the finalized checkpoint height
  let finStrip = null;
  if (!compact && finalizedHeight != null) {
    const fin = L.order.map((h) => L.nodes[h]).filter((n) => n.block.height <= finalizedHeight);
    const fx = fin.length ? X(Math.max(...fin.map((n) => n.col))) + sx / 2 : 0;
    finStrip = fx > 0 ? (
      <g>
        <rect className="lx-band-fin" x={0} y={0} width={Math.min(W, fx)} height={band} />
        <text className="t-band" x={Math.max(6, Math.min(W, fx) - 6)} y={15} textAnchor="end" fill="var(--citrate-green-dark)">FINALIZED</text>
      </g>
    ) : null;
  }

  return (
    <svg className={`lx-dag-svg${selection ? " has-sel" : ""}`} width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`DAG ledger of the last ${L.order.length} blocks, one column per blue score`}>
      <defs>
        <pattern id={hatch} width={4} height={4} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width={4} height={4} fill="var(--paper-pure)" />
          <rect width={1.6} height={4} fill="var(--semantic-danger)" />
        </pattern>
      </defs>
      {grid}
      {finStrip}
      {!compact ? <line x1={0} x2={W} y1={band} y2={band} stroke="var(--border-strong)" strokeWidth={1} /> : null}
      {L.edges.map((e) => {
        const a = L.nodes[e.from], b = L.nodes[e.to];
        const x1 = X(a.col), y1 = Y(a.lane), x2 = X(b.col), y2 = Y(b.lane);
        const xm = x2 - sx / 2;
        const ms = selection && e.to === selection.hash ? " lx-e-ms" : "";
        const red = colors[e.from] === "red" ? " lx-e-r" : "";
        if (e.kind === "spine") return <path key={`${e.from}${e.to}`} className="lx-e-spine" d={`M${x1} ${y1}H${x2}`} />;
        return <path key={`${e.from}${e.to}`} className={`${e.kind === "selected" ? "lx-e-s" : "lx-e-m"}${red}${ms}`} d={`M${x1} ${y1}H${xm}V${y2}H${x2}`} />;
      })}
      {L.order.map((h) => {
        const n = L.nodes[h];
        const x = X(n.col), y = Y(n.lane);
        const color = colors[h] ?? "unknown";
        const cls = ["lx-n", color];
        if (selection) {
          if (h === selection.hash) cls.push("is-sel");
          else if (selection.mergeset.has(h)) cls.push("in-ms");
          else if (selection.anticone.has(h)) cls.push("in-ac");
          else if (selection.past.has(h)) cls.push("in-past");
        }
        const rr = color === "chain" ? r + 1 : r;
        const tip = tipSet.has(h);
        const label = `Block ${fmtNum(n.block.height)}, ${LABEL[color]}, blue score ${fmtNum(n.block.blueScore)}${tip ? ", tip" : ""}`;
        const pick = () => onPick?.(h);
        return (
          <g
            key={h}
            className={cls.join(" ")}
            role={onPick ? "button" : undefined}
            tabIndex={onPick && !compact ? 0 : -1}
            aria-label={label}
            onClick={pick}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" || ev.key === " ") {
                ev.preventDefault();
                pick();
              }
            }}
          >
            <title>{label}</title>
            {tip ? <rect className="tipmark" x={x - rr - 4} y={y - rr - 4} width={2 * rr + 8} height={2 * rr + 8} /> : null}
            <rect className="body" x={x - rr} y={y - rr} width={2 * rr} height={2 * rr} style={color === "red" ? { fill: `url(#${hatch})` } : undefined} />
            {selection && h === selection.hash ? <rect className="selbox" x={x - rr - 5} y={y - rr - 5} width={2 * rr + 10} height={2 * rr + 10} /> : null}
          </g>
        );
      })}
    </svg>
  );
}

export function Legend() {
  const sq = (cls: string) => (
    <svg width={14} height={14} aria-hidden="true" className="lx-dag-svg">
      <g className={`lx-n ${cls}`}><rect className="body" x={2} y={2} width={10} height={10} /></g>
    </svg>
  );
  return (
    <div className="lx-legend" aria-label="Legend">
      <span>{sq("chain")}Selected chain</span>
      <span>{sq("blue")}Blue</span>
      <span><span className="lx-sq red" aria-hidden="true" />Red (hatched)</span>
      <span>{sq("unmerged")}Not merged yet</span>
      <span>{sq("unknown")}Color not reported</span>
      <span>
        <svg width={20} height={10} aria-hidden="true"><line x1={0} x2={20} y1={5} y2={5} stroke="var(--fg-1)" strokeWidth={3} /></svg>Spine
      </span>
    </div>
  );
}

/**
 * Scroll frame for the ledger: opens on the newest columns (the right edge),
 * or on the selected block when there is one, and keeps the reader's position
 * across 5 s refreshes unless they were already at the right edge.
 */
export function DagScroll({ children, focusHash, className }: { children: ReactNode; focusHash?: string | null; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  useEffect(() => {
    const w = ref.current;
    if (!w) return;
    const sel = focusHash ? w.querySelector<SVGGElement>(".lx-n.is-sel rect.body") : null;
    if (sel) w.scrollLeft = Math.max(0, Number(sel.getAttribute("x")) - w.clientWidth * 0.6);
    else if (atEnd.current) w.scrollLeft = w.scrollWidth;
  });
  return (
    <div
      ref={ref}
      className={className ?? "lx-dag-wrap"}
      onScroll={(e) => {
        const w = e.currentTarget;
        atEnd.current = w.scrollLeft + w.clientWidth >= w.scrollWidth - 40;
      }}
    >
      {children}
    </div>
  );
}
