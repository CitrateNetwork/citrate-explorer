import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTableName, type Table } from "drizzle-orm";
import { keccak256 } from "viem";
import fixture from "./fixtures/arachnid-create2-membership-stake-vault.json";

/**
 * ingestBlock → `contracts`: a block with a top-level CREATE, an Arachnid
 * CREATE2 (the real MembershipStakeVault deployment input), a reverted factory
 * call, and a plain transfer. RPC (block, receipts, getCode) and the database
 * are replaced by in-memory recorders so the test exercises the real ingest
 * code path end to end without a network or a Postgres.
 */

interface Op {
  op: "insert" | "update" | "delete" | "select";
  table?: string;
  values?: unknown;
  set?: unknown;
  conflict?: unknown;
}

const state = vi.hoisted(() => ({
  ops: [] as Op[],
  failTable: null as string | null,
  codeCalls: [] as { address: string; blockNumber?: bigint }[],
  codeImpl: null as null | ((a: string) => Promise<string | undefined>),
}));

/** A chainable query recorder: every builder method returns itself; awaiting
 *  resolves to [] (or rejects for `failTable`). */
function recorder(rec: Op) {
  state.ops.push(rec);
  const proxy: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") {
          return (res: (v: unknown) => void, rej: (e: unknown) => void) =>
            rec.table && rec.table === state.failTable ? rej(new Error(`${rec.table} write failed`)) : res([]);
        }
        return (...args: unknown[]) => {
          if (prop === "values") rec.values = args[0];
          if (prop === "set") rec.set = args[0];
          if (prop === "onConflictDoUpdate") rec.conflict = args[0];
          if (prop === "from") rec.table = getTableName(args[0] as Table);
          return proxy;
        };
      },
    },
  );
  return proxy;
}

const db = {
  insert: (t: Table) => recorder({ op: "insert", table: getTableName(t) }),
  update: (t: Table) => recorder({ op: "update", table: getTableName(t) }),
  delete: (t: Table) => recorder({ op: "delete", table: getTableName(t) }),
  select: () => recorder({ op: "select" }),
};

const DEPLOYER = "0x00000000000000000000000000000000000000e0";
const CREATED = "0x00000000000000000000000000000000000000c1";
const tx = (hash: string, to: string | null, input: string) => ({
  hash,
  from: DEPLOYER,
  to,
  input,
  value: "0x0",
  nonce: "0x1",
  gas: "0x5208",
  gasPrice: "0x1",
  transactionIndex: "0x0",
  type: "0x0",
});
const BLOCK = {
  hash: "0xblock",
  height: 398,
  blueScore: 398,
  blueWork: "1",
  timestamp: 1,
  selectedParent: "0xparent",
  mergeParents: [],
  proposer: DEPLOYER,
  gasUsed: 1,
  gasLimit: 1,
  baseFeePerGas: null,
  txCount: 4,
  raw: {
    transactions: [
      tx("0x01", null, "0x6080"),
      tx(fixture.tx.hash, fixture.tx.to, fixture.tx.input),
      tx("0x03", fixture.tx.to, `0x${"22".repeat(32)}6080`),
      tx("0x04", "0x1111111111111111111111111111111111111111", "0x"),
    ],
  },
};
const RECEIPTS: Record<string, { status: string; contractAddress: string | null }> = {
  "0x01": { status: "success", contractAddress: CREATED },
  [fixture.tx.hash]: { status: "success", contractAddress: null },
  "0x03": { status: "reverted", contractAddress: null },
  "0x04": { status: "success", contractAddress: null },
};

vi.mock("@/lib/citrate/rpc", () => ({
  getDagBlock: async () => BLOCK,
  dagStats: async () => {
    throw new Error("no stats");
  },
  isFinal: () => false,
}));
vi.mock("@/lib/db/client", () => ({ getDb: () => db }));
vi.mock("@/lib/harness/ops", () => ({ getToken: async () => ({}) }));
vi.mock("@/lib/harness/client", () => ({
  harnessClient: () => ({
    getTransactionReceipt: async ({ hash }: { hash: string }) => ({
      ...RECEIPTS[hash],
      gasUsed: 21000n,
      cumulativeGasUsed: 21000n,
      logs: [],
    }),
    getCode: async (args: { address: string; blockNumber?: bigint }) => {
      state.codeCalls.push(args);
      return state.codeImpl ? state.codeImpl(args.address) : "0x6080";
    },
  }),
}));

import { ingestBlock } from "./ingest";

const contractInserts = () => state.ops.filter((o) => o.op === "insert" && o.table === "contracts");

describe("ingestBlock records contract creations", () => {
  beforeEach(() => {
    state.ops.length = 0;
    state.codeCalls.length = 0;
    state.failTable = null;
    state.codeImpl = null;
  });

  it("upserts CREATE + confirmed Arachnid CREATE2 rows in one batch, with book names", async () => {
    const res = await ingestBlock(398);
    expect(res.persisted).toBe(true);

    // One getCode per candidate (CREATE + CREATE2), pinned to the block height;
    // the reverted factory call and the plain transfer cost nothing.
    expect(state.codeCalls.map((c) => c.address).sort()).toEqual(
      [CREATED, fixture.expectedAddress.toLowerCase()].sort(),
    );
    expect(state.codeCalls.every((c) => c.blockNumber === 398n)).toBe(true);

    const inserts = contractInserts();
    expect(inserts).toHaveLength(1);
    expect(inserts[0].values).toEqual([
      { address: CREATED, name: null, creator: DEPLOYER, creationTx: "0x01", bytecodeHash: keccak256("0x6080") },
      {
        address: fixture.expectedAddress.toLowerCase(),
        name: "MembershipStakeVault",
        creator: DEPLOYER,
        creationTx: fixture.tx.hash.toLowerCase(),
        bytecodeHash: keccak256("0x6080"),
      },
    ]);
    expect(inserts[0].conflict).toBeTruthy(); // upsert, not a blind insert

    // Each creating tx is linked to its contract.
    const links = state.ops.filter((o) => o.op === "update" && o.table === "transactions");
    expect(links.map((l) => l.set)).toEqual([
      { createdContract: CREATED },
      { createdContract: fixture.expectedAddress.toLowerCase() },
    ]);
  });

  it("does not record a derived CREATE2 address that has no code", async () => {
    state.codeImpl = async (a) => (a === CREATED ? "0x6080" : "0x");
    await ingestBlock(398);
    const rows = contractInserts()[0].values as { address: string }[];
    expect(rows.map((r) => r.address)).toEqual([CREATED]);
  });

  it("is panic-safe: RPC or DB failures in contract indexing never fail the block", async () => {
    state.codeImpl = async () => {
      throw new Error("rpc down");
    };
    const a = await ingestBlock(398);
    expect(a.persisted).toBe(true);
    // CREATE still recorded from its receipt (bytecode hash left for the backfill).
    expect((contractInserts()[0].values as { bytecodeHash: string | null }[])[0].bytecodeHash).toBeNull();

    state.codeImpl = null;
    state.failTable = "contracts";
    const b = await ingestBlock(398);
    expect(b.persisted).toBe(true);
    // The cursor still advanced after the contracts write failed.
    expect(state.ops.some((o) => o.op === "insert" && o.table === "indexer_state")).toBe(true);
  });
});
