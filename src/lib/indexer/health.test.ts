// /api/health's indexer component. Merging auto-deploys main before the 0005 migration runs, so a
// database without the genesis columns must not take head/lag (the freshness signal) down with it.
import { describe, it, expect } from "vitest";
import { indexerHealthComponent } from "./health";

const R1005 = "0x1dcfc4909dd9fdcb0f03c823d627e4b2032cc86bef5fc4561030d6c64b9775f1";
const R1006 = "0xa3651a272fe411948cbb4cf7cca4cee44be4248d32ab4376cea7636821c6cdd4";
const base = { head: 100, chainHead: 120, maxLag: 50, rpcGenesis: R1005 };

describe("indexerHealthComponent", () => {
  it("before migration 0005: genesis is not_migrated, head and lag survive", () => {
    const c = indexerHealthComponent({ ...base, genesis: { migrated: false } });
    expect(c).toMatchObject({ status: "ok", head: 100, lagBlocks: 20, genesis: { status: "not_migrated" } });
  });

  it("a failed genesis read reports genesis error, head and lag survive", () => {
    const c = indexerHealthComponent({ ...base, genesis: { error: true } });
    expect(c).toMatchObject({ status: "ok", head: 100, lagBlocks: 20, genesis: { status: "error" } });
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

  it("lagging beyond maxLag is still reported when the genesis read fails", () => {
    const c = indexerHealthComponent({ ...base, chainHead: 500, genesis: { migrated: false } });
    expect(c).toMatchObject({ status: "lagging", lagBlocks: 400 });
  });
});
