import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import book from "@/generated/addresses.json";

/**
 * GET /api/contracts (contract directory) and the contract-name branch of
 * GET /api/search. The DB is swapped per test: null (unprovisioned → address
 * book), a recorder that returns indexed rows, or one that throws.
 */
const dbState = vi.hoisted(() => ({
  mode: "none" as "none" | "rows" | "throw",
  rows: [] as unknown[],
  calls: [] as { limit?: number; offset?: number }[],
}));

vi.mock("@/lib/db/client", () => ({
  getDb: () => {
    if (dbState.mode === "none") return null;
    const call: { limit?: number; offset?: number } = {};
    dbState.calls.push(call);
    const chain = {
      select: () => chain,
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: (n: number) => {
        call.limit = n;
        return chain;
      },
      offset: async (n: number) => {
        call.offset = n;
        if (dbState.mode === "throw") throw new Error("connection refused 10.0.0.5:25060");
        return dbState.rows;
      },
    };
    return chain;
  },
}));

import { GET } from "./route";
import { GET as SEARCH } from "../search/route";
import { contractsWhere, escapeLike } from "@/lib/indexer/contractSearch";

let ipSeq = 0;
// Distinct client IP per request so the shared public-read limiter never trips.
const req = (path: string) =>
  new Request(`http://x${path}`, { headers: { "x-forwarded-for": `198.51.100.${(ipSeq++ % 250) + 1}` } });

const MODEL_REGISTRY = book.contracts.ModelRegistry.toLowerCase();

describe("GET /api/contracts", () => {
  beforeEach(() => {
    dbState.mode = "none";
    dbState.rows = [];
    dbState.calls = [];
  });

  it("finds a contract by name from the address book when the index is unprovisioned", async () => {
    const res = await GET(req("/api/contracts?q=modelregistry"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("book");
    const hit = body.results.find((r: { name: string }) => r.name === "ModelRegistry");
    expect(hit).toMatchObject({ address: MODEL_REGISTRY, verified: false });
    expect(hit.creationTx).toMatch(/^0x[0-9a-f]{64}$/); // from the provenance ledger
  });

  it("finds by address prefix", async () => {
    const body = await (await GET(req(`/api/contracts?q=${MODEL_REGISTRY.slice(0, 12)}`))).json();
    expect(body.results.map((r: { address: string }) => r.address)).toContain(MODEL_REGISTRY);
  });

  it("paginates with limit/offset and nextOffset", async () => {
    const p1 = await (await GET(req("/api/contracts?limit=10"))).json();
    expect(p1.results).toHaveLength(10);
    expect(p1.nextOffset).toBe(10);
    const p2 = await (await GET(req("/api/contracts?limit=10&offset=10"))).json();
    expect(p2.results[0].address).not.toBe(p1.results[0].address);
    const last = await (await GET(req("/api/contracts?limit=100&offset=100"))).json();
    expect(last.nextOffset).toBeNull();
  });

  it("clamps limit to 100 and rejects non-numeric paging", async () => {
    const big = await (await GET(req("/api/contracts?limit=5000"))).json();
    expect(big.results.length).toBeLessThanOrEqual(100);
    expect((await GET(req("/api/contracts?limit=abc"))).status).toBe(400);
    expect((await GET(req("/api/contracts?offset=1e999"))).status).toBe(400);
  });

  it("serves the index when it has rows, fetching limit+1 to detect the next page", async () => {
    dbState.mode = "rows";
    dbState.rows = [
      { address: "0x01", name: "A", creationTx: "0xt1", verified: true },
      { address: "0x02", name: "B", creationTx: null, verified: false },
      { address: "0x03", name: null, creationTx: null, verified: false },
    ];
    const body = await (await GET(req("/api/contracts?q=x&limit=2&offset=4"))).json();
    expect(dbState.calls[0]).toEqual({ limit: 3, offset: 4 });
    expect(body).toMatchObject({ source: "index", nextOffset: 6 });
    expect(body.results).toEqual(dbState.rows.slice(0, 2));
  });

  it("falls back to the book when the index has no match yet, or errors (without leaking the error)", async () => {
    dbState.mode = "rows";
    const empty = await (await GET(req("/api/contracts?q=ModelRegistry"))).json();
    expect(empty.source).toBe("book");
    expect(empty.results.length).toBeGreaterThan(0);

    dbState.mode = "throw";
    const res = await GET(req("/api/contracts?q=ModelRegistry"));
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(text).source).toBe("book");
    expect(text).not.toContain("10.0.0.5");
  });
});

describe("contract search SQL", () => {
  const dialect = new PgDialect();
  it("escapes LIKE metacharacters so a query matches literally", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
    const q = dialect.sqlToQuery(contractsWhere("a%b")!);
    expect(q.sql).toContain('"contracts"."name" ilike $1');
    expect(q.params[0]).toBe("%a\\%b%");
  });
  it("matches an address prefix for hex-shaped queries (lowercased)", () => {
    const q = dialect.sqlToQuery(contractsWhere("0xABCD")!);
    expect(q.sql).toBe('"contracts"."address" ilike $1');
    expect(q.params).toEqual(["0xabcd%"]);
  });
  it("has no filter for an empty query", () => {
    expect(contractsWhere("")).toBeUndefined();
  });
});

describe("GET /api/search contract names", () => {
  beforeEach(() => {
    dbState.mode = "none";
  });

  it("resolves a contract name to the matching contracts", async () => {
    const body = await (await SEARCH(req("/api/search?q=ModelRegistry"))).json();
    expect(body.type).toBe("contracts");
    expect(body.results.map((r: { address: string }) => r.address)).toContain(MODEL_REGISTRY);
  });

  it("still hands natural language to the agent", async () => {
    const body = await (await SEARCH(req("/api/search?q=who%20deployed%20the%20most%20contracts"))).json();
    expect(body.type).toBe("nl");
  });

  it("hands an unknown single word to the agent", async () => {
    const body = await (await SEARCH(req("/api/search?q=zzqqxxnotacontract"))).json();
    expect(body.type).toBe("nl");
  });
});
