// Tripwire: ingestBlock's writes all go through its one database transaction. A height counts as
// indexed when it has a live `blocks` row (resumePlan, isIndexed, the runbook's completeness
// check), which is only true if the block row commits together with its txs, receipts and logs.
// A write on `db` (outside the transaction) anywhere in ingestBlock or its fetch helpers would
// bring back block rows whose transactions never landed. The behaviour is proven on real Postgres
// in smokeResume.db.test.ts; this keeps the shape in CI, which has no Postgres.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(__dirname, "ingest.ts"), "utf8");
const start = src.indexOf("export async function ingestBlock(");
const end = src.indexOf("export async function reconcileFinality(");
const region = src.slice(start, end);

describe("ingestBlock atomicity (tripwire)", () => {
  it("finds the ingest region", () => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
  });

  it("opens exactly one database transaction", () => {
    expect(region.match(/\bdb\.transaction\(/g) ?? []).toHaveLength(1);
  });

  it("never writes on db outside that transaction", () => {
    expect(region.match(/\bdb\s*\.\s*(insert|update|delete|execute)\s*\(/g) ?? []).toEqual([]);
  });
});
