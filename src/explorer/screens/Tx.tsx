"use client";

/** Transaction record (direction B): where it was included and which chain block accepted it. */
import { useTx } from "../api";
import { finalityOf, inclusionView } from "../model";
import { fmtNum, fmtSalt, isoTime, shortHash } from "../format";
import { AddrLink, BlockLink, ColorChip, Copy, Failure, FinChip, KV, row, Loading, PageHead, Pill, Section, TxStatus } from "../ui";

export function Tx({ hash }: { hash: string }) {
  const { data: t, error } = useTx(hash);
  if (!t) return <><PageHead eyebrow="Transaction" title="Transaction" sub={shortHash(hash, 18, 10)} />{error ? <Failure what="this transaction" error={error} /> : <Loading what="the transaction" />}</>;
  const r = t.r1007;
  const v = inclusionView({ blockHash: t.blockHash, blockNumber: t.blockNumber }, r?.acceptance ?? null, !!r?.capabilities.acceptingBlock);
  const fin = r?.finality ?? null;
  const finH = v.accepted?.height ?? v.included.height;
  const finState = finH != null ? finalityOf(finH, fin) : "unknown";
  const red = v.included.color === "red";

  return (
    <>
      <PageHead eyebrow="Transaction" title="Transaction" sub={shortHash(t.hash, 18, 10)} />
      <div className="lx-srow">
        <TxStatus status={t.status} />
        {v.state === "accepted" ? <Pill tone="settled">Accepted</Pill> : v.state === "pending" ? <Pill tone="pending">Awaiting acceptance</Pill> : null}
        {red ? <Pill tone="blocked">Red block</Pill> : null}
        <FinChip state={finState} checkpoint={fin?.finalized?.height} pct={fin?.pending[0]?.quorumPct} />
      </div>

      <Section
        title="Where it executed"
        source={v.state === "unsupported" ? "eth_getTransactionReceipt blockHash and blockNumber" : "citrate_getAcceptingBlock (accepting block and inclusions, spec 06 §5.4)"}
      >
        <div className="lx-flow">
          <div className="lx-flow-s">
            <span className="lx-flow-k">Included in</span>
            <span className="lx-flow-v">
              {v.included.hash ? <BlockLink hash={v.included.hash} height={v.included.height} /> : <span className="lx-muted">not in a block yet</span>}
              {v.included.hash ? <ColorChip color={v.included.color} sm /> : null}
            </span>
          </div>
          <span className="lx-flow-a" aria-hidden="true">→</span>
          <div className="lx-flow-s">
            <span className="lx-flow-k">Accepted by chain block</span>
            <span className="lx-flow-v">
              {v.accepted ? (
                <>
                  <BlockLink hash={v.accepted.hash} height={v.accepted.height} />
                  <ColorChip color="chain" sm />
                </>
              ) : v.state === "pending" ? (
                <span className="lx-muted">pending: waits for the next selected-chain block to merge it</span>
              ) : (
                <span className="lx-muted">available after the r1007 upgrade</span>
              )}
            </span>
          </div>
        </div>
        {v.state === "unsupported" ? (
          <p className="lx-note">
            This node does not serve <span className="lx-mono">citrate_getAcceptingBlock</span> yet. The block above is the one the receipt names. Under r1007 a transaction is included in one DAG block and executed by the chain block that accepts it, and this page will show both.
          </p>
        ) : null}
        {red ? <p className="lx-note warn">This transaction sits in a red block. Whether red-block transactions execute is set by the mergeset execution rules (CV-4a); the accepting block above is what the node reports.</p> : null}
        {v.duplicates.length ? (
          <p className="lx-note">
            The same signed transaction was also included in {v.duplicates.map((d, i) => <span key={d.hash}>{i ? ", " : ""}<BlockLink hash={d.hash} height={d.height} /> ({d.outcome.replace("skipped:", "skipped, ")})</span>)}. It executed once.
          </p>
        ) : null}
      </Section>

      <Section title="Overview" source="eth_getTransactionByHash and eth_getTransactionReceipt">
        <KV
          rows={[
            row("Tx hash", <><span className="lx-mono lx-brk">{t.hash}</span><Copy text={t.hash} /></>),
            row("Status", <TxStatus key="s" status={t.status} />),
            row("From", <AddrLink addr={t.from} />),
            row("To", t.to ? <AddrLink addr={t.to} /> : t.contractAddress ? <>Created <AddrLink addr={t.contractAddress} /></> : <span className="lx-muted">contract creation</span>),
            row("Value", <span className="lx-mono">{fmtSalt(t.valueSalt)}</span>),
            row("Gas used", <span className="lx-mono">{t.gasUsed ? fmtNum(Number(t.gasUsed)) : "n/a"}</span>),
            t.fee ? row("Fee", <span className="lx-mono">{fmtSalt(t.fee.salt)}</span>) : null,
            row("Nonce", <span className="lx-mono">{t.nonce}</span>),
            t.timestamp ? row("Timestamp", <span className="lx-mono">{isoTime(t.timestamp)}</span>) : null,
            t.methodId ? row("Method", <span className="lx-mono">{t.methodId}</span>, "first 4 bytes of the input") : null,
            row("Input data", <pre className="lx-mono lx-small lx-brk" style={{ margin: 0, whiteSpace: "pre-wrap", maxHeight: "var(--s-13)", overflow: "auto" }}>{t.input.length > 400 ? `${t.input.slice(0, 400)}…` : t.input}</pre>),
          ]}
        />
      </Section>

      <Section title={`Logs · ${t.logs.length}`} source="eth_getTransactionReceipt logs (decoded names come with verified ABIs, EXP-S3)">
        {t.logs.length ? (
          t.logs.map((l, i) => (
            <div key={i} className="lx-log">
              <div className="lx-small">Emitted by <AddrLink addr={l.address} /> <span className="lx-muted">log {l.logIndex ?? i}</span></div>
              {l.topics.map((tp, k) => <div key={k} className="lx-mono lx-small lx-brk lx-muted">topic{k} {tp}</div>)}
              {l.data && l.data !== "0x" ? <div className="lx-mono lx-small lx-brk">data {l.data.length > 200 ? `${l.data.slice(0, 200)}…` : l.data}</div> : null}
            </div>
          ))
        ) : (
          <p className="lx-muted lx-small">No logs.</p>
        )}
      </Section>
    </>
  );
}
