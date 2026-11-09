"use client";

/** Address record (direction B): live balance and code, indexed history, blocks produced in the live window. */
import { formatEther } from "viem";
import { useAddress, useLedger } from "../api";
import { colorBlocks, deriveSelectedChain } from "../model";
import { fmtAge, fmtNum, fmtSalt, shortHash } from "../format";
import { AddrLink, BlockLink, ColorChip, Copy, Failure, Fig, KV, row, Loading, Method, PageHead, Pill, Section, TxLink, href } from "../ui";

export function Address({ addr }: { addr: string }) {
  const { data: a, error } = useAddress(addr);
  const { data: snap } = useLedger(60);
  if (!a) return <><PageHead eyebrow="Address" title="Address" sub={shortHash(addr, 12, 10)} />{error ? <Failure what="this address" error={error} /> : <Loading what="the address" />}</>;

  const txs = a.recentTransactions.provisioned ? a.recentTransactions.results : null;
  const act = a.activity.provisioned ? a.activity : null;
  const tts = a.tokenTransfers.provisioned ? a.tokenTransfers.results : null;
  const lower = addr.toLowerCase();
  const produced = snap ? snap.blocks.filter((b) => b.miner?.toLowerCase() === lower) : [];
  const colors = snap ? colorBlocks(snap.blocks, deriveSelectedChain(snap.blocks, snap.dag?.tips ?? []), snap.ghostdag) : {};
  const notIndexed = "The index is not provisioned on this deployment, so history is not listed. Balance and code are read live.";

  return (
    <>
      <PageHead eyebrow="Address" title={a.isContract ? "Contract account" : produced.length ? "Producer account" : "Account"} sub={shortHash(addr, 12, 10)} />
      <div className="lx-srow">
        <Pill tone="draft">{a.isContract ? "Contract" : "Account"}</Pill>
        {produced.length ? <Pill tone="notice">Producer</Pill> : null}
      </div>
      {a.isContract ? (
        <div className="lx-banner">
          This address holds {fmtNum(a.codeSize)} bytes of code. <a className="lx-link" href={href("contract", addr)}>Open the contract record</a> for source, read and write.
        </div>
      ) : null}

      <div className="lx-figs">
        <Fig label="Balance" value={fmtSalt(a.balanceSalt).replace(" SALT", "")} unit="SALT" sub="eth_getBalance, latest" compact />
        <Fig label="Nonce" value={fmtNum(a.nonce)} sub="eth_getTransactionCount" />
        {act ? (
          <Fig label="Indexed activity" value={fmtNum(act.sent + act.received + act.tokenSent + act.tokenReceived)} sub={`${act.sent} sent · ${act.received} received · ${act.tokenSent + act.tokenReceived} token transfers`} />
        ) : (
          <Fig label="Indexed activity" na="Index not provisioned" sub="indexer tables" />
        )}
        {snap ? (
          <Fig label="Blocks produced" value={fmtNum(produced.length)} sub={`in the newest ${snap.window.toHeight - snap.window.fromHeight + 1} heights`} />
        ) : (
          <Fig label="Blocks produced" na="Reading the live window…" sub="header miner, /api/ledger" />
        )}
      </div>

      <Section title="Overview" source="eth_getBalance, eth_getTransactionCount, eth_getCode">
        <KV
          rows={[
            row("Address", <><span className="lx-mono lx-brk">{addr}</span><Copy text={addr} /></>),
            row("Code", a.isContract ? <span className="lx-mono">{fmtNum(a.codeSize)} bytes</span> : <span className="lx-muted">none</span>),
          ]}
        />
      </Section>

      {produced.length ? (
        <Section title="Recent blocks produced" source="header miner, /api/ledger window">
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--s-2) var(--s-4)", paddingTop: "var(--s-2)" }}>
            {produced.slice(0, 16).map((b) => (
              <span key={b.hash} style={{ display: "inline-flex", gap: "var(--s-2)", alignItems: "center" }}>
                <BlockLink hash={b.hash} height={b.height} /> <ColorChip color={colors[b.hash] ?? "unknown"} sm />
              </span>
            ))}
          </div>
        </Section>
      ) : null}

      <Section title="Transactions" source="indexer transactions table (newest 25)">
        {txs ? (
          <div className="lx-tbl-wrap">
            <table className="lx-tbl">
              <thead>
                <tr>
                  <th scope="col">Tx hash</th>
                  <th scope="col">Method</th>
                  <th scope="col">From</th>
                  <th scope="col">To</th>
                  <th scope="col" className="lx-r">Value</th>
                  <th scope="col">Block</th>
                  <th scope="col">Age</th>
                </tr>
              </thead>
              <tbody>
                {txs.length ? (
                  txs.map((t) => (
                    <tr key={t.hash}>
                      <td><TxLink hash={t.hash} /></td>
                      <td><Method id={t.methodId} isCreate={!t.to} /></td>
                      <td>{t.from.toLowerCase() === lower ? <span className="lx-mono">this address</span> : <AddrLink addr={t.from} />}</td>
                      <td>{t.to && t.to.toLowerCase() === lower ? <span className="lx-mono">this address</span> : <AddrLink addr={t.to} />}</td>
                      <td className="lx-r lx-mono">{fmtSalt(formatEther(BigInt(t.value || "0")))}</td>
                      <td>{t.blockHash ? <BlockLink hash={t.blockHash} height={t.blockHeight} /> : <span className="lx-muted">pending</span>}</td>
                      <td className="lx-muted">{t.timestamp ? fmtAge(t.timestamp) : ""}</td>
                    </tr>
                  ))
                ) : (
                  <tr className="lx-empty"><td colSpan={7}>No transactions indexed for this address.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="lx-muted lx-small">{notIndexed}</p>
        )}
      </Section>

      <Section title="Token transfers" source="indexer token_transfers table (newest 25)">
        {tts ? (
          tts.length ? (
            <div className="lx-tbl-wrap">
              <table className="lx-tbl">
                <thead>
                  <tr>
                    <th scope="col">Tx hash</th>
                    <th scope="col">Standard</th>
                    <th scope="col">Token</th>
                    <th scope="col">From</th>
                    <th scope="col">To</th>
                    <th scope="col" className="lx-r">Amount or id</th>
                  </tr>
                </thead>
                <tbody>
                  {tts.map((t, i) => (
                    <tr key={t.txHash + i}>
                      <td><TxLink hash={t.txHash} /></td>
                      <td className="lx-mono">{t.standard.toUpperCase()}</td>
                      <td><AddrLink addr={t.token} /></td>
                      <td><AddrLink addr={t.from} /></td>
                      <td><AddrLink addr={t.to} /></td>
                      <td className="lx-r lx-mono">{t.tokenId ?? t.value ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="lx-muted lx-small">No token transfers indexed for this address.</p>
          )
        ) : (
          <p className="lx-muted lx-small">{notIndexed}</p>
        )}
      </Section>
    </>
  );
}
