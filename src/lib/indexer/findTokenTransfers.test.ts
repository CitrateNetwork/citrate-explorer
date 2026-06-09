import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { tokenTransfers } from "@/lib/db/schema";
import { findTokenTransfers, tokenActivity, type TokenTransfersResult } from "./repository";

// DB-gated (RA2_DB_TEST=1; point DATABASE_URL at a throwaway Postgres — never prod).
// Verifies the token transfer SQL: amount range (NUMERIC), token scoping, direction,
// time window. Inserts + cleans up its own rows.
const enabled = process.env.RA2_DB_TEST === "1";
const d = enabled ? describe : describe.skip;

const TOKEN = "0x00000000000000000000000000000000000000ff";
const OTHER = "0x00000000000000000000000000000000000000ee";
const A = "0x000000000000000000000000000000000000aa01";
const B = "0x000000000000000000000000000000000000bb02";
const TAG = "0xra3tok";

// txHash, token, from, to, valueRaw, ts, standard
const ROWS: [string, string, string, string, string, number, string][] = [
  [`${TAG}1`, TOKEN, A, B, "1000", 2_000_000, "erc20"],
  [`${TAG}2`, TOKEN, A, B, "5000", 2_000_100, "erc20"],
  [`${TAG}3`, TOKEN, B, A, "9000", 2_000_200, "erc20"],
  [`${TAG}4`, OTHER, A, B, "5000", 2_000_300, "erc20"], // different token — excluded
];

d("findTokenTransfers (DB integration)", () => {
  beforeAll(async () => {
    const db = getDb();
    if (!db) throw new Error("RA2_DB_TEST=1 but no DATABASE_URL");
    let i = 0;
    for (const [hash, token, from, to, value, ts, standard] of ROWS) {
      await db
        .insert(tokenTransfers)
        .values({ txHash: hash, token, from, to, value, timestamp: ts, standard, logIndex: i++, blockHeight: i, blockHash: `${TAG}blk${i}` })
        .onConflictDoNothing();
    }
  });
  afterAll(async () => {
    const db = getDb();
    if (db) await db.delete(tokenTransfers).where(sql`${tokenTransfers.txHash} LIKE ${TAG + "%"}`);
  });

  it("scopes to the token and excludes others; orders by value desc", async () => {
    const r = (await findTokenTransfers({ token: TOKEN, order: "value_desc", limit: 10 })) as TokenTransfersResult;
    expect(r.transfers.map((t) => t.valueRaw)).toEqual(["9000", "5000", "1000"]);
  });

  it("amount range (raw) + direction filter", async () => {
    const r = (await findTokenTransfers({ token: TOKEN, minRaw: 4000n, counterparty: A, direction: "sent", limit: 10 })) as TokenTransfersResult;
    // A sent only the 5000 (the 9000 was B->A; the 1000 is below the floor)
    expect(r.transfers.map((t) => t.valueRaw)).toEqual(["5000"]);
  });

  it("time window filters by timestamp", async () => {
    const r = (await findTokenTransfers({ token: TOKEN, fromTs: 2_000_050, toTs: 2_000_150, limit: 10 })) as TokenTransfersResult;
    expect(r.transfers.map((t) => t.valueRaw)).toEqual(["5000"]);
  });

  it("tokenActivity counts the token's transfers + distinct parties", async () => {
    const a = await tokenActivity(TOKEN);
    if (a.provisioned) {
      expect(a.transfers).toBe(3);
      expect(a.senders).toBe(2);
    }
  });
});
