/**
 * EXP-S1 RPC load: the indexer fetched receipts one HTTP request per
 * transaction. The Citrate node accepts JSON-RPC batches (jsonrpc_core; at most
 * 100 calls per batch, core/api/src/rpc_limits.rs MAX_BATCH_SIZE), so the
 * indexer now sends a block's receipts in batches. Tested against a local HTTP
 * JSON-RPC server that serves one block and counts requests.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { migratedPglite } from "@/lib/db/tests/pglite";
import { receipts } from "@/lib/db/schema";
import { buildHarnessClient } from "@/lib/harness/client";
import { ingestBlock, liveChainSource, rpcBatchSize } from "./ingest";

const N_TX = 30;
const h32 = (n: number) => "0x" + n.toString(16).padStart(64, "0");
const BLOCK = h32(0xb10c);
const txs = Array.from({ length: N_TX }, (_, i) => ({
  hash: h32(0x1000 + i),
  from: "0x" + "11".repeat(20),
  to: "0x" + "22".repeat(20),
  value: "0x1",
  nonce: `0x${i.toString(16)}`,
  gas: "0x5208",
  gasPrice: "0x1",
  input: "0x",
  transactionIndex: `0x${i.toString(16)}`,
  type: "0x0",
  blockHash: BLOCK,
  blockNumber: "0x5",
}));

type Call = { id: number; method: string; params: unknown[] };
let posts: number[] = []; // calls per POST
let server: Server;
let url: string;

function answer(c: Call) {
  switch (c.method) {
    case "eth_getBlockByNumber":
      return {
        hash: BLOCK,
        number: "0x5",
        timestamp: "0x6553f105",
        parentHash: h32(1),
        blueScore: "0x5",
        transactions: txs,
      };
    case "citrate_getDagStats":
      return { maxBlueScore: 5, ghostdagParams: { finalityDepth: 100 } };
    case "eth_getTransactionReceipt": {
      const t = txs.find((x) => x.hash === c.params[0]);
      return {
        transactionHash: t!.hash,
        transactionIndex: t!.transactionIndex,
        blockHash: BLOCK,
        blockNumber: "0x5",
        from: t!.from,
        to: t!.to,
        cumulativeGasUsed: "0x5208",
        gasUsed: "0x5208",
        effectiveGasPrice: "0x1",
        contractAddress: null,
        logs: [],
        logsBloom: "0x" + "00".repeat(256),
        status: "0x1",
        type: "0x0",
      };
    }
    default:
      return null;
  }
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const parsed = JSON.parse(body) as Call | Call[];
      const calls = Array.isArray(parsed) ? parsed : [parsed];
      posts.push(calls.length);
      const out = calls.map((c) => ({ jsonrpc: "2.0", id: c.id, result: answer(c) }));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(Array.isArray(parsed) ? out : out[0]));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

type Ctx = Awaited<ReturnType<typeof migratedPglite>>;
let ctx: Ctx;
beforeAll(async () => {
  ctx = await migratedPglite();
}, 60_000);
beforeEach(async () => {
  await ctx.truncateAll();
  posts = [];
});
afterAll(async () => {
  await ctx.close();
});

describe("receipts are fetched in JSON-RPC batches", () => {
  it("a 30-tx block costs one receipt POST at batch size 50", async () => {
    const client = buildHarnessClient({ primary: url, batchSize: 50 });
    const res = await ingestBlock(5, { db: ctx.db, source: liveChainSource(client, 50) });
    expect(res).toMatchObject({ persisted: true, txCount: N_TX });
    expect(await ctx.db.select().from(receipts)).toHaveLength(N_TX);
    const receiptPosts = posts.filter((n) => n > 1);
    expect(receiptPosts).toEqual([N_TX]);
    expect(posts.length).toBeLessThanOrEqual(3); // block + stats + one receipt batch
  });

  it("never exceeds the batch size (chunks of 8 for 30 receipts)", async () => {
    const client = buildHarnessClient({ primary: url, batchSize: 8 });
    await ingestBlock(5, { db: ctx.db, source: liveChainSource(client, 8) });
    expect(Math.max(...posts)).toBeLessThanOrEqual(8);
    expect(posts.reduce((a, b) => a + b, 0)).toBe(N_TX + 2);
  });
});

describe("rpcBatchSize", () => {
  it("defaults to 50 and stays within the node's 100-call limit", () => {
    expect(rpcBatchSize({})).toBe(50);
    expect(rpcBatchSize({ INDEXER_RPC_BATCH: "500" })).toBe(100);
    expect(rpcBatchSize({ INDEXER_RPC_BATCH: "1" })).toBe(1);
    expect(rpcBatchSize({ INDEXER_RPC_BATCH: "0" })).toBe(1);
    expect(rpcBatchSize({ INDEXER_RPC_BATCH: "junk" })).toBe(50);
  });
});
