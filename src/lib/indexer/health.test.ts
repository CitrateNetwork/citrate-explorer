// /api/health's indexer component. Merging auto-deploys main before the 0005 migration runs, so a
// database without the genesis columns must not take head/lag (the freshness signal) down with it.
// It must not report "ok" either: the genesis guard refuses to write on such a database, so a head
// still within maxLag is a frozen index, not a healthy one.
import { describe, it, expect } from "vitest";
import { indexerHealthComponent, isIndexerDegraded } from "./health";

const R1005 = "0x1dcfc4909dd9fdcb0f03c823d627e4b2032cc86bef5fc4561030d6c64b9775f1";
const R1006 = "0xa3651a272fe411948cbb4cf7cca4cee44be4248d32ab4376cea7636821c6cdd4";
const base = { head: 100, chainHead: 120, maxLag: 50, rpcGenesis: R1005 };

describe("indexerHealthComponent", () => {
  it("before migration 0005: not ok (genesis_not_migrated), head and lag survive", () => {
    const c = indexerHealthComponent({ ...base, genesis: { migrated: false } });
    expect(c).toMatchObject({
      status: "genesis_not_migrated",
      head: 100,
      lagBlocks: 20,
      genesis: { status: "not_migrated" },
    });
    expect(isIndexerDegraded(c.status)).toBe(true);
  });

  it("a failed genesis read is not ok (genesis_unknown), head and lag survive", () => {
    const c = indexerHealthComponent({ ...base, genesis: { error: true } });
    expect(c).toMatchObject({ status: "genesis_unknown", head: 100, lagBlocks: 20, genesis: { status: "error" } });
    expect(isIndexerDegraded(c.status)).toBe(true);
  });

  it("every stored refusal code is not ok, with the code as the reason, even within maxLag", () => {
    for (const code of ["rpc_not_expected_network", "genesis_mismatch", "index_not_this_chain", "not_migrated"]) {
      const c = indexerHealthComponent({
        ...base,
        chainHead: 101,
        genesis: { migrated: true, recorded: null, status: "refused", code, checkedAt: null },
      });
      expect(c).toMatchObject({ status: "genesis_refused", lagBlocks: 1, genesis: { code } });
      expect(isIndexerDegraded(c.status)).toBe(true);
    }
  });

  it("a recorded genesis that is not this build's network is not ok, even when the RPC agrees with it", () => {
    const c = indexerHealthComponent({
      ...base,
      rpcGenesis: R1005,
      expectedGenesis: R1006,
      genesis: { migrated: true, recorded: R1005, status: "ok", code: null, checkedAt: null },
    });
    expect(c.status).toBe("genesis_mismatch");
    expect(isIndexerDegraded(c.status)).toBe(true);
  });

  it("an unreadable recorded genesis is not ok", () => {
    const c = indexerHealthComponent({
      ...base,
      genesis: { migrated: true, recorded: "0xnot-a-hash", status: "ok", code: null, checkedAt: null },
    });
    expect(c.status).toBe("genesis_unreadable");
    expect(isIndexerDegraded(c.status)).toBe(true);
  });

  it("migrated and matching: ok with the recorded genesis", () => {
    const c = indexerHealthComponent({
      ...base,
      genesis: { migrated: true, recorded: R1005, status: "ok", code: null, checkedAt: null },
    });
    expect(c).toMatchObject({ status: "ok", genesis: { recorded: R1005, status: "ok" } });
  });

  it("migrated with a stored refusal or a moved RPC: genesis status overrides lag", () => {
    const refused = indexerHealthComponent({
      ...base,
      genesis: { migrated: true, recorded: R1005, status: "refused", code: "genesis_mismatch", checkedAt: null },
    });
    expect(refused.status).toBe("genesis_refused");
    const moved = indexerHealthComponent({
      ...base,
      rpcGenesis: R1006,
      genesis: { migrated: true, recorded: R1005, status: "ok", code: null, checkedAt: null },
    });
    expect(moved.status).toBe("genesis_mismatch");
  });

  it("lag beyond maxLag is still reported when the genesis read fails; the genesis reason wins", () => {
    const c = indexerHealthComponent({ ...base, chainHead: 500, genesis: { migrated: false } });
    expect(c).toMatchObject({ status: "genesis_not_migrated", lagBlocks: 400 });
  });

  it("matching genesis with no issue: only ok and unknown lag are not degraded", () => {
    expect(isIndexerDegraded("ok")).toBe(false);
    expect(isIndexerDegraded("unknown")).toBe(false);
    expect(isIndexerDegraded("not_provisioned")).toBe(false);
    expect(isIndexerDegraded("empty")).toBe(false);
    expect(isIndexerDegraded("lagging")).toBe(true);
    expect(isIndexerDegraded("error")).toBe(true);
  });

  it("tripwire: any genesis_* status (including ones added later) degrades health", () => {
    expect(isIndexerDegraded("genesis_some_future_reason")).toBe(true);
  });
});
