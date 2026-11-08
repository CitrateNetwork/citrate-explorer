/**
 * Per-entity r1007 reads and the per-instance capability cache.
 *
 * Data source (Rule 7): live Citrate JSON-RPC, each method only when
 * `probeR1007Capabilities` found it.
 */
import {
  R1007_METHODS,
  parseAcceptingBlock,
  parseBlocksAtHeight,
  parseFinalityStatus,
  parseGhostdagData,
  type AcceptingBlock,
  type FinalityStatus,
  type GhostdagData,
  type R1007Capabilities,
  type Requester,
} from "./r1007";

const hex = (n: number) => `0x${n.toString(16)}`;

export interface BlockR1007 {
  capabilities: R1007Capabilities;
  ghostdag: GhostdagData | null;
  /** Other blocks at the same height; null when not served. */
  siblings: string[] | null;
  finality: FinalityStatus | null;
}

export async function blockR1007(req: Requester, caps: R1007Capabilities, hash: string, height: number): Promise<BlockR1007> {
  const [ghostdag, siblings, finality] = await Promise.all([
    caps.ghostdagData ? req(R1007_METHODS.ghostdagData, [hash]).then((r) => parseGhostdagData(r, hash)).catch(() => null) : null,
    caps.blocksAtHeight
      ? req(R1007_METHODS.blocksAtHeight, [hex(height)]).then((r) => parseBlocksAtHeight(r).filter((h) => h !== hash)).catch(() => null)
      : null,
    caps.finalityStatus ? req(R1007_METHODS.finalityStatus, []).then(parseFinalityStatus).catch(() => null) : null,
  ]);
  return { capabilities: caps, ghostdag, siblings, finality };
}

export interface TxR1007 {
  capabilities: R1007Capabilities;
  acceptance: AcceptingBlock | null;
  finality: FinalityStatus | null;
}

export async function txR1007(req: Requester, caps: R1007Capabilities, txHash: string): Promise<TxR1007> {
  const [acceptance, finality] = await Promise.all([
    caps.acceptingBlock ? req(R1007_METHODS.acceptingBlock, [txHash]).then(parseAcceptingBlock).catch(() => null) : null,
    caps.finalityStatus ? req(R1007_METHODS.finalityStatus, []).then(parseFinalityStatus).catch(() => null) : null,
  ]);
  return { capabilities: caps, acceptance, finality };
}

/** Single-flight, TTL-cached capability probe (a failed probe is not cached). */
export function makeCapabilityCache(
  probe: () => Promise<R1007Capabilities>,
  { ttlMs, now = Date.now }: { ttlMs: number; now?: () => number },
): () => Promise<R1007Capabilities> {
  let value: R1007Capabilities | undefined;
  let at = 0;
  let inFlight: Promise<R1007Capabilities> | undefined;
  return () => {
    if (value && now() - at < ttlMs) return Promise.resolve(value);
    if (inFlight) return inFlight;
    inFlight = probe()
      .then((v) => {
        value = v;
        at = now();
        return v;
      })
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  };
}
