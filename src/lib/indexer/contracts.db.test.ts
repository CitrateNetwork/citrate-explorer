import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { inArray, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { contracts, transactions } from "@/lib/db/schema";
import { upsertContracts } from "./contracts";
import { seedBookLabels, type BookLabel } from "./contractLabels";
import { searchContracts } from "./contractSearch";

// DB-gated (CONTRACTS_DB_TEST=1; point DATABASE_URL at a throwaway, migrated
// Postgres — never prod). Exercises the real upsert / label / search SQL.
// Inserts and cleans up its own rows (addresses under the 0x00…ffc0 prefix).
const enabled = process.env.CONTRACTS_DB_TEST === "1";
const d = enabled ? describe : describe.skip;

const P = "0x00000000000000000000000000000000000ffc";
const A = `${P}a1`;
const B = `${P}b2`;
const C = `${P}c3`;
const TX = "0xffc0000000000000000000000000000000000000000000000000000000000001";
const label = (address: string, name: string, creationTx: string | null = null): BookLabel => ({
  address,
  name,
  section: "contracts",
  creationTx,
  creator: creationTx ? "0xdeployer" : null,
  kind: creationTx ? "CREATE2" : null,
});

d("contracts index (DB integration)", () => {
  const cleanup = async () => {
    const db = getDb();
    if (!db) return;
    await db.delete(contracts).where(inArray(contracts.address, [A, B, C]));
    await db.delete(transactions).where(eq(transactions.hash, TX));
  };
  beforeAll(async () => {
    const db = getDb();
    if (!db) throw new Error("CONTRACTS_DB_TEST=1 but no DATABASE_URL");
    await cleanup();
    await db.insert(transactions).values({ hash: TX, from: "0xdeployer", blockHeight: 1 });
  });
  afterAll(cleanup);

  it("upsert is idempotent and only fills null columns", async () => {
    const db = getDb()!;
    await upsertContracts(db, [{ address: A, name: null, creator: "0xc1", creationTx: TX, bytecodeHash: null }]);
    await upsertContracts(db, [{ address: A, name: "Later", creator: "0xother", creationTx: "0xother", bytecodeHash: "0xh" }]);
    await upsertContracts(db, [{ address: A, name: "Later2", creator: null, creationTx: null, bytecodeHash: "0xh2" }]);
    const [row] = await db.select().from(contracts).where(eq(contracts.address, A));
    expect(row).toMatchObject({ name: "Later", creator: "0xc1", creationTx: TX, bytecodeHash: "0xh", verified: false });
    const [tx] = await db.select().from(transactions).where(eq(transactions.hash, TX));
    expect(tx.createdContract).toBe(A);
  });

  it("book labels overwrite null/unverified names but never a verified one", async () => {
    const db = getDb()!;
    await db.insert(contracts).values({ address: B, name: "src/B.sol:Verified", verified: true });
    await db.insert(contracts).values({ address: C, name: "OldUnverified", verified: false });
    const warnings: string[] = [];
    const r = await seedBookLabels(db, {
      labels: [label(A, "BookA", "0xbooktx"), label(B, "BookB"), label(C, "BookC")],
      warn: (m) => warnings.push(m),
    });
    expect(r.conflicts.map((c) => c.address)).toEqual([B]);
    expect(warnings).toHaveLength(1);
    const rows = await db.select().from(contracts).where(inArray(contracts.address, [A, B, C]));
    const by = Object.fromEntries(rows.map((x) => [x.address, x]));
    expect(by[A].name).toBe("BookA"); // unverified "Later" → book name
    expect(by[A].creationTx).toBe(TX); // existing creation_tx kept
    expect(by[B].name).toBe("src/B.sol:Verified");
    expect(by[C].name).toBe("BookC");

    // Idempotent: a second seed changes nothing.
    const again = await seedBookLabels(db, {
      labels: [label(A, "BookA"), label(B, "BookB"), label(C, "BookC")],
      warn: () => {},
    });
    expect(again.unchanged).toBe(2);
  });

  it("searches by name substring (literal LIKE) and address prefix", async () => {
    const byName = await searchContracts({ q: "booka" });
    expect(byName.source).toBe("index");
    expect(byName.results.map((r) => r.address)).toEqual([A]);
    const byAddr = await searchContracts({ q: P });
    expect(byAddr.results.map((r) => r.address).sort()).toEqual([A, B, C]);
    const literal = await searchContracts({ q: "Book%" });
    expect(literal.results).toEqual([]); // "%" is matched literally, not as a wildcard
  });
});
