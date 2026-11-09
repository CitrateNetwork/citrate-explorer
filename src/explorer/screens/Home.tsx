"use client";

/**
 * Network state (direction B home). Every figure is computed from /api/ledger
 * and names its source; figures that need r1007 methods say so until the node
 * serves them.
 */
import { useMemo } from "react";
import { useLedger, type LedgerResponse } from "../api";
import { LEDGER_SOURCES } from "@/lib/citrate/ledger";
import {
  blocksPerSlot,
  colorBlocks,
  deriveSelectedChain,
  finalityRuler,
  mergeRate,
  producerShare,
  redRate,
  type MergesetMap,
} from "../model";
import { fmtAge, fmtNum, fmtPct, fmtSalt, shortHash } from "../format";
import { AddrLink, BlockLink, ColorChip, Failure, Fig, Loading, Method, NotYet, PageHead, R1007_PENDING, Section, Source, TxLink, href } from "../ui";
import { DagScroll, DagSvg } from "./DagSvg";

export function useLedgerModel(snap: LedgerResponse | null) {
  return useMemo(() => {
    if (!snap) return null;
    const blocks = snap.blocks;
    const tips = snap.dag?.tips ?? [];
    const chain = deriveSelectedChain(blocks, tips);
    const ghostdag: MergesetMap | null = snap.ghostdag;
    const colors = colorBlocks(blocks, chain, ghostdag);
    return { blocks, tips, chain, chainSet: new Set(chain), ghostdag, colors };
  }, [snap]);
}

function Columns({ perSlot }: { perSlot: number[] }) {
  const W = 600, Hh = 120, top = 8, bot = 20;
  const max = Math.max(4, ...perSlot);
  const bw = W / perSlot.length;
  const y = (x: number) => top + (Hh - top - bot) * (1 - x / max);
  const grid: number[] = [];
  for (let t = 0; t <= max; t += 2) grid.push(t);
  return (
    <svg className="lx-cols" viewBox={`0 0 ${W} ${Hh}`} preserveAspectRatio="none" role="img" aria-label={`Blocks per slot over the last ${perSlot.length} slots; empty slots marked in yellow`}>
      {grid.map((t) => (
        <g key={t}>
          <line x1={0} x2={W} y1={y(t)} y2={y(t)} stroke="var(--lx-dag-grid-2)" strokeWidth={1} />
          <text x={W} y={y(t) - 3} textAnchor="end">{t}</text>
        </g>
      ))}
      {perSlot.map((x, k) =>
        x ? (
          <rect key={k} x={k * bw + 1} y={y(x)} width={Math.max(1, bw - 2)} height={Hh - bot - y(x)} fill={k === perSlot.length - 1 ? "var(--citrate-green)" : "var(--deep-evergreen)"} />
        ) : (
          <rect key={k} x={k * bw + 1} y={Hh - bot - 3} width={Math.max(1, bw - 2)} height={3} fill="var(--citrate-yellow)" />
        ),
      )}
    </svg>
  );
}

function Ruler({ snap, tip }: { snap: LedgerResponse; tip: number }) {
  const r = finalityRuler(snap.finality, tip);
  if (!snap.capabilities.finalityStatus) {
    return <NotYet why="Finality is the checkpoint vote (CV-8), not block depth, so the explorer shows nothing here until the node reports checkpoints." method="citrate_getFinalityStatus" />;
  }
  if (!r) return <NotYet title="No checkpoint published yet" why="The node serves citrate_getFinalityStatus but its finality driver has not published a view." />;
  const fin = r.finalized ?? r.lo;
  return (
    <div className="lx-ruler" role="img" aria-label={`Finality: checkpoint ${r.finalized ?? "none"} finalized${r.pending != null ? `, ${r.pending} voting at ${r.pendingPct} percent` : ""}, tip ${r.tip}`}>
      {r.finalized != null ? (
        <span className="lx-ruler-m ll" style={{ left: `${r.at(r.finalized)}%` }}>FINALIZED {fmtNum(r.finalized)}</span>
      ) : null}
      <span className="lx-ruler-m rr" style={{ left: `${r.at(r.tip)}%` }}>TIP {fmtNum(r.tip)}</span>
      <div className="lx-ruler-t">
        <span className="lx-ruler-fin" style={{ width: `${r.at(fin)}%` }} />
        <span className="lx-ruler-vote" style={{ left: `${r.at(fin)}%`, width: `${Math.max(0, r.at(r.tip) - r.at(fin))}%` }} />
        <span className="lx-ruler-ticks" />
      </div>
      {r.pending != null ? (
        <span className={`lx-ruler-m down cp${r.at(r.pending) > 70 ? " rr" : ""}`} style={{ left: `${r.at(r.pending)}%` }}>
          VOTING {fmtNum(r.pending)} · {r.pendingPct?.toFixed(0)}%
        </span>
      ) : null}
    </div>
  );
}

export function Home() {
  const { data: snap, error, loading } = useLedger(60);
  const m = useLedgerModel(snap);
  if (!snap) return error ? <Failure what="the network state" error={error} /> : loading ? <Loading what="the network state" /> : null;
  if (!m) return null;

  const caps = snap.capabilities;
  const windowN = snap.window.toHeight - snap.window.fromHeight + 1;
  const mr = mergeRate(m.blocks, m.chain);
  const rr = redRate(m.chain, m.ghostdag);
  const counts = snap.dag?.counts ?? null;
  const bps = blocksPerSlot(m.blocks);
  const share = producerShare(m.blocks);
  const maxShare = Math.max(1, ...share.map((s) => s.n));
  const changes = snap.chainChanges;
  const tipHeight = m.blocks.reduce((x, b) => Math.max(x, b.height), 0);
  const recent = m.blocks.slice(0, 10);
  const now = snap.generatedAt;

  return (
    <>
      <div className="lx-hero">
        <PageHead eyebrow={`Network state · GhostDAG k = ${snap.dag?.k ?? 18}`} title="The ledger, as consensus sees it" />
      </div>
      {snap._stale ? <div className="lx-banner warn">The node did not answer the last read. Showing the snapshot from {Math.round((snap._ageMs ?? 0) / 1000)} s ago.</div> : null}

      <div className="lx-figs">
        {bps ? (
          <Fig label="Blocks per slot" value={bps.mean.toFixed(2)} sub={`${fmtPct(bps.emptyShare)}% of slots empty · ${bps.perSlot.length} slots`} />
        ) : (
          <Fig label="Blocks per slot" na={R1007_PENDING} sub="Headers carry no slot number yet (r1007 time slots)." />
        )}
        {mr ? (
          <Fig label="Merge rate" value={fmtPct(mr.rate)} unit="%" sub={`${mr.merging} of ${mr.total} chain blocks merge a side block`} />
        ) : (
          <Fig label="Merge rate" na="No chain blocks in the window" sub="Header mergeParentHashes" />
        )}
        {caps.selectedChainChanges && changes ? (
          <Fig label="Chain changes" value={String(changes.events.length)} sub={<>observed since {new Date(changes.since).toISOString().slice(11, 16)} UTC · <a className="lx-link" href={href("dag", "")}>timeline</a></>} />
        ) : (
          <Fig label="Chain changes" na={R1007_PENDING} sub="Needs citrate_getSelectedChainChanges." />
        )}
        {rr ? (
          <Fig label="Red blocks" value={fmtPct(rr.rate, 1)} unit="%" sub={`${rr.reds} red of ${rr.reds + rr.blues} merged · this window`} />
        ) : counts ? (
          <Fig label="Red blocks" value={fmtPct(counts.total ? counts.red / counts.total : 0, 1)} unit="%" sub={`${fmtNum(counts.red)} of ${fmtNum(counts.total)} blocks · whole DAG`} />
        ) : (
          <Fig label="Red blocks" na={R1007_PENDING} sub="Needs real mergeset colors (getGhostdagData) or fixed getDagStats counts." />
        )}
      </div>
      <Source text={`${LEDGER_SOURCES.blocks} (${windowN} heights, ${fmtNum(snap.window.fromHeight)} to ${fmtNum(snap.window.toHeight)}); merge rate from ${LEDGER_SOURCES.mergeRate}; selected chain from ${LEDGER_SOURCES.selectedChain}.`} />

      <div className="lx-two" style={{ marginTop: "var(--s-6)" }}>
        <Section title="Blocks per slot" source={LEDGER_SOURCES.blocksPerSlot}>
          {bps ? <Columns perSlot={bps.perSlot} /> : <NotYet why="Blocks are grouped by their r1007 time slot, which today's headers do not carry. Counting by timestamp would hide empty slots, so the explorer does not." />}
        </Section>
        <Section title="Finality · checkpoint votes" source={LEDGER_SOURCES.finality}>
          <Ruler snap={snap} tip={tipHeight} />
          {snap.finality?.published ? (
            <p className="lx-muted lx-small" style={{ margin: 0 }}>
              Mode <span className="lx-mono">{snap.finality.mode ?? "n/a"}</span>
              {snap.finality.enforcement ? ", enforced." : ". Votes are recorded and not yet enforced (CV-8)."}
              {snap.finality.halted ? " The finality safety stop is engaged." : ""}
            </p>
          ) : null}
        </Section>
      </div>

      <Section title={`DAG · last ${Math.min(40, m.blocks.length)} blocks`} source={`${LEDGER_SOURCES.blocks}; ${LEDGER_SOURCES.tips}.`}>
        <DagScroll>
          <DagSvg blocks={m.blocks} chainSet={m.chainSet} colors={m.colors} tips={m.tips} maxBlocks={40} compact />
        </DagScroll>
        <p className="lx-small" style={{ margin: "var(--s-2) 0 0" }}>
          <a className="lx-link" href={href("dag", "")}>Open the DAG ledger and mergeset inspector</a>
        </p>
      </Section>

      <div className="lx-two">
        <Section
          title={caps.blocksAtHeight ? "Latest blocks · siblings included" : "Latest blocks"}
          source={caps.blocksAtHeight ? `${LEDGER_SOURCES.blocks}, ${LEDGER_SOURCES.siblings}, ${LEDGER_SOURCES.tips}` : `${LEDGER_SOURCES.blocks} and ${LEDGER_SOURCES.tips}. Siblings that are not tips appear once the node serves citrate_getBlocksAtHeight.`}
        >
          <div className="lx-tbl-wrap">
            <table className="lx-tbl">
              <thead>
                <tr>
                  <th scope="col">Height</th>
                  <th scope="col">Color</th>
                  <th scope="col" className="lx-r">Blue score</th>
                  <th scope="col" className="lx-r">Txs</th>
                  <th scope="col">Producer</th>
                  <th scope="col">Age</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((b) => (
                  <tr key={b.hash}>
                    <td><BlockLink hash={b.hash} height={b.height} /></td>
                    <td><ColorChip color={m.colors[b.hash]} sm /></td>
                    <td className="lx-r lx-mono">{fmtNum(b.blueScore)}</td>
                    <td className="lx-r lx-mono">{b.txCount}</td>
                    <td>{b.miner ? <a className="lx-link lx-mono" href={href("address", b.miner)}>{shortHash(b.miner, 6, 4)}</a> : <span className="lx-muted">n/a</span>}</td>
                    <td className="lx-muted">{fmtAge(b.timestamp, now)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
        <Section title={`Producer share · ${windowN} heights`} source={`${LEDGER_SOURCES.producers}.`}>
          <div className="lx-tbl-wrap">
            <table className="lx-tbl">
              <thead>
                <tr>
                  <th scope="col">Producer</th>
                  <th scope="col" className="lx-r">Blocks</th>
                  <th scope="col">Share</th>
                  <th scope="col" className="lx-r">%</th>
                </tr>
              </thead>
              <tbody>
                {share.length ? (
                  share.slice(0, 8).map((s) => (
                    <tr key={s.producer}>
                      <td><a className="lx-link lx-mono" href={href("address", s.producer)}>{shortHash(s.producer, 6, 4)}</a></td>
                      <td className="lx-r lx-mono">{s.n}</td>
                      <td style={{ width: "45%" }}>
                        <div className="lx-bar-t"><i style={{ width: `${(100 * s.n) / maxShare}%` }} /></div>
                      </td>
                      <td className="lx-r lx-mono">{fmtPct(s.share)}</td>
                    </tr>
                  ))
                ) : (
                  <tr className="lx-empty"><td colSpan={4}>No block in the window names a producer.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="lx-muted lx-small">Slot leadership by sortition (CV-4b) is pending measurement; this table is an input to that decision.</p>
        </Section>
      </div>

      <Section title="Latest transactions" source={`${LEDGER_SOURCES.transactions} (${windowN} heights).`}>
        <div className="lx-tbl-wrap">
          <table className="lx-tbl">
            <thead>
              <tr>
                <th scope="col">Tx</th>
                <th scope="col">Method</th>
                <th scope="col">From</th>
                <th scope="col">To</th>
                <th scope="col" className="lx-r">Value</th>
                <th scope="col">Block</th>
              </tr>
            </thead>
            <tbody>
              {snap.transactions.length ? (
                snap.transactions.map((t) => (
                  <tr key={t.hash}>
                    <td><TxLink hash={t.hash} /></td>
                    <td><Method id={t.methodId} isCreate={t.isCreate} /></td>
                    <td><AddrLink addr={t.from} /></td>
                    <td><AddrLink addr={t.to} /></td>
                    <td className="lx-r lx-mono">{fmtSalt(t.valueSalt)}</td>
                    <td><BlockLink hash={t.blockHash} height={t.blockHeight} /></td>
                  </tr>
                ))
              ) : (
                <tr className="lx-empty"><td colSpan={6}>No transactions in the last {windowN} heights.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
