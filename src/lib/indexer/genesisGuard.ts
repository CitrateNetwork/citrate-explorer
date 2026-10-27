/**
 * Genesis guard for the indexer (r1006 cutover, 2026-10-27).
 *
 * r1005 and r1006 share chain id 40204, so the chain id cannot tell them apart. Block 0's hash
 * can. The indexer records block 0's hash in `indexer_state.genesis_hash` on first index and,
 * on start and before every ingest batch, compares the RPC's block 0 with it. On a mismatch it
 * refuses to write (fail closed) instead of mixing two chains' rows under one chain id, and it
 * stores the refusal so `/api/health` reports it.
 *
 * Verdicts:
 *  - `index`       recorded genesis == RPC block 0 (and == the build's network, when pinned);
 *  - `record`      nothing recorded yet and the index is provably this chain's: either empty, or
 *                  its lowest live block is the block the RPC serves at that height;
 *  - `unavailable` the RPC returned no usable block 0 or failed: skip this tick, do not latch;
 *  - `refuse`      anything else. {@link GenesisGate} latches a refusal until the process restarts.
 *
 * Data source (Rule 7): live Citrate RPC `eth_getBlockByNumber` (block 0 and the anchor height)
 * via {@link GenesisRpc}; the recorded genesis and the index anchor from Postgres
 * (`indexer_state`, `blocks`) via {@link GenesisStore}; the expected genesis from the build's
 * generated chain constants (`NEXT_PUBLIC_CITRATE_NETWORK`, src/lib/citrate/network.ts).
 */

const HASH_RE = /^0x[0-9a-f]{64}$/;

/** A 32-byte 0x hash, lowercased; anything else is null. */
export function normalizeHash(h: unknown): string | null {
  if (typeof h !== "string") return null;
  const v = h.toLowerCase();
  return HASH_RE.test(v) ? v : null;
}

/** Reads a block hash by height from the chain RPC (null when the node has no such block). */
export interface GenesisRpc {
  blockHashAt(height: number): Promise<string | null>;
}

export type GenesisRefusalCode =
  /** The RPC's block 0 is not the genesis of the network this build is configured for. */
  | "rpc_not_expected_network"
  /** The RPC's block 0 differs from the genesis recorded in the index. */
  | "genesis_mismatch"
  /** Nothing is recorded and the index holds rows the RPC's chain does not have. */
  | "index_not_this_chain"
  /** The database predates migration 0005 (no genesis columns): nothing can be recorded or proven. */
  | "not_migrated";

/** What the guard last decided, persisted for `/api/health`. */
export interface GenesisStatusRecord {
  status: "ok" | "refused" | "unavailable";
  code: GenesisRefusalCode | null;
  observed: string | null;
  detail: string | null;
}

/** Where the recorded genesis lives (Postgres in production; see genesisStore.ts). */
export interface GenesisStore {
  /** The recorded genesis hash, or null when none is recorded yet. */
  recorded(): Promise<string | null>;
  /** The last stored check status (`ok` / `refused` / `unavailable`), or null. */
  lastStatus(): Promise<string | null>;
  /** The index's lowest live (non-superseded) block, or null when the index is empty. */
  anchor(): Promise<{ height: number; hash: string } | null>;
  /**
   * Records `genesis` only if nothing is recorded yet, and returns whatever is recorded after
   * the write (another writer may have recorded a different hash first).
   */
  record(genesis: string): Promise<string | null>;
  markStatus(s: GenesisStatusRecord): Promise<void>;
}

/**
 * The database has no `indexer_state.genesis_*` columns: this build was deployed before
 * `pnpm db:migrate` ran migration 0005. The guard turns it into a `not_migrated` refusal.
 */
export class GenesisNotMigratedError extends Error {
  constructor() {
    super("indexer_state has no genesis columns: run `pnpm db:migrate` (migration 0005), then restart the indexer");
    this.name = "GenesisNotMigratedError";
  }
}

/** Postgres `undefined_column` (SQLSTATE 42703), on the error or its `cause` (drizzle wraps it). */
export function isUndefinedColumn(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && typeof e === "object" && depth < 5; depth++) {
    if ((e as { code?: unknown }).code === "42703") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

export type GenesisVerdict =
  | { action: "index" | "record"; genesis: string }
  | { action: "unavailable"; detail: string }
  | {
      action: "refuse";
      code: GenesisRefusalCode;
      detail: string;
      observed: string | null;
      recorded: string | null;
    };

export interface GenesisDeps {
  rpc: GenesisRpc;
  /** null in dry mode (no DATABASE_URL): only the configured network is checked. */
  store: GenesisStore | null;
  /** The build's network genesis (generated chain constants), or null to skip that pin. */
  expected: string | null;
}

async function refuse(
  store: GenesisStore | null,
  code: GenesisRefusalCode,
  detail: string,
  observed: string | null,
  recorded: string | null,
): Promise<GenesisVerdict> {
  if (store) await store.markStatus({ status: "refused", code, observed, detail });
  return { action: "refuse", code, detail, observed, recorded };
}

/**
 * One genesis check: reads the RPC's block 0, compares, records on first index. A database
 * without the genesis columns (deployed before migration 0005) is a `not_migrated` refusal.
 */
export async function checkGenesis(deps: GenesisDeps): Promise<GenesisVerdict> {
  try {
    return await checkGenesisInner(deps);
  } catch (err) {
    if (!(err instanceof GenesisNotMigratedError)) throw err;
    // Nothing can be stored either (no columns): the refusal is logged by the gate.
    return { action: "refuse", code: "not_migrated", detail: err.message, observed: null, recorded: null };
  }
}

async function checkGenesisInner({ rpc, store, expected }: GenesisDeps): Promise<GenesisVerdict> {
  const observed = normalizeHash(await rpc.blockHashAt(0));
  if (!observed) {
    const detail = "the RPC returned no usable block 0 hash";
    // A transient "unavailable" never replaces a stored refusal (e.g. after a restart).
    if (store && (await store.lastStatus()) !== "refused") {
      await store.markStatus({ status: "unavailable", code: null, observed: null, detail });
    }
    return { action: "unavailable", detail };
  }

  const pinned = expected ? normalizeHash(expected) : null;
  if (expected && !pinned) {
    // A malformed pin cannot prove anything: refuse rather than skip the check.
    return refuse(store, "rpc_not_expected_network", `the configured network genesis is malformed: ${expected}`, observed, null);
  }
  if (pinned && observed !== pinned) {
    return refuse(
      store,
      "rpc_not_expected_network",
      `RPC block 0 is ${observed}; this build is configured for genesis ${pinned} (NEXT_PUBLIC_CITRATE_NETWORK)`,
      observed,
      store ? await store.recorded() : null,
    );
  }
  if (!store) return { action: "index", genesis: observed };

  const recorded = normalizeHash(await store.recorded());
  if (recorded) {
    if (recorded !== observed) {
      return refuse(
        store,
        "genesis_mismatch",
        `RPC block 0 is ${observed}; the index was built from genesis ${recorded}`,
        observed,
        recorded,
      );
    }
    await store.markStatus({ status: "ok", code: null, observed, detail: null });
    return { action: "index", genesis: observed };
  }

  // Nothing recorded yet. Record only when the index is provably this chain's.
  const anchor = await store.anchor();
  if (anchor) {
    const anchorHash = normalizeHash(anchor.hash);
    const rpcAtAnchor =
      anchor.height === 0 ? observed : normalizeHash(await rpc.blockHashAt(anchor.height));
    if (!anchorHash || rpcAtAnchor !== anchorHash) {
      return refuse(
        store,
        "index_not_this_chain",
        `the index holds block ${anchor.hash} at height ${anchor.height}; the RPC serves ${rpcAtAnchor ?? "no block"} there`,
        observed,
        null,
      );
    }
  }

  const effective = normalizeHash(await store.record(observed));
  if (effective !== observed) {
    return refuse(
      store,
      "genesis_mismatch",
      `RPC block 0 is ${observed}; genesis ${effective ?? "(unreadable)"} was recorded first`,
      observed,
      effective,
    );
  }
  await store.markStatus({ status: "ok", code: null, observed, detail: null });
  return { action: "record", genesis: observed };
}

export interface GenesisGateOptions {
  /** Minimum time between checks after a passing one. 0 = check before every batch. */
  intervalMs: number;
  now?: () => number;
  log?: (msg: string) => void;
}

/**
 * Decides, before each ingest batch, whether the indexer may write. Checks on the first call,
 * then whenever `intervalMs` has passed since the last passing check. A refusal latches for the
 * life of the process: an RPC flapping between two genesis blocks must not resume a mixed index.
 * An unavailable check (RPC error, no block 0) blocks only the current tick.
 */
export class GenesisGate {
  refusal: Extract<GenesisVerdict, { action: "refuse" }> | null = null;
  private lastOkAt: number | null = null;
  private readonly now: () => number;
  private readonly log: (msg: string) => void;

  constructor(
    private readonly deps: GenesisDeps,
    private readonly opts: GenesisGateOptions,
  ) {
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => {});
  }

  async allow(): Promise<boolean> {
    if (this.refusal) return false;
    const t = this.now();
    if (this.lastOkAt !== null && t - this.lastOkAt < this.opts.intervalMs) return true;
    let v: GenesisVerdict;
    try {
      v = await checkGenesis(this.deps);
    } catch (err) {
      this.log(`[indexer] genesis check failed (${(err as Error).message}); not indexing this tick`);
      return false;
    }
    if (v.action === "refuse") {
      this.refusal = v;
      this.log(`[indexer] GENESIS REFUSED (${v.code}): ${v.detail}. Not indexing; fix the RPC or the database, then restart.`);
      return false;
    }
    if (v.action === "unavailable") {
      this.log(`[indexer] genesis check unavailable (${v.detail}); not indexing this tick`);
      return false;
    }
    if (v.action === "record") this.log(`[indexer] recorded genesis ${v.genesis}`);
    this.lastOkAt = t;
    return true;
  }
}

/**
 * The index's genesis state as `/api/health` reports it: `genesis_refused` when the indexer
 * stored a refusal, `genesis_mismatch` when the recorded genesis is not the RPC's block 0 (the
 * RPC moved and the indexer has not checked yet), else null (nothing to override).
 */
export function genesisHealth(i: {
  status: string | null;
  recorded: string | null;
  rpcGenesis: string | null;
}): "genesis_refused" | "genesis_mismatch" | null {
  if (i.status === "refused") return "genesis_refused";
  const recorded = normalizeHash(i.recorded);
  const rpc = normalizeHash(i.rpcGenesis);
  if (recorded && rpc && recorded !== rpc) return "genesis_mismatch";
  return null;
}
