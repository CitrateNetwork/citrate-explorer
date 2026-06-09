/**
 * Ground-truth generators for the agent eval harness (RA-1 WP-1.3).
 *
 * Each generator computes a golden item's expected answer from the LIVE chain
 * (Rule 11 — truth is read, never hand-typed) and returns a normalized TruthValue
 * the accuracy scorer consumes. Values are pinned to the block height they were
 * computed at so a run is reproducible/explainable.
 *
 * Generators for capabilities not yet built (findTransfers, topHolders, …) return
 * `unsupported` so the runner reports those golden items as "not yet supported"
 * instead of failing the baseline.
 */
import { formatUnits, type Address, type Hex } from "viem";
import { harnessClient } from "@/lib/harness/client";
import { dagOverview, getToken } from "@/lib/harness/ops";

export type TruthValue =
  | { kind: "number"; number: number; unit?: string; pinnedAtBlock?: number }
  | { kind: "strings"; values: string[]; pinnedAtBlock?: number }
  | { kind: "address"; values: string[]; pinnedAtBlock?: number }
  | { kind: "indeterminate"; reason: string }
  | { kind: "unsupported"; reason: string };

type Params = Record<string, unknown>;
type Generator = (params: Params) => Promise<TruthValue>;

function reqAddress(params: Params, field = "address"): Address {
  const v = params[field];
  if (typeof v !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(v)) {
    throw new Error(`generator: param "${field}" must be a 0x address`);
  }
  return v as Address;
}

async function tip(): Promise<number> {
  return Number(await harnessClient().getBlockNumber());
}

const GENERATORS: Record<string, Generator> = {
  async latestBlock() {
    const n = await tip();
    return { kind: "number", number: n, unit: "block", pinnedAtBlock: n };
  },

  async gasPriceGwei() {
    const c = harnessClient();
    const [wei, pinnedAtBlock] = await Promise.all([c.getGasPrice(), tip()]);
    return { kind: "number", number: Number(formatUnits(wei, 9)), unit: "gwei", pinnedAtBlock };
  },

  async dagTips() {
    const [dag, pinnedAtBlock] = await Promise.all([dagOverview(), tip()]);
    if (!Number.isFinite(dag.tipsCount)) return { kind: "indeterminate", reason: "no tip count in dag overview" };
    return { kind: "number", number: dag.tipsCount, unit: "tips", pinnedAtBlock };
  },

  async balanceSalt(params) {
    const address = reqAddress(params);
    const c = harnessClient();
    const [wei, pinnedAtBlock] = await Promise.all([c.getBalance({ address }), tip()]);
    return { kind: "number", number: Number(formatUnits(wei, 18)), unit: "SALT", pinnedAtBlock };
  },

  async nonce(params) {
    const address = reqAddress(params);
    const c = harnessClient();
    const [n, pinnedAtBlock] = await Promise.all([c.getTransactionCount({ address }), tip()]);
    return { kind: "number", number: Number(n), unit: "nonce", pinnedAtBlock };
  },

  async addressKind(params) {
    const address = reqAddress(params);
    const c = harnessClient();
    const [code, pinnedAtBlock] = await Promise.all([c.getCode({ address }), tip()]);
    const isContract = !!code && (code as Hex) !== "0x";
    // Generator supplies the phrasing the answer should contain (contains_any).
    return isContract
      ? { kind: "strings", values: ["contract"], pinnedAtBlock }
      : { kind: "strings", values: ["wallet", "eoa", "externally owned", "not a contract", "no"], pinnedAtBlock };
  },

  async tokenMeta(params) {
    const address = reqAddress(params);
    const [info, pinnedAtBlock] = await Promise.all([getToken(address), tip()]);
    const meta = info as { symbol?: string | null; name?: string | null; standard?: string };
    if (!meta.symbol && !meta.name) {
      return { kind: "indeterminate", reason: "address has no ERC-20/721 name or symbol" };
    }
    const values = [meta.symbol, meta.name].filter((s): s is string => !!s);
    return { kind: "strings", values, pinnedAtBlock };
  },

  async latestBlockTxCount() {
    const c = harnessClient();
    const block = await c.getBlock({ blockTag: "latest" });
    return {
      kind: "number",
      number: block.transactions.length,
      unit: "tx",
      pinnedAtBlock: Number(block.number),
    };
  },
};

/** Generators for capabilities not yet built — reported as not-yet-supported. */
export const UNSUPPORTED_GENERATORS = new Set<string>([
  "findNativeTransfers", // RA-2
  "findTokenTransfers", // RA-3
  "topHolders", // RA-3
  "tokenActivity", // RA-3
  "traceValueFlow", // RA-4
]);

export function knownGenerators(): string[] {
  return Object.keys(GENERATORS);
}

/** Compute a golden item's ground truth. Throws only on a misconfigured record. */
export async function generateGroundTruth(name: string, params: Params = {}): Promise<TruthValue> {
  if (UNSUPPORTED_GENERATORS.has(name)) {
    return { kind: "unsupported", reason: `generator "${name}" lands in a later sprint` };
  }
  const gen = GENERATORS[name];
  if (!gen) return { kind: "unsupported", reason: `unknown generator "${name}"` };
  try {
    return await gen(params);
  } catch (err) {
    return { kind: "indeterminate", reason: (err as Error).message };
  }
}
