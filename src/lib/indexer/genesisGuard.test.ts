// Genesis guard (r1006 cutover): r1005 and r1006 share chain id 40204, so the chain id cannot tell
// them apart. The indexer records block 0's hash on first index and refuses to write when the RPC
// serves a different block 0, so the index never mixes rows from two chains under one chain id.
// These tests drive the guard with an in-memory RPC and store (test doubles); the DB-backed store
// is a thin drizzle adapter over the same interface.
import { describe, it, expect } from "vitest";
import {
  checkGenesis,
  GenesisGate,
  genesisHealth,
  normalizeHash,
  type GenesisRpc,
  type GenesisStore,
  type GenesisStatusRecord,
} from "./genesisGuard";

const R1005 = "0x1dcfc4909dd9fdcb0f03c823d627e4b2032cc86bef5fc4561030d6c64b9775f1";
const R1006 = "0xa3651a272fe411948cbb4cf7cca4cee44be4248d32ab4376cea7636821c6cdd4";
const H = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

function fakeRpc(chain: Record<number, string | null>, opts: { throws?: boolean } = {}) {
  const calls: number[] = [];
  const rpc: GenesisRpc & { calls: number[]; chain: Record<number, string | null>; throws: boolean } = {
    calls,
    chain,
    throws: opts.throws ?? false,
    async blockHashAt(h: number) {
      calls.push(h);
      if (rpc.throws) throw new Error("rpc unreachable");
      return rpc.chain[h] ?? null;
    },
  };
  return rpc;
}

class MemStore implements GenesisStore {
  records = 0;
  status: GenesisStatusRecord | null = null;
  constructor(
    public recordedHash: string | null = null,
    public anchorRow: { height: number; hash: string } | null = null,
    /** Simulates a concurrent writer that recorded a different genesis first. */
    public raceWinner: string | null = null,
  ) {}
  async recorded() {
    return this.recordedHash;
  }
  async anchor() {
    return this.anchorRow;
  }
  async record(genesis: string) {
    this.records++;
    if (this.raceWinner && this.recordedHash === null) this.recordedHash = this.raceWinner;
    if (this.recordedHash === null) this.recordedHash = genesis;
    return this.recordedHash;
  }
  async markStatus(s: GenesisStatusRecord) {
    this.status = s;
  }
}

describe("checkGenesis: record, index, refuse", () => {
  it("missing + empty index: records the RPC's block 0 and indexes", async () => {
    const store = new MemStore();
    const v = await checkGenesis({ rpc: fakeRpc({ 0: R1006 }), store, expected: R1006 });
    expect(v.action).toBe("record");
    expect(store.recordedHash).toBe(R1006);
    expect(store.status?.status).toBe("ok");
  });

  it("same genesis: indexes without re-recording", async () => {
    const store = new MemStore(R1005, { height: 0, hash: R1005 });
    const v = await checkGenesis({ rpc: fakeRpc({ 0: R1005 }), store, expected: R1005 });
    expect(v.action).toBe("index");
    expect(store.records).toBe(0);
    expect(store.status?.status).toBe("ok");
  });

  it("different genesis: refuses, keeps the recorded hash, and stores the refusal for /api/health", async () => {
    const store = new MemStore(R1005, { height: 0, hash: R1005 });
    const v = await checkGenesis({ rpc: fakeRpc({ 0: R1006 }), store, expected: null });
    expect(v.action).toBe("refuse");
    if (v.action !== "refuse") return;
    expect(v.code).toBe("genesis_mismatch");
    expect(v.recorded).toBe(R1005);
    expect(v.observed).toBe(R1006);
    expect(store.recordedHash).toBe(R1005);
    expect(store.records).toBe(0);
    expect(store.status).toMatchObject({ status: "refused", code: "genesis_mismatch", observed: R1006 });
  });

  it("refuses an RPC that is not the network this build was configured for, even on an empty index", async () => {
    const store = new MemStore();
    const v = await checkGenesis({ rpc: fakeRpc({ 0: R1005 }), store, expected: R1006 });
    expect(v.action).toBe("refuse");
    if (v.action !== "refuse") return;
    expect(v.code).toBe("rpc_not_expected_network");
    expect(store.recordedHash).toBeNull();
    expect(store.records).toBe(0);
  });

  it("missing record on a non-empty index: records only when the RPC has the index's anchor block", async () => {
    const store = new MemStore(null, { height: 7, hash: H(7) });
    const v = await checkGenesis({ rpc: fakeRpc({ 0: R1005, 7: H(7) }), store, expected: R1005 });
    expect(v.action).toBe("record");
    expect(store.recordedHash).toBe(R1005);
  });

  it("missing record on a non-empty index from another chain: refuses and records nothing", async () => {
    // An r1005 index (no genesis column yet, rows from block 0) pointed at an r1006 RPC.
    const store = new MemStore(null, { height: 0, hash: R1005 });
    const v = await checkGenesis({ rpc: fakeRpc({ 0: R1006 }), store, expected: null });
    expect(v.action).toBe("refuse");
    if (v.action !== "refuse") return;
    expect(v.code).toBe("index_not_this_chain");
    expect(store.recordedHash).toBeNull();
    expect(store.records).toBe(0);
  });

  it("an RPC that has no block at the index's anchor height cannot prove the index: refuses", async () => {
    const store = new MemStore(null, { height: 600_000, hash: H(600_000) });
    const v = await checkGenesis({ rpc: fakeRpc({ 0: R1006 }), store, expected: null });
    expect(v.action).toBe("refuse");
    if (v.action !== "refuse") return;
    expect(v.code).toBe("index_not_this_chain");
    expect(store.records).toBe(0);
  });

  it("a concurrent writer that recorded a different genesis first wins, and this one refuses", async () => {
    const store = new MemStore(null, null, R1005);
    const v = await checkGenesis({ rpc: fakeRpc({ 0: R1006 }), store, expected: null });
    expect(v.action).toBe("refuse");
    if (v.action !== "refuse") return;
    expect(v.code).toBe("genesis_mismatch");
    expect(store.recordedHash).toBe(R1005);
  });

  it("missing or malformed block 0 is 'unavailable' (no ingest, nothing recorded), not a match", async () => {
    for (const bad of [null, "0x", "0x1234", `${R1006}00`, "not-a-hash"]) {
      const store = new MemStore();
      const v = await checkGenesis({ rpc: fakeRpc({ 0: bad }), store, expected: null });
      expect(v.action).toBe("unavailable");
      expect(store.records).toBe(0);
      expect(store.status?.status).toBe("unavailable");
    }
  });

  it("compares hashes case-insensitively", async () => {
    const store = new MemStore(R1006, { height: 0, hash: R1006 });
    const v = await checkGenesis({ rpc: fakeRpc({ 0: R1006.toUpperCase().replace("0X", "0x") }), store, expected: R1006 });
    expect(v.action).toBe("index");
  });

  it("dry mode (no DB): only the configured network is checked", async () => {
    expect((await checkGenesis({ rpc: fakeRpc({ 0: R1006 }), store: null, expected: R1006 })).action).toBe("index");
    const v = await checkGenesis({ rpc: fakeRpc({ 0: R1005 }), store: null, expected: R1006 });
    expect(v.action).toBe("refuse");
  });

  it("normalizeHash accepts only 32-byte hex", () => {
    expect(normalizeHash(R1006.toUpperCase().replace("0X", "0x"))).toBe(R1006);
    expect(normalizeHash("0xabc")).toBeNull();
    expect(normalizeHash(undefined)).toBeNull();
    expect(normalizeHash(42)).toBeNull();
  });
});

describe("GenesisGate: on start, then periodically; a refusal latches", () => {
  it("checks on the first call, and a refusal stays latched even if the RPC later serves the recorded genesis", async () => {
    const rpc = fakeRpc({ 0: R1006 });
    const store = new MemStore(R1005, { height: 0, hash: R1005 });
    const gate = new GenesisGate({ rpc, store, expected: null }, { intervalMs: 0, now: () => 0 });
    expect(await gate.allow()).toBe(false);
    expect(gate.refusal?.code).toBe("genesis_mismatch");
    rpc.chain[0] = R1005; // a load balancer flapping back must not resume a mixed index
    expect(await gate.allow()).toBe(false);
    expect(gate.refusal?.code).toBe("genesis_mismatch");
  });

  it("re-checks only when the interval has elapsed, and stops at the first mismatch", async () => {
    let t = 0;
    const rpc = fakeRpc({ 0: R1005 });
    const store = new MemStore(R1005, { height: 0, hash: R1005 });
    const gate = new GenesisGate({ rpc, store, expected: R1005 }, { intervalMs: 30_000, now: () => t });
    expect(await gate.allow()).toBe(true);
    expect(rpc.calls.length).toBe(1);
    t = 10_000;
    expect(await gate.allow()).toBe(true);
    expect(rpc.calls.length).toBe(1);
    rpc.chain[0] = R1006; // the public RPC is cut over under a running r1005 indexer
    t = 30_000;
    expect(await gate.allow()).toBe(false);
    expect(gate.refusal?.code).toBe("rpc_not_expected_network");
  });

  it("an RPC error blocks this tick without latching; the next tick re-checks", async () => {
    const rpc = fakeRpc({ 0: R1005 }, { throws: true });
    const store = new MemStore(R1005, { height: 0, hash: R1005 });
    const gate = new GenesisGate({ rpc, store, expected: R1005 }, { intervalMs: 60_000, now: () => 0 });
    expect(await gate.allow()).toBe(false);
    expect(gate.refusal).toBeNull();
    rpc.throws = false;
    expect(await gate.allow()).toBe(true);
  });
});

describe("genesisHealth: what /api/health reports for the index", () => {
  it("reports a stored refusal", () => {
    expect(genesisHealth({ status: "refused", recorded: R1005, rpcGenesis: R1006 })).toBe("genesis_refused");
  });
  it("reports a recorded genesis the RPC no longer serves, before the indexer notices", () => {
    expect(genesisHealth({ status: "ok", recorded: R1005, rpcGenesis: R1006 })).toBe("genesis_mismatch");
  });
  it("is silent when the index and the RPC agree, or when nothing is recorded yet", () => {
    expect(genesisHealth({ status: "ok", recorded: R1006, rpcGenesis: R1006 })).toBeNull();
    expect(genesisHealth({ status: null, recorded: null, rpcGenesis: R1006 })).toBeNull();
  });
});
