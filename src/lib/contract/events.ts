/**
 * Event decoding for the Events tab (EXP-S3): the verified ABI first, then the
 * bundled signature subset; an unknown topic stays undecoded. Logs are read from
 * the Citrate RPC in node-sized pages, newest first.
 *
 * Data source (Rule 7): eth_getLogs via a ChainReader.
 */
import { decodeEventLog, getAddress, toEventSelector, type Abi, type AbiEvent, type Hex } from "viem";
import { formatValue } from "./abiForm";
import { pageRanges, LOG_PAGE_SPAN } from "./proxy";
import { canonicalSignature, lookupEvent } from "./signatures";
import type { ChainReader, RawLog } from "./types";

export interface DecodedArg {
  name: string;
  type: string;
  indexed: boolean;
  value: unknown;
  display: string;
}

export interface DecodedLog {
  log: RawLog;
  name: string | null;
  signature: string | null;
  source: "abi" | "signature-subset" | null;
  args: DecodedArg[];
}

function tryDecode(ev: AbiEvent, log: RawLog): DecodedArg[] | null {
  const indexedCount = ev.inputs.filter((i) => i.indexed).length;
  if (indexedCount !== log.topics.length - 1) return null;
  try {
    const d = decodeEventLog({ abi: [ev], topics: log.topics as [Hex, ...Hex[]], data: log.data, strict: true });
    const args = d.args as unknown as Record<string, unknown> | unknown[];
    return ev.inputs.map((p, i) => {
      const value = Array.isArray(args) ? args[i] : args[p.name ?? String(i)];
      return { name: p.name ?? `arg${i}`, type: p.type, indexed: !!p.indexed, value, display: formatValue(p, value) };
    });
  } catch {
    return null;
  }
}

export function decodeLog(log: RawLog, abi: Abi | null): DecodedLog {
  const t0 = log.topics[0]?.toLowerCase();
  if (!t0) return { log, name: null, signature: null, source: null, args: [] };
  const fromAbi = (abi ?? []).filter((x): x is AbiEvent => x.type === "event" && !x.anonymous && toEventSelector(canonicalSignature(x)) === t0);
  for (const ev of fromAbi) {
    const args = tryDecode(ev, log);
    if (args) return { log, name: ev.name, signature: canonicalSignature(ev), source: "abi", args };
  }
  for (const ev of lookupEvent(t0)) {
    const args = tryDecode(ev, log);
    if (args) return { log, name: ev.name, signature: canonicalSignature(ev), source: "signature-subset", args };
  }
  return { log, name: null, signature: null, source: null, args: [] };
}

/**
 * Logs emitted by `address` in the newest `pages` node-sized pages ending at
 * `before - 1` (or the head). `more` is false once block 0 has been scanned.
 */
export async function recentLogs(
  reader: ChainReader,
  address: string,
  opts: { pages?: number; before?: bigint } = {},
): Promise<{ logs: RawLog[]; scanned: { fromBlock: bigint; toBlock: bigint }; more: boolean }> {
  const pages = BigInt(Math.max(1, opts.pages ?? 5));
  const toBlock = opts.before !== undefined ? opts.before - 1n : await reader.blockNumber();
  if (toBlock < 0n) return { logs: [], scanned: { fromBlock: 0n, toBlock: -1n }, more: false };
  const lowest = toBlock - pages * LOG_PAGE_SPAN + 1n;
  const fromBlock = lowest > 0n ? lowest : 0n;
  const a = getAddress(address);
  const logs: RawLog[] = [];
  for (const [lo, hi] of pageRanges(fromBlock, toBlock)) {
    const page = await reader.getLogs({ address: a, fromBlock: lo, toBlock: hi });
    page.sort((x, y) => Number((y.blockNumber ?? 0n) - (x.blockNumber ?? 0n)) || (y.logIndex ?? 0) - (x.logIndex ?? 0));
    logs.push(...page);
  }
  return { logs, scanned: { fromBlock, toBlock }, more: fromBlock > 0n };
}
