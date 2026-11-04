// /api/health route wiring: the indexer component's genesis status must reach the overall status
// (through isIndexerDegraded) and the build's network genesis must reach the component. The
// component itself is unit-tested in src/lib/indexer/health.test.ts; this proves the route uses it.
//
// Data sources are test doubles here (chain RPC, indexer head, genesis read); no network, no DB.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CHAIN_CONSTANTS } from "@/lib/citrate/network";
import type { GenesisRead } from "@/lib/indexer/health";

const OTHER = `0x${"77".repeat(32)}`;
let genesisRead: GenesisRead | null = null;
let rpcGenesis: string = CHAIN_CONSTANTS.genesisHash;

vi.mock("@/lib/api/publicRead", () => ({ limitPublicRead: async () => null }));
vi.mock("@/lib/api/ratelimit", () => ({ isDistributed: () => false }));
vi.mock("@/lib/harness/ops", () => ({
  getChainStatus: async () => ({ chainId: 40204, blockNumber: "110", gasPriceWei: "1" }),
}));
vi.mock("@/lib/indexer/repository", () => ({ indexerHead: async () => 100 }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({}), isDbEnabled: () => true }));
vi.mock("@/lib/indexer/genesisStore", () => ({
  readGenesisState: async () => genesisRead,
  rpcGenesisSource: () => ({ blockHashAt: async () => rpcGenesis }),
}));

async function health() {
  const { GET } = await import("./route");
  const res = await GET(new Request("http://x/api/health"));
  const body = (await res.json()) as { status: string; components: { indexer: { status: string } } };
  return { http: res.status, status: body.status, indexer: body.components.indexer.status };
}

const migrated = (recorded: string | null, status: string | null, code: string | null = null): GenesisRead => ({
  migrated: true,
  recorded,
  status,
  code,
  checkedAt: null,
});

describe("/api/health: indexer genesis status reaches the overall status", () => {
  beforeEach(() => {
    genesisRead = null;
    rpcGenesis = CHAIN_CONSTANTS.genesisHash;
  });

  it("matching genesis within maxLag: ok", async () => {
    genesisRead = migrated(CHAIN_CONSTANTS.genesisHash, "ok");
    expect(await health()).toEqual({ http: 200, status: "ok", indexer: "ok" });
  });

  it("a database before migration 0005 (the guard refuses to write): degraded, not ok", async () => {
    genesisRead = { migrated: false };
    expect(await health()).toEqual({ http: 200, status: "degraded", indexer: "genesis_not_migrated" });
  });

  it("a stored refusal: degraded", async () => {
    genesisRead = migrated(null, "refused", "rpc_not_expected_network");
    expect(await health()).toEqual({ http: 200, status: "degraded", indexer: "genesis_refused" });
  });

  it("an index of another network, served by that network's RPC: the indexer is genesis_mismatch", async () => {
    // The RPC agrees with the index, so only the build's expected genesis exposes it.
    rpcGenesis = OTHER;
    genesisRead = migrated(OTHER, "ok");
    expect(await health()).toEqual({ http: 503, status: "down", indexer: "genesis_mismatch" });
  });
});
