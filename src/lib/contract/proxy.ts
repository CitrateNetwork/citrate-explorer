/**
 * Proxy detection (EXP-S3): EIP-1167 minimal proxies from the code pattern, and
 * EIP-1967 (implementation and beacon slots) and EIP-1822 (UUPS PROXIABLE slot)
 * from storage. Implementation history comes from `Upgraded` / `BeaconUpgraded`
 * events, read in node-sized pages.
 *
 * Data source (Rule 7): eth_getCode, eth_getStorageAt, eth_call (beacon
 * `implementation()`), eth_getLogs on the Citrate RPC via a ChainReader.
 */
import { getAddress, type Address, type Hex } from "viem";
import type { ChainReader } from "./types";

/** bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1) */
export const EIP1967_IMPLEMENTATION_SLOT: Hex = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
/** bytes32(uint256(keccak256("eip1967.proxy.beacon")) - 1) */
export const EIP1967_BEACON_SLOT: Hex = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";
/** bytes32(uint256(keccak256("eip1967.proxy.admin")) - 1) */
export const EIP1967_ADMIN_SLOT: Hex = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";
/** keccak256("PROXIABLE") (EIP-1822) */
export const EIP1822_PROXIABLE_SLOT: Hex = "0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7";
/** topic0 of Upgraded(address indexed implementation) */
export const UPGRADED_TOPIC: Hex = "0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b";
/** topic0 of BeaconUpgraded(address indexed beacon) */
export const BEACON_UPGRADED_TOPIC: Hex = "0x1cf3b03a6cf19fa2baba4df148e9dcabedea7f8a5c07840e207e5c089be95d3e";
/** implementation() */
const IMPLEMENTATION_SELECTOR: Hex = "0x5c60da1b";

/** The node's eth_getLogs span cap on 40204. */
export const LOG_PAGE_SPAN = 1000n;

export type ProxyKind = "eip1167" | "eip1967" | "eip1967-beacon" | "eip1822";

export interface ProxyInfo {
  kind: ProxyKind;
  implementation: Address;
  /** The storage slot the implementation (or beacon) was read from; null for EIP-1167. */
  slot: Hex | null;
  admin: Address | null;
  beacon: Address | null;
}

const MINIMAL_PROXY_PATTERNS: Array<[RegExp, string]> = [
  // EIP-1167 standard clone
  [/^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/, "eip1167"],
  // ERC-7511 (PUSH0) clone
  [/^0x365f5f375f5f365f73([0-9a-f]{40})5af43d5f5f3e5f3d91602a57fd5bf3$/, "eip1167"],
];

/** The implementation of an EIP-1167 minimal proxy, or null if the code is not one. */
export function parseMinimalProxy(code: string): Address | null {
  const c = code.toLowerCase();
  for (const [re] of MINIMAL_PROXY_PATTERNS) {
    const m = re.exec(c);
    if (m) return getAddress("0x" + m[1]);
  }
  return null;
}

/** The address in the low 20 bytes of a storage word, or null for zero / non-address words. */
export function wordToAddress(word: Hex | null | undefined): Address | null {
  if (!word || !/^0x[0-9a-fA-F]{1,64}$/.test(word)) return null;
  const hex = word.slice(2).padStart(64, "0");
  if (!/^0{24}/.test(hex)) return null;
  const a = hex.slice(24);
  if (/^0+$/.test(a)) return null;
  return getAddress("0x" + a);
}

async function hasCode(reader: ChainReader, a: Address): Promise<boolean> {
  const code = await reader.getCode(a);
  return !!code && code !== "0x";
}

/** Detect a proxy at `address`. Null when it is not one (or the target has no code). */
export async function detectProxy(reader: ChainReader, address: string): Promise<ProxyInfo | null> {
  const a = getAddress(address);
  const code = await reader.getCode(a);
  if (!code || code === "0x") return null;

  const minimal = parseMinimalProxy(code);
  if (minimal) return (await hasCode(reader, minimal)) ? { kind: "eip1167", implementation: minimal, slot: null, admin: null, beacon: null } : null;

  const [implWord, beaconWord, uupsWord, adminWord] = await Promise.all([
    reader.getStorageAt(a, EIP1967_IMPLEMENTATION_SLOT),
    reader.getStorageAt(a, EIP1967_BEACON_SLOT),
    reader.getStorageAt(a, EIP1822_PROXIABLE_SLOT),
    reader.getStorageAt(a, EIP1967_ADMIN_SLOT),
  ]);
  const admin = wordToAddress(adminWord);

  const impl = wordToAddress(implWord);
  if (impl && (await hasCode(reader, impl))) {
    return { kind: "eip1967", implementation: impl, slot: EIP1967_IMPLEMENTATION_SLOT, admin, beacon: null };
  }
  const beacon = wordToAddress(beaconWord);
  if (beacon && (await hasCode(reader, beacon))) {
    try {
      const ret = await reader.call({ to: beacon, data: IMPLEMENTATION_SELECTOR });
      const bi = wordToAddress(ret.slice(0, 66) as Hex);
      if (bi && (await hasCode(reader, bi))) {
        return { kind: "eip1967-beacon", implementation: bi, slot: EIP1967_BEACON_SLOT, admin, beacon };
      }
    } catch {
      /* the beacon does not answer implementation(); not a usable beacon proxy */
    }
  }
  const uups = wordToAddress(uupsWord);
  if (uups && (await hasCode(reader, uups))) {
    return { kind: "eip1822", implementation: uups, slot: EIP1822_PROXIABLE_SLOT, admin, beacon: null };
  }
  return null;
}

/** Inclusive [from, to] ranges of at most `span` blocks, newest first. */
export function pageRanges(fromBlock: bigint, toBlock: bigint, span: bigint = LOG_PAGE_SPAN): Array<[bigint, bigint]> {
  const out: Array<[bigint, bigint]> = [];
  for (let hi = toBlock; hi >= fromBlock; hi -= span) {
    const lo = hi - span + 1n > fromBlock ? hi - span + 1n : fromBlock;
    out.push([lo, hi]);
    if (lo === fromBlock) break;
  }
  return out;
}

export interface ImplementationChange {
  event: "Upgraded" | "BeaconUpgraded";
  /** The new implementation (or beacon, for BeaconUpgraded). */
  implementation: Address;
  blockNumber: bigint | null;
  transactionHash: Hex | null;
}

/**
 * Upgrade history from events in [fromBlock, toBlock], newest first. Ranges are
 * paged to the node's cap; `scanned` says exactly which blocks were read, since a
 * full-chain scan is the indexer's job (contract_proxies, logs table).
 */
export async function implementationHistory(
  reader: ChainReader,
  address: string,
  range: { fromBlock: bigint; toBlock: bigint },
): Promise<{ entries: ImplementationChange[]; scanned: { fromBlock: bigint; toBlock: bigint } }> {
  const a = getAddress(address);
  const entries: ImplementationChange[] = [];
  for (const [lo, hi] of pageRanges(range.fromBlock, range.toBlock)) {
    const logs = await reader.getLogs({ address: a, fromBlock: lo, toBlock: hi, topics: [[UPGRADED_TOPIC, BEACON_UPGRADED_TOPIC]] });
    const page: ImplementationChange[] = [];
    for (const l of logs) {
      const t0 = l.topics[0]?.toLowerCase();
      const ev = t0 === UPGRADED_TOPIC ? "Upgraded" : t0 === BEACON_UPGRADED_TOPIC ? "BeaconUpgraded" : null;
      const impl = ev ? wordToAddress(l.topics[1]) : null;
      if (ev && impl) page.push({ event: ev, implementation: impl, blockNumber: l.blockNumber, transactionHash: l.transactionHash });
    }
    page.sort((x, y) => Number((y.blockNumber ?? 0n) - (x.blockNumber ?? 0n)));
    entries.push(...page);
  }
  return { entries, scanned: { fromBlock: range.fromBlock, toBlock: range.toBlock } };
}
