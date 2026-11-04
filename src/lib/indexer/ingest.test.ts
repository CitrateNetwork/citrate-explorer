import { describe, it, expect } from "vitest";
import { ingestBlock, resumePlan, headHeight } from "./ingest";

const live = process.env.LIVE_RPC === "1";
const liveIt = live ? it : it.skip;

// These run in DRY mode (DATABASE_URL unset in CI/local): the indexer READS live
// blocks (proving RPC + DAG parsing) but persists nothing. The persistence paths
// (dag_edges, receipts/logs, resume, reorg) are covered by the DB-gated live
// suite once Neon is provisioned — see the S-1 provisioning handoff.
describe("indexer dry-mode (WP-1.3, live RPC, no DB)", () => {
  liveIt("reads the live head block without persisting", async () => {
    const head = await headHeight();
    expect(head).toBeGreaterThan(0);
    const res = await ingestBlock(head);
    expect(res.hash).toBeTruthy();
    expect(res.persisted).toBe(false); // dry: no DATABASE_URL
    expect(res.height).toBe(head);
  });

  liveIt("resumePlan falls back to the chain head when no DB", async () => {
    const p = await resumePlan();
    expect(p.next).toBeGreaterThan(0);
    expect(p.recoverThrough).toBe(-1);
  });
});
