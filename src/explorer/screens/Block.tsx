"use client";

/** Block record (direction B). Header fields today; GhostDAG data and finality when served. */
import { useMemo } from "react";
import { useBlock, useLedger } from "../api";
import { colorBlocks, deriveSelectedChain, finalityOf, mergedBy } from "../model";
import { fmtAge, fmtNum, fmtSalt, isoTime, shortHash } from "../format";
import { AddrLink, BlockLink, ColorChip, Copy, Failure, FinChip, KV, row, Loading, Method, NotYet, PageHead, Pill, Section, TxLink, href } from "../ui";

export function Block({ id }: { id: string }) {
  const { data: b, error } = useBlock(id);
  const { data: snap } = useLedger(60);

  const place = useMemo(() => {
    if (!b || !snap) return null;
    const inWindow = snap.blocks.some((x) => x.hash === b.hash);
    if (!inWindow) return null;
    const chain = deriveSelectedChain(snap.blocks, snap.dag?.tips ?? []);
    const colors = colorBlocks(snap.blocks, chain, snap.ghostdag);
    const merged = mergedBy(snap.blocks, chain, snap.ghostdag);
    const children = snap.blocks.filter((x) => x.selectedParent === b.hash || x.mergeParents.includes(b.hash));
    return { color: colors[b.hash], mergedBy: merged[b.hash] ?? null, onChain: chain.includes(b.hash), children, tip: (snap.dag?.tips ?? []).includes(b.hash) };
  }, [b, snap]);

  const heightOf = (h: string) => snap?.blocks.find((x) => x.hash === h)?.height ?? null;
  if (!b) return <><PageHead eyebrow="Block" title="Block" sub={id.startsWith("0x") ? shortHash(id, 14, 10) : id} />{error ? <Failure what={`block ${id}`} error={error} /> : <Loading what={`block ${id}`} />}</>;
  const r = b.r1007;
  const g = r?.ghostdag ?? null;
  const fin = r?.finality ?? snap?.finality ?? null;
  const finState = finalityOf(b.height, fin);
  const pending = fin?.pending[0] ?? null;
  const color = place?.color ?? (g ? null : "unknown");

  return (
    <>
      <PageHead eyebrow="Block" title={`Block ${fmtNum(b.height)}`} sub={shortHash(b.hash, 14, 10)} />
      <div className="lx-srow">
        {color ? <ColorChip color={color} /> : null}
        <FinChip state={finState} checkpoint={fin?.finalized?.height} pct={pending?.quorumPct} />
        {b.mergeParents.length ? <Pill tone="draft">Merges {b.mergeParents.length}</Pill> : null}
        {place?.tip ? <Pill tone="draft">Tip</Pill> : null}
      </div>

      <Section title="DAG position" source="eth_getBlockByHash/ByNumber header fields; mergeset from citrate_getGhostdagData; color and children from the /api/ledger window when the block is in it">
        <KV
          rows={[
            row("Block hash", <><span className="lx-mono lx-brk">{b.hash}</span><Copy text={b.hash} /></>),
            row("Height", <span className="lx-mono">{fmtNum(b.height)}</span>, "longest parent path"),
            row("Blue score", <span className="lx-mono">{fmtNum(g?.blueScore ?? b.blueScore)}</span>, "blue blocks in its past"),
            row("Blue work", <span className="lx-mono">{g?.blueWork ?? b.blueWork}</span>),
            row("Selected parent", b.selectedParent ? <BlockLink hash={b.selectedParent} height={heightOf(b.selectedParent)} /> : "genesis"),
            row("Merge parents", b.mergeParents.length ? <>{b.mergeParents.map((p) => <span key={p}><BlockLink hash={p} height={heightOf(p)} /> </span>)}</> : <span className="lx-muted">none</span>),
            [
              "Mergeset",
              g ? (
                <>
                  <span className="lx-mono">{g.mergesetBlues.length} blue</span> · <span className="lx-mono">{g.mergesetReds.length} red</span>{" "}
                  <a className="lx-link" href={href("dag", b.hash)}>Inspect in the DAG</a>
                </>
              ) : (
                <>
                  <span className="lx-muted">Blues and reds after the r1007 upgrade (citrate_getGhostdagData).</span>{" "}
                  <a className="lx-link" href={href("dag", b.hash)}>Inspect in the DAG</a>
                </>
              ),
            ],
            g && g.blueAnticoneSize != null ? row("Blue anticone size", <span className="lx-mono">{g.blueAnticoneSize}</span>) : null,
            [
              "Merged by",
              place?.onChain ? (
                <span className="lx-muted">on the selected chain; its own transactions are accepted by its selected child</span>
              ) : place?.mergedBy ? (
                <BlockLink hash={place.mergedBy} height={heightOf(place.mergedBy)} />
              ) : place ? (
                <span className="lx-muted">not merged yet in the loaded window</span>
              ) : snap ? (
                <span className="lx-muted">outside the live window of the newest heights</span>
              ) : (
                <span className="lx-muted">reading the live window…</span>
              ),
            ],
            place ? row("Children", place.children.length ? <>{place.children.map((c) => <span key={c.hash}><BlockLink hash={c.hash} height={c.height} /> </span>)}</> : <span className="lx-muted">none yet</span>) : null,
            [
              "Same height",
              r?.siblings ? (
                r.siblings.length ? <>{r.siblings.map((s) => <span key={s}><BlockLink hash={s} height={b.height} /> </span>)}</> : <span className="lx-muted">no sibling</span>
              ) : (
                <span className="lx-muted">Siblings after the r1007 upgrade (citrate_getBlocksAtHeight).</span>
              ),
            ],
          ]}
        />
      </Section>

      <Section title="Header" source="eth_getBlockByHash/ByNumber">
        <KV
          rows={[
            row("Producer", b.miner ? <AddrLink addr={b.miner} /> : <span className="lx-muted">not reported</span>, "header miner (reward beneficiary)"),
            b.proposer ? row("Proposer key", <span className="lx-mono lx-brk">{b.proposer}</span>, "ed25519 consensus key") : null,
            row("Timestamp", <span className="lx-mono">{isoTime(b.timestamp)} <span className="lx-muted">({fmtAge(b.timestamp)})</span></span>),
            row("Transactions", <span className="lx-mono">{b.txCount}</span>),
            row("Gas used", <span className="lx-mono">{fmtNum(b.gasUsed)} of {fmtNum(b.gasLimit)}</span>),
            b.baseFeePerGas ? row("Base fee", <span className="lx-mono">{fmtNum(Number(b.baseFeePerGas) / 1e9)} gwei</span>) : null,
          ]}
        />
      </Section>

      <Section title="Finality" source="citrate_getFinalityStatus (checkpoint votes, CV-8)">
        {fin?.published ? (
          <KV
            rows={[
              row("State", <FinChip key="f" state={finState} checkpoint={fin.finalized?.height} pct={pending?.quorumPct} />),
              row("Finalized checkpoint", fin.finalized ? <span className="lx-mono">{fmtNum(fin.finalized.height)}</span> : <span className="lx-muted">none yet</span>),
              pending ? row("Voting on", <span className="lx-mono">{fmtNum(pending.height)} · {pending.voters} of {pending.committeeSize} voters · {pending.quorumPct.toFixed(0)}% of stake</span>) : null,
              row("Rule", <span className="lx-muted">{fin.quorumRule ?? "more than 2/3 of the committee stake"}{fin.enforcement ? ", enforced" : ", recorded, not yet enforced"}</span>),
            ]}
          />
        ) : (
          <NotYet why="A block is final when a checkpoint at or above it collects the committee's votes. Depth is not finality (CV-8), so the explorer shows no finality until the node reports checkpoints." method="citrate_getFinalityStatus" />
        )}
      </Section>

      <Section title={`Transactions · ${b.txCount}`} source="transactions of eth_getBlockByHash">
        {b.transactions.length ? (
          <div className="lx-tbl-wrap">
            <table className="lx-tbl">
              <thead>
                <tr>
                  <th scope="col">Tx hash</th>
                  <th scope="col">Method</th>
                  <th scope="col">From</th>
                  <th scope="col">To</th>
                  <th scope="col" className="lx-r">Value</th>
                </tr>
              </thead>
              <tbody>
                {b.transactions.map((t) => (
                  <tr key={t.hash}>
                    <td><TxLink hash={t.hash} /></td>
                    <td><Method id={t.methodId ?? null} isCreate={!t.to} /></td>
                    <td><AddrLink addr={t.from} /></td>
                    <td><AddrLink addr={t.to} /></td>
                    <td className="lx-r lx-mono">{fmtSalt(t.valueSalt ?? "0")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="lx-muted lx-small">No transactions in this block.</p>
        )}
      </Section>
    </>
  );
}
