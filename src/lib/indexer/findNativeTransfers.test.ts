import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb } from "@/lib/db/client";
import { transactions } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { findNativeTransfers, type NativeTransfersResult } from "./repository";

// DB-gated integration test for the RA-2 native value query. Runs only when
// RA2_DB_TEST=1 (point DATABASE_URL at a throwaway Postgres — never prod). It
// verifies the SQL executes and that NUMERIC range/order is correct for 256-bit
// magnitudes — the part unit tests can't cover. Inserts + cleans up its own rows.
const enabled = process.env.RA2_DB_TEST === "1";
const d = enabled ? describe : describe.skip;

const G = 10n ** 18n;
const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000b2";
const TAG = "0xra2test";

// height, from, to, valueGrains, ts
const ROWS: [number, string, string, bigint, number][] = [
  [1001, A, B, 3_000n * G, 1_000_000],
  [1002, A, B, 30_000n * G, 1_000_100], // the "30k" target
  [1003, B, A, 300_000n * G, 1_000_200],
  [1004, A, B, 30_100n * G, 1_000_300], // within ±1% of 30k
  [1005, A, B, 5n * 10n ** 17n, 1_000_400], // 0.5 SALT
  [1006, A, B, 0n, 1_000_500], // zero — must be excluded
];

const want = (r: NativeTransfersResult, ...salts: string[]) =>
  expect(r.transfers.map((t) => t.salt).sort()).toEqual([...salts].sort());

d("findNativeTransfers (DB integration)", () => {
  beforeAll(async () => {
    const db = getDb();
    if (!db) throw new Error("RA2_DB_TEST=1 but no DATABASE_URL");
    for (const [h, from, to, val, ts] of ROWS) {
      await db
        .insert(transactions)
        .values({ hash: `${TAG}${h}`, from, to, value: val.toString(), timestamp: ts, blockHeight: h, status: 1 })
        .onConflictDoNothing();
    }
  });

  afterAll(async () => {
    const db = getDb();
    if (db) await db.delete(transactions).where(sql`${transactions.hash} LIKE ${TAG + "%"}`);
  });

  it("range query orders 256-bit values correctly (descending)", async () => {
    const r = (await findNativeTransfers({ counterparty: A, direction: "either", order: "value_desc", limit: 10 })) as NativeTransfersResult;
    // excludes the zero-value row; biggest first
    expect(r.transfers[0].salt).toBe("300000");
    expect(r.transfers.map((t) => t.grains)).not.toContain("0");
  });

  it("'about' 30k (±1%) matches 30000 and 30100 but not 3000 or 300000", async () => {
    const r = (await findNativeTransfers({
      minGrains: 29700n * G,
      maxGrains: 30300n * G,
      counterparty: A,
      direction: "either",
      limit: 10,
    })) as NativeTransfersResult;
    want(r, "30000", "30100");
  });

  it("atleast 10k from A (sent) returns only A's sends >= 10k", async () => {
    const r = (await findNativeTransfers({ minGrains: 10_000n * G, counterparty: A, direction: "sent", limit: 10 })) as NativeTransfersResult;
    want(r, "30000", "30100");
  });

  it("time window filters by timestamp", async () => {
    const r = (await findNativeTransfers({ fromTs: 1_000_050, toTs: 1_000_250, limit: 10 })) as NativeTransfersResult;
    // rows at ts 100 and 200 (values 30000, 300000)
    want(r, "30000", "300000");
  });

  it("reports coverage and excludes zero-value transfers", async () => {
    const r = (await findNativeTransfers({ counterparty: A, direction: "either", limit: 10 })) as NativeTransfersResult;
    expect(r.asset).toBe("SALT (native)");
    expect(r.coverage.maxHeight).toBeGreaterThanOrEqual(1004);
    expect(r.transfers.some((t) => t.salt === "0")).toBe(false);
  });
});
