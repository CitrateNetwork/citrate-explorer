"use client";

/**
 * DAG ledger and mergeset inspector. Structure (selected parents, merge
 * parents, tips, blue score) is read from headers today; mergeset blues and
 * reds, finality and chain changes light up when the node serves the r1007
 * methods.
 */
import { useMemo } from "react";
import { useLedger } from "../api";
import { LEDGER_SOURCES } from "@/lib/citrate/ledger";
import { anticoneInWindow, finalityOf, mergedBy, type BlockColor } from "../model";
import { fmtNum } from "../format";
import { BlockLink, ColorChip, Failure, FinChip, KV, row, Loading, NotYet, PageHead, Pill, Section, Source, href } from "../ui";
import { DagScroll, DagSvg, Legend, type DagSelection } from "./DagSvg";
import { useLedgerModel } from "./Home";

function MsTable({ list, colors, heights }: { list: string[]; colors: Record<string, BlockColor>; heights: Map<string, number> }) {
  if (!list.length) return <p className="lx-muted lx-small" style={{ margin: "var(--s-1) 0" }}>None</p>;
  return (
    <div className="lx-tbl-wrap">
      <table className="lx-tbl">
        <thead>
          <tr>
            <th scope="col">Block</th>
            <th scope="col">Color</th>
          </tr>
        </thead>
        <tbody>
          {list.map((h) => (
            <tr key={h}>
              <td><BlockLink hash={h} height={heights.get(h) ?? null} dag /></td>
              <td>{colors[h] ? <ColorChip color={colors[h]} sm /> : <span className="lx-muted lx-small">outside the window</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Dag({ selected }: { selected: string | null }) {
  const { data: snap, error, loading } = useLedger(60);
  const m = useLedgerModel(snap);

  const sel = useMemo(() => {
    if (!m) return null;
    const by = new Map(m.blocks.map((b) => [b.hash, b]));
    let hash = selected && by.has(selected) ? selected : null;
    if (!hash) hash = m.chain.find((h) => (by.get(h)?.mergeParents.length ?? 0) > 0) ?? m.chain[0] ?? m.blocks[0]?.hash ?? null;
    if (!hash) return null;
    const b = by.get(hash)!;
    const g = m.ghostdag?.[hash] ?? null;
    const anticone = anticoneInWindow(hash, m.blocks);
    const ac = new Set(anticone);
    const past = new Set(m.blocks.filter((x) => x.hash !== hash && !ac.has(x.hash) && x.blueScore <= b.blueScore).map((x) => x.hash));
    const mergeset = new Set(g ? [...g.mergesetBlues, ...g.mergesetReds] : [b.selectedParent, ...b.mergeParents].filter((x): x is string => !!x));
    const selection: DagSelection = { hash, mergeset, anticone: ac, past };
    return { hash, b, g, anticone, selection, merged: mergedBy(m.blocks, m.chain, m.ghostdag), requested: selected, found: !!(selected && by.has(selected)) };
  }, [m, selected]);

  if (!snap) return error ? <Failure what="the DAG" error={error} /> : loading ? <Loading what="the DAG" /> : null;
  if (!m) return null;
  const heights = new Map(m.blocks.map((b) => [b.hash, b.height]));
  const caps = snap.capabilities;
  const fin = snap.finality;
  const pending = fin?.pending[0] ?? null;

  return (
    <>
      <PageHead eyebrow={`GhostDAG k = ${snap.dag?.k ?? 18}`} title="DAG ledger" sub="One column per blue score · lanes are siblings · newest on the right" />
      <div className="lx-dag-top">
        <Legend />
        <div className="lx-ctrls">
          <span className="lx-live"><span className={`lx-live-dot${snap._stale ? " off" : ""}`} aria-hidden="true" />{snap._stale ? "Node not answering, last snapshot" : "Live, refreshed every 5 s"}</span>
        </div>
      </div>
      {selected && sel && !sel.found ? (
        <div className="lx-banner">
          Block <span className="lx-mono">{selected.slice(0, 12)}…</span> is not in the newest {snap.window.toHeight - snap.window.fromHeight + 1} heights.{" "}
          <a className="lx-link" href={href("block", selected)}>Open its record</a>.
        </div>
      ) : null}
      <div className="lx-dag-layout">
        <div style={{ minWidth: 0 }}>
          <p className="lx-small lx-mono" style={{ margin: "0 0 var(--s-2)" }}>
            {fin?.published ? (
              <>
                <span style={{ color: "var(--citrate-green-dark)" }}>FINALIZED ≤ {fin.finalized ? fmtNum(fin.finalized.height) : "none"}</span>
                {pending ? <> · <span style={{ color: "var(--citrate-yellow-dark)" }}>VOTING {fmtNum(pending.height)} at {pending.quorumPct.toFixed(0)}%</span></> : null}
                {" · "}
              </>
            ) : (
              <>FINALITY AFTER R1007 · </>
            )}
            TIP {fmtNum(snap.window.toHeight)} · {snap.dag?.tipsCount ?? m.tips.length} TIPS
          </p>
          <DagScroll focusHash={selected && sel?.found ? sel.hash : null}>
            <DagSvg
              blocks={m.blocks}
              chainSet={m.chainSet}
              colors={m.colors}
              tips={m.tips}
              maxBlocks={90}
              selection={sel?.selection ?? null}
              finalizedHeight={fin?.finalized?.height ?? null}
              onPick={(h) => {
                location.hash = `#/dag/${h}`;
              }}
            />
          </DagScroll>
          <Source text={`${LEDGER_SOURCES.blocks}; ${LEDGER_SOURCES.tips}; edges from header selectedParentHash and mergeParentHashes; ${caps.ghostdagData ? LEDGER_SOURCES.colors : "colors not reported by this node (citrate_getGhostdagData)"}.`} />

          <Section title="Selected-chain changes" source={LEDGER_SOURCES.chainChanges}>
            {caps.selectedChainChanges && snap.chainChanges ? (
              <>
                <div className="lx-tbl-wrap">
                  <table className="lx-tbl">
                    <thead>
                      <tr>
                        <th scope="col">Observed</th>
                        <th scope="col" className="lx-r">Depth</th>
                        <th scope="col">Left the chain</th>
                        <th scope="col">Joined the chain</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snap.chainChanges.events.length ? (
                        snap.chainChanges.events.map((c) => (
                          <tr key={c.at + c.removed.join()}>
                            <td className="lx-mono">{new Date(c.at).toISOString().slice(11, 19)} UTC</td>
                            <td className="lx-r lx-mono">{c.removed.length}</td>
                            <td>{c.removed.slice(0, 3).map((h) => <span key={h}><BlockLink hash={h} height={heights.get(h) ?? null} dag /> </span>)}</td>
                            <td>{c.added.slice(0, 3).map((h) => <span key={h}><BlockLink hash={h} height={heights.get(h) ?? null} dag /> </span>)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr className="lx-empty"><td colSpan={4}>No change observed since {new Date(snap.chainChanges.since).toISOString().slice(11, 16)} UTC.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="lx-muted lx-small">Observed by this explorer server between refreshes. The persisted feed comes with the indexer (EXP-S1). A block that leaves the selected chain stays in the DAG and is merged as a side block.</p>
              </>
            ) : (
              <NotYet why="A change of the selected chain is reported by the node as the blocks that left and joined it. The explorer does not reconstruct it from height walks." method="citrate_getSelectedChainChanges" />
            )}
          </Section>
        </div>

        {sel ? (
          <aside className="lx-insp" aria-label="Mergeset inspector">
            <div>
              <span className="lx-eyebrow">Mergeset filing</span>
              <h2>Block {fmtNum(sel.b.height)} <span className="lx-hsuf lx-mono">{sel.hash.slice(0, 6)}</span></h2>
              <div className="lx-srow" style={{ margin: "var(--s-2) 0 0" }}>
                <ColorChip color={m.colors[sel.hash]} />
                {m.tips.includes(sel.hash) ? <Pill tone="draft">Tip</Pill> : null}
                <FinChip state={finalityOf(sel.b.height, fin)} checkpoint={fin?.finalized?.height} pct={pending?.quorumPct} />
              </div>
            </div>
            <KV
              rows={[
                row("Blue score", <span className="lx-mono" key="bs">{fmtNum(sel.b.blueScore)}</span>),
                row("Selected parent", sel.b.selectedParent ? <BlockLink hash={sel.b.selectedParent} height={heights.get(sel.b.selectedParent) ?? null} dag /> : "genesis"),
                row("Merge parents", sel.b.mergeParents.length ? <span key="mp">{sel.b.mergeParents.map((p) => <span key={p}><BlockLink hash={p} height={heights.get(p) ?? null} dag /> </span>)}</span> : <span className="lx-muted">none</span>),
                [
                  "Merged by",
                  m.chainSet.has(sel.hash) ? (
                    <span className="lx-muted" key="mb">on the selected chain</span>
                  ) : sel.merged[sel.hash] ? (
                    <BlockLink hash={sel.merged[sel.hash]} height={heights.get(sel.merged[sel.hash]) ?? null} dag />
                  ) : (
                    <span className="lx-muted" key="mb">not merged in this window</span>
                  ),
                ],
              ]}
            />
            {sel.g ? (
              <>
                <section>
                  <h3 className="lx-sec-h">Blues · {sel.g.mergesetBlues.length}</h3>
                  <MsTable list={sel.g.mergesetBlues} colors={m.colors} heights={heights} />
                </section>
                <section>
                  <h3 className="lx-sec-h">Reds · {sel.g.mergesetReds.length}</h3>
                  <MsTable list={sel.g.mergesetReds} colors={m.colors} heights={heights} />
                </section>
              </>
            ) : (
              <section>
                <h3 className="lx-sec-h">Mergeset blues and reds</h3>
                <NotYet why="The mergeset and each member's color come from the node's GhostDAG store. Header merge parents are listed above; they are part of the mergeset but not all of it." method="citrate_getGhostdagData" />
              </section>
            )}
            <section>
              <h3 className="lx-sec-h">Anticone in view · {sel.anticone.length}</h3>
              <MsTable list={sel.anticone.slice(0, 12)} colors={m.colors} heights={heights} />
              <p className="lx-muted lx-small" style={{ margin: "var(--s-2) 0 0" }}>Blocks in the loaded window that are neither ancestors nor descendants, from header parents.</p>
            </section>
            <a className="lx-link" href={href("block", sel.hash)}>Open the block record</a>
          </aside>
        ) : null}
      </div>
    </>
  );
}
