/**
 * Read-only harness operations. Each maps to one or more allowlisted RPC calls
 * (see allowlist.ts) and returns JSON-safe shapes (bigints → strings). These are
 * the single source of truth shared by the explorer API routes AND the AI agent's
 * tool-calls (src/lib/ai/tools.ts), so the UI and the model see identical data.
 *
 * Data source (Rule 11): live Citrate RPC via {@link harnessClient}.
 */
import { formatEther, formatGwei, keccak256, parseAbiItem, type Abi, type Address, type Hex } from "viem";
import { harnessClient } from "./client";
import { getDagStats, isFinalized, type DagStats } from "@/lib/citrate/dag";
import { getDagBlock, dagStats as liveDagStats, isFinal } from "@/lib/citrate/rpc";
import { erc20Abi } from "@/lib/citrate/abi";
import { GENESIS_ALLOCATIONS, knownLabel } from "@/lib/citrate/addresses";

/**
 * EX-B-016 (RM-Q, 2026-09-07): clamp an attacker-authorable on-chain string
 * (token `name`/`symbol`, etc.) before it enters the AI agent's context or the
 * UI. On-chain strings are unbounded, attacker-controlled, and a prompt-injection
 * / context-bloat vector. This strips control characters (which can hide or
 * reframe instructions) and truncates to a short bound. Provenance/"this is
 * untrusted data" framing lives in the system prompt GUARDRAILS; this is the
 * length + control-char half of the same defence. Returns null unchanged.
 */
export const MAX_ONCHAIN_STR = 96;
export function clampOnChainText(s: string | null, max: number = MAX_ONCHAIN_STR): string | null {
  if (s === null || s === undefined) return null;
  // Drop C0/C1 control chars (incl. NUL, newlines, escape) — keep printable text.
  const cleaned = String(s).replace(/[\u0000-\u001F\u007F-\u009F]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
}

/** Dual-unit SALT amount (decision X-4): both human SALT and raw grains (wei). */
export interface SaltAmount {
  salt: string;
  grains: string;
}
export function saltAmount(wei: bigint | string): SaltAmount {
  const w = typeof wei === "bigint" ? wei : BigInt(wei);
  return { salt: formatEther(w), grains: w.toString() };
}

export interface ChainStatus {
  chainId: number;
  blockNumber: string;
  gasPriceWei: string;
}

export async function getChainStatus(): Promise<ChainStatus> {
  const c = harnessClient();
  const [chainId, blockNumber, gasPrice] = await Promise.all([
    c.getChainId(),
    c.getBlockNumber(),
    c.getGasPrice(),
  ]);
  return {
    chainId,
    blockNumber: blockNumber.toString(),
    gasPriceWei: gasPrice.toString(),
  };
}

export interface BlockSummary {
  hash: string | null;
  number: string | null;
  timestamp: string;
  parentHash: string;
  miner: string | null;
  gasUsed: string;
  gasLimit: string;
  baseFeePerGas: string | null;
  txCount: number;
}

/** ref: "latest" | a block height (number/bigint) | a 0x block hash. */
export async function getBlock(
  ref: "latest" | number | bigint | Hex = "latest",
): Promise<BlockSummary> {
  const c = harnessClient();
  const block =
    typeof ref === "string" && ref.startsWith("0x")
      ? await c.getBlock({ blockHash: ref as Hex })
      : ref === "latest"
        ? await c.getBlock({ blockTag: "latest" })
        : await c.getBlock({ blockNumber: BigInt(ref) });
  return {
    hash: block.hash,
    number: block.number?.toString() ?? null,
    timestamp: block.timestamp.toString(),
    parentHash: block.parentHash,
    miner: block.miner ?? null,
    gasUsed: block.gasUsed.toString(),
    gasLimit: block.gasLimit.toString(),
    baseFeePerGas: block.baseFeePerGas?.toString() ?? null,
    txCount: block.transactions.length,
  };
}

export interface TxLog {
  address: string;
  topics: readonly string[];
  data: string;
  logIndex: number | null;
}

export interface TransactionDetail {
  hash: string;
  from: string;
  fromLabel: string | null;
  to: string | null;
  toLabel: string | null;
  valueWei: string;
  valueSalt: string;
  nonce: number;
  blockNumber: string | null;
  blockHash: string | null;
  /** EVM tx type: legacy | eip2930 | eip1559 | eip4844 (best-effort). */
  type: string;
  status: "success" | "reverted" | "pending";
  gasUsed: string | null;
  /** Effective gas price actually paid (wei). */
  effectiveGasPriceWei: string | null;
  /** Total fee = gasUsed × effectiveGasPrice, dual-unit. */
  fee: SaltAmount | null;
  contractAddress: string | null;
  /** True when this tx created a contract. */
  isContractCreation: boolean;
  input: string;
  /** Method selector (first 4 bytes of calldata) when it's a contract call. */
  methodId: string | null;
  /** Raw receipt logs — the raw material for forensic/event decoding. */
  logs: TxLog[];
  logCount: number;
}

export async function getTransaction(hash: Hex): Promise<TransactionDetail> {
  const c = harnessClient();
  const tx = await c.getTransaction({ hash });
  let status: TransactionDetail["status"] = "pending";
  let gasUsed: string | null = null;
  let contractAddress: string | null = null;
  let effectiveGasPriceWei: string | null = null;
  let fee: SaltAmount | null = null;
  let logs: TxLog[] = [];
  try {
    const receipt = await c.getTransactionReceipt({ hash });
    status = receipt.status === "success" ? "success" : "reverted";
    gasUsed = receipt.gasUsed.toString();
    contractAddress = receipt.contractAddress ?? null;
    if (receipt.effectiveGasPrice != null) {
      effectiveGasPriceWei = receipt.effectiveGasPrice.toString();
      fee = saltAmount(receipt.gasUsed * receipt.effectiveGasPrice);
    }
    logs = receipt.logs.map((l) => ({
      address: l.address,
      topics: l.topics,
      data: l.data,
      logIndex: l.logIndex ?? null,
    }));
  } catch {
    // No receipt yet → still pending (Rule 11: report honestly, don't fabricate).
  }
  const input = tx.input;
  return {
    hash: tx.hash,
    from: tx.from,
    fromLabel: knownLabel(tx.from),
    to: tx.to,
    toLabel: tx.to ? knownLabel(tx.to) : null,
    valueWei: tx.value.toString(),
    valueSalt: formatEther(tx.value),
    nonce: tx.nonce,
    blockNumber: tx.blockNumber?.toString() ?? null,
    blockHash: tx.blockHash ?? null,
    type: tx.type ?? "legacy",
    status,
    gasUsed,
    effectiveGasPriceWei,
    fee,
    contractAddress,
    isContractCreation: !tx.to,
    input,
    methodId: tx.to && input && input.length >= 10 ? input.slice(0, 10) : null,
    logs,
    logCount: logs.length,
  };
}

export interface AddressInfo {
  address: string;
  balanceWei: string;
  balanceSalt: string;
  nonce: number;
  isContract: boolean;
  codeSize: number;
}

export async function getAddress(address: Address): Promise<AddressInfo> {
  const c = harnessClient();
  const [balance, nonce, code] = await Promise.all([
    c.getBalance({ address }),
    c.getTransactionCount({ address }),
    c.getCode({ address }),
  ]);
  const codeHex = code ?? "0x";
  return {
    address,
    balanceWei: balance.toString(),
    balanceSalt: formatEther(balance),
    nonce,
    isContract: codeHex !== "0x" && codeHex.length > 2,
    codeSize: codeHex === "0x" ? 0 : (codeHex.length - 2) / 2,
  };
}

export async function isContract(address: Address): Promise<boolean> {
  const code = (await harnessClient().getCode({ address })) ?? "0x";
  return code !== "0x" && code.length > 2;
}

export interface LogQuery {
  address?: Address;
  fromBlock?: bigint | "earliest";
  toBlock?: bigint | "latest";
}

export async function getLogs(query: LogQuery = {}) {
  const c = harnessClient();
  const logs = await c.getLogs({
    address: query.address,
    fromBlock: query.fromBlock ?? "earliest",
    toBlock: query.toBlock ?? "latest",
  });
  return logs.map((l) => ({
    address: l.address,
    topics: l.topics,
    data: l.data,
    blockNumber: l.blockNumber?.toString() ?? null,
    txHash: l.transactionHash,
    logIndex: l.logIndex,
  }));
}

/**
 * Decoded read against a contract. Requires a verified ABI fragment — without
 * one we cannot honestly decode (Rule 11), so the caller must pass `abi`.
 */
export async function readContract(params: {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
}): Promise<unknown> {
  const c = harnessClient();
  const result = await c.readContract({
    address: params.address,
    abi: params.abi,
    functionName: params.functionName,
    args: params.args as never,
  });
  return jsonSafe(result);
}

/**
 * Read ANY view/pure function by its human signature (forensic tool). The caller
 * supplies a full Solidity signature so we can decode honestly without a stored
 * ABI, e.g. `"function getModel(bytes32) view returns (address,string,uint256)"`
 * or just `"balanceOf(address)"`. Read-only — non-view functions are rejected by
 * the node on a static call.
 */
export async function callView(
  address: Address,
  signature: string,
  args: readonly unknown[] = [],
): Promise<{ address: string; function: string; result: unknown }> {
  const sig = signature.trim().startsWith("function ") ? signature.trim() : `function ${signature.trim()}`;
  // parseAbiItem's type only accepts literal strings; cast to accept our runtime sig.
  const item = (parseAbiItem as unknown as (s: string) => { name?: string })(sig);
  const fn = item.name;
  if (!fn) throw new Error(`could not parse a function name from "${signature}"`);
  const result = await harnessClient().readContract({
    address,
    abi: [item] as unknown as Abi,
    functionName: fn,
    args: args as never,
  });
  return { address, function: fn, result: jsonSafe(result) };
}

export interface BalanceResult {
  address: string;
  balance: SaltAmount;
}

export async function getBalance(address: Address): Promise<BalanceResult> {
  const wei = await harnessClient().getBalance({ address });
  return { address, balance: saltAmount(wei) };
}

export interface DagView extends DagStats {
  finalityNote: string;
}

/** Convenience: is a block (by blue score) finalized right now? */
export async function checkFinalized(blueScore: number): Promise<boolean> {
  const stats = await getDagStats(harnessClient());
  return isFinalized(blueScore, stats.maxBlueScore, stats.ghostdagParams.finalityDepth);
}

export interface DagWalk {
  block: { hash: string; height: number; blueScore: number };
  /** The selected-parent ancestor chain (the GHOSTDAG spine), newest→oldest. */
  selectedParentChain: string[];
  /** Merge parents of the block (additional DAG edges), never dropped. */
  mergeParents: string[];
  finalized: boolean;
  note: string;
}

/**
 * Walks a block's DAG neighborhood: the selected-parent ancestor chain (the
 * spine) plus its merge parents, and whether it's finalized. This is what makes
 * the DAG legible — merge parents are surfaced, not flattened into a line.
 * Reads live headers (decision X-1: index-first falls through to RPC).
 */
export async function exploreDag(blockHash: Hex, depth = 10): Promise<DagWalk> {
  const head = await getDagBlock(blockHash);
  if (!head) throw new Error(`block ${blockHash} not found`);
  const stats = await liveDagStats();

  const chain: string[] = [];
  let cursor: string | null = head.selectedParent;
  for (let i = 0; i < depth && cursor && cursor !== ZERO_HASH; i++) {
    chain.push(cursor);
    const parent = await getDagBlock(cursor);
    cursor = parent ? parent.selectedParent : null;
  }

  return {
    block: { hash: head.hash, height: head.height, blueScore: head.blueScore },
    selectedParentChain: chain,
    mergeParents: head.mergeParents,
    finalized: isFinal(head.blueScore, stats),
    note:
      `blue_score ${head.blueScore} (height ${head.height}); ${head.mergeParents.length} merge parent(s); ` +
      `${isFinal(head.blueScore, stats) ? "finalized" : "not yet final"} ` +
      `(maxBlueScore ${stats.maxBlueScore}, depth ${stats.maxBlueScore - head.blueScore}/${stats.ghostdagParams.finalityDepth}).`,
  };
}

/** Overview snapshot (no block arg) — tips, blue/red, finality params. */
export async function dagOverview(): Promise<DagView> {
  const stats = await getDagStats(harnessClient());
  const depth = stats.ghostdagParams.finalityDepth;
  return {
    ...stats,
    finalityNote:
      `A block is finalized once maxBlueScore − its blue_score ≥ ${depth}. ` +
      `There are ${stats.tipsCount} current tip(s); blue_score (not height) is the consensus order.`,
  };
}

// ---- contract code -------------------------------------------------------

export interface ContractCode {
  address: string;
  label: string | null;
  isContract: boolean;
  sizeBytes: number;
  /** keccak256 of the deployed bytecode — identifies identical contracts. */
  codeHash: string | null;
  /** The raw bytecode (0x…). Source requires verification (not yet wired). */
  bytecode: string;
  note: string;
}

/** eth_getCode for a contract: size, code hash, and the raw bytecode. */
export async function getContractCode(address: Address): Promise<ContractCode> {
  const code = (await harnessClient().getCode({ address })) ?? "0x";
  const isContract = code !== "0x" && code.length > 2;
  const sizeBytes = isContract ? (code.length - 2) / 2 : 0;
  return {
    address,
    label: knownLabel(address),
    isContract,
    sizeBytes,
    codeHash: isContract ? keccak256(code as Hex) : null,
    bytecode: code,
    note: isContract
      ? `Contract with ${sizeBytes} bytes of bytecode. Source code is only available if the contract is verified (verification UI pending) — read its behavior via readContract/getToken instead.`
      : "Externally-owned account (EOA): no contract code.",
  };
}

// ---- tokens (ERC-20 / ERC-721) ------------------------------------------

export interface TokenInfo {
  address: string;
  label: string | null;
  standard: "erc20" | "erc721" | "unknown";
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupplyRaw: string | null;
  /** totalSupply formatted by decimals (erc20). */
  totalSupply: string | null;
  /** Optional balance of `holder`, formatted + raw. */
  holder?: { address: string; balanceRaw: string; balance: string };
  note: string;
}

/** Read token metadata (auto-detects ERC-20 vs ERC-721) + optional holder balance. */
export async function getToken(address: Address, holder?: Address): Promise<TokenInfo> {
  const c = harnessClient();
  const tryRead = async <T>(abi: Abi, fn: string, args?: readonly unknown[]): Promise<T | null> => {
    try {
      return (await c.readContract({ address, abi, functionName: fn, args: args as never })) as T;
    } catch {
      return null;
    }
  };
  const [rawName, rawSymbol] = await Promise.all([
    tryRead<string>(erc20Abi as Abi, "name"),
    tryRead<string>(erc20Abi as Abi, "symbol"),
  ]);
  // EX-B-016: token name/symbol are attacker-authored on-chain strings that flow
  // into the AI agent's context and the UI — clamp length + strip control chars
  // before they leave the harness (prompt-injection / context-bloat defence).
  const name = clampOnChainText(rawName);
  const symbol = clampOnChainText(rawSymbol);
  const decimals = await tryRead<number>(erc20Abi as Abi, "decimals");
  // ERC-20 exposes decimals(); ERC-721 doesn't but is still name/symbol-bearing.
  const standard: TokenInfo["standard"] =
    decimals !== null ? "erc20" : name || symbol ? "erc721" : "unknown";

  const totalSupplyRaw = await tryRead<bigint>(erc20Abi as Abi, "totalSupply");
  const dec = decimals ?? 18;
  let holderInfo: TokenInfo["holder"];
  if (holder) {
    const bal = await tryRead<bigint>(erc20Abi as Abi, "balanceOf", [holder]);
    if (bal !== null) {
      holderInfo = { address: holder, balanceRaw: bal.toString(), balance: formatUnits(bal, dec) };
    }
  }
  return {
    address,
    label: knownLabel(address),
    standard,
    name: name ?? null,
    symbol: symbol ?? null,
    decimals: decimals ?? null,
    totalSupplyRaw: totalSupplyRaw?.toString() ?? null,
    totalSupply: totalSupplyRaw !== null ? formatUnits(totalSupplyRaw, dec) : null,
    holder: holderInfo,
    note:
      standard === "unknown"
        ? "Could not read standard token metadata — may not be a token, or uses a non-standard ABI."
        : `Detected ${standard.toUpperCase()}${symbol ? ` (${symbol})` : ""}. Note: SALT itself is the NATIVE coin, not a token contract — use getBalance/saltDistribution for SALT.`,
  };
}

function formatUnits(v: bigint, decimals: number): string {
  if (decimals === 18) return formatEther(v);
  const neg = v < 0n;
  const s = (neg ? -v : v).toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

// ---- gas / cost ----------------------------------------------------------

export interface GasOracle {
  gasPriceWei: string;
  gasPriceGwei: string;
  /** Cost of a few reference operations at the current price, dual-unit. */
  estimates: { label: string; gas: number; cost: SaltAmount }[];
  note: string;
}

/** Current gas price + reference cost estimates (native SALT transfer, ERC-20, etc.). */
export async function getGasOracle(): Promise<GasOracle> {
  const gasPrice = await harnessClient().getGasPrice();
  const refs: { label: string; gas: number }[] = [
    { label: "Native SALT transfer", gas: 21000 },
    { label: "ERC-20 transfer", gas: 65000 },
    { label: "Typical contract call", gas: 120000 },
    { label: "Contract deployment", gas: 1500000 },
  ];
  return {
    gasPriceWei: gasPrice.toString(),
    gasPriceGwei: formatGwei(gasPrice),
    estimates: refs.map((r) => ({ ...r, cost: saltAmount(gasPrice * BigInt(r.gas)) })),
    note: "Citrate prices gas in grains (wei). Most user writes are gasless via the EIP-2771 forwarder — these are reference costs for direct sends.",
  };
}

// ---- live address activity (forensic, index-free) -----------------------

export interface LiveActivityTx {
  hash: string;
  from: string;
  to: string | null;
  valueSalt: string;
  blockNumber: number;
  direction: "out" | "in";
  counterparty: string | null;
  counterpartyLabel: string | null;
}

export interface LiveActivity {
  address: string;
  label: string | null;
  scannedBlocks: number;
  fromBlock: number;
  toBlock: number;
  sent: number;
  received: number;
  txs: LiveActivityTx[];
  truncated: boolean;
  note: string;
}

/**
 * Best-effort forensic activity for an address WITHOUT the indexer: scan the last
 * `blocks` blocks of live RPC for transactions where the address is sender or
 * recipient. Honest about its window — it does NOT see older history or internal
 * (contract-to-contract) transfers; for full history the indexer is required.
 */
export async function addressActivityLive(
  address: Address,
  blocks = 60,
  max = 40,
): Promise<LiveActivity> {
  const a = address.toLowerCase();
  const head = Number(await harnessClient().getBlockNumber());
  const fromBlock = Math.max(0, head - blocks + 1);
  const heights: number[] = [];
  for (let h = head; h >= fromBlock; h--) heights.push(h);

  const fetched = await Promise.all(heights.map((h) => getDagBlock(h)));
  const txs: LiveActivityTx[] = [];
  let sent = 0;
  let received = 0;
  let truncated = false;
  for (const b of fetched) {
    if (!b) continue;
    for (const t of b.raw.transactions ?? []) {
      const tf = (t.from ?? "").toLowerCase();
      const tt = (t.to ?? "").toLowerCase();
      if (tf !== a && tt !== a) continue;
      if (txs.length >= max) {
        truncated = true;
        break;
      }
      const direction: "out" | "in" = tf === a ? "out" : "in";
      if (direction === "out") sent += 1;
      else received += 1;
      const counterparty = direction === "out" ? (t.to ?? null) : t.from;
      txs.push({
        hash: t.hash,
        from: t.from,
        to: t.to ?? null,
        valueSalt: formatEther(t.value ? BigInt(t.value) : 0n),
        blockNumber: b.height,
        direction,
        counterparty,
        counterpartyLabel: counterparty ? knownLabel(counterparty) : null,
      });
    }
    if (truncated) break;
  }
  return {
    address,
    label: knownLabel(address),
    scannedBlocks: head - fromBlock + 1,
    fromBlock,
    toBlock: head,
    sent,
    received,
    txs,
    truncated,
    note:
      `Scanned the last ${head - fromBlock + 1} block(s) (#${fromBlock}–#${head}) of live RPC. ` +
      `Found ${txs.length} tx(s) directly involving this address` +
      `${truncated ? ` (capped at ${max})` : ""}. This is a recent-window view only — internal ` +
      `(contract-to-contract) transfers and older history need the indexer.`,
  };
}

// ---- native SALT distribution -------------------------------------------

export interface SaltDistribution {
  nativeToken: { symbol: "SALT"; decimals: 18; note: string };
  /** Known genesis holders with their LIVE balances, biggest first. */
  knownHolders: { address: string; label: string; genesisSalt: string; balance: SaltAmount }[];
  note: string;
}

/**
 * The honest answer to "who holds the most SALT": SALT is native (no Transfer
 * events to index), so a full leaderboard of every address needs a balance
 * indexer. We CAN read the known genesis allocations' live balances.
 */
export async function saltDistribution(): Promise<SaltDistribution> {
  const c = harnessClient();
  const balances = await Promise.all(
    GENESIS_ALLOCATIONS.map((g) => c.getBalance({ address: g.address })),
  );
  const knownHolders = GENESIS_ALLOCATIONS.map((g, i) => ({
    address: g.address,
    label: g.label,
    genesisSalt: g.genesisSalt,
    balance: saltAmount(balances[i]),
  })).sort((a, b) => (BigInt(b.balance.grains) > BigInt(a.balance.grains) ? 1 : -1));
  return {
    nativeToken: {
      symbol: "SALT",
      decimals: 18,
      note: "SALT is the NATIVE coin (wei are 'grains'), not an ERC-20 contract.",
    },
    knownHolders,
    note:
      "These are the known GENESIS allocations with live balances. A complete ranking of all addresses isn't available from RPC alone (native balances have no Transfer events) — it needs a balance indexer. Use getBalance to check any specific address.",
  };
}

const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";

/** Recursively convert bigints to strings so results are JSON-serializable. */
function jsonSafe(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, jsonSafe(val)]),
    );
  }
  return v;
}
