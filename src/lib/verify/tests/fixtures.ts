/**
 * Test-only (EXP-S2): recorded tool fixtures (src/lib/verify/__fixtures__/tools,
 * written by scripts/verify/capture-tool-fixtures.mjs from a real anvil deployment)
 * turned into a ChainReader, plus indexer seeding and the real sandboxed compiler.
 * Never imported by production code.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CITRATE_CHAIN_ID } from "@/lib/citrate/chain";
import { transactions } from "@/lib/db/schema";
import type { ChainDb } from "@/lib/indexer/types";
import type { ChainReader } from "../chain";
import { sandboxedCompiler, type Compiler } from "../sandbox";

export interface RecordedRequest {
  method: string;
  url: string;
  contentType: string | null;
  body: string;
}

export interface FixtureContract {
  address: string;
  code: string;
  creationTx: { hash: string; from: string; to: string | null; input: string; blockNumber: string; blockHash: string; timestamp: string };
  receipt: { contractAddress: string; status: string; blockNumber: string };
}

export interface ToolFixture {
  tool: string;
  protocol: "etherscan" | "sourcify-v2";
  command: string;
  chain: { chainId: number; genesisHash: string; contracts: FixtureContract[] };
  runs: Array<{ name: string; address: string; client?: string; requests: RecordedRequest[] }>;
}

export function loadFixture(name: "forge-etherscan" | "forge-sourcify" | "hardhat-etherscan" | "citrate-clients"): ToolFixture {
  return JSON.parse(readFileSync(join(__dirname, "..", "__fixtures__", "tools", `${name}.json`), "utf8")) as ToolFixture;
}

/** The Fixture.sol source the tools compiled. */
export function fixtureSource(): string {
  return readFileSync(join(__dirname, "..", "__fixtures__", "project", "src", "Fixture.sol"), "utf8");
}

export interface FixtureChainOptions {
  /** Extra storage words: address -> slot -> 32-byte word. */
  storage?: Record<string, Record<string, string>>;
  /** Extra code at addresses. */
  code?: Record<string, string>;
  genesisHash?: string;
}

/** A ChainReader that answers from the recorded anvil state. */
export function fixtureChain(f: ToolFixture, o: FixtureChainOptions = {}): ChainReader & { calls: string[] } {
  const byAddr = new Map(f.chain.contracts.map((c) => [c.address.toLowerCase(), c]));
  const byTx = new Map(f.chain.contracts.map((c) => [c.creationTx.hash.toLowerCase(), c]));
  const calls: string[] = [];
  return {
    calls,
    chainId: CITRATE_CHAIN_ID,
    async genesisHash() {
      calls.push("genesis");
      return (o.genesisHash ?? f.chain.genesisHash).toLowerCase();
    },
    async getCode(a) {
      calls.push(`code:${a.toLowerCase()}`);
      return (o.code?.[a.toLowerCase()] ?? byAddr.get(a.toLowerCase())?.code ?? "0x").toLowerCase();
    },
    async getTransaction(h) {
      const c = byTx.get(h.toLowerCase());
      if (!c) return null;
      const t = c.creationTx;
      return { hash: t.hash.toLowerCase(), from: t.from.toLowerCase(), to: t.to, input: t.input.toLowerCase(), blockNumber: t.blockNumber };
    },
    async getReceipt(h) {
      const c = byTx.get(h.toLowerCase());
      if (!c) return null;
      return { contractAddress: c.receipt.contractAddress.toLowerCase(), status: c.receipt.status, blockNumber: c.receipt.blockNumber };
    },
    async getStorageAt(a, slot) {
      return o.storage?.[a.toLowerCase()]?.[slot.toLowerCase()] ?? `0x${"0".repeat(64)}`;
    },
    async call() {
      throw new Error("execution reverted");
    },
  };
}

/** Insert the fixture's creation transactions the way the indexer records them. */
export async function seedIndexedCreations(db: ChainDb, f: ToolFixture, only?: string[]): Promise<void> {
  for (const c of f.chain.contracts) {
    if (only && !only.includes(c.address.toLowerCase())) continue;
    await db
      .insert(transactions)
      .values({
        hash: c.creationTx.hash.toLowerCase(),
        blockHash: c.creationTx.blockHash,
        blockHeight: Number(BigInt(c.creationTx.blockNumber)),
        from: c.creationTx.from.toLowerCase(),
        to: null,
        status: 1,
        createdContract: c.address.toLowerCase(),
        timestamp: Number(BigInt(c.creationTx.timestamp)),
      })
      .onConflictDoNothing();
  }
}

/**
 * The real compiler path: soljson from binaries.soliditylang.org, verified
 * against list.json's keccak256, cached under node_modules/.cache, compiled in
 * the capped child process. Needs network on the first run.
 */
export function realCompiler(): Compiler {
  process.env.CITRATE_SOLC_CACHE_DIR ??= join(__dirname, "..", "..", "..", "..", "node_modules", ".cache", "citrate-solc");
  return sandboxedCompiler({ timeoutMs: 120_000, memoryMb: 2048, maxOutputBytes: 64 * 1024 * 1024 });
}

export const FORGE = {
  library: "0x5fbdb2315678afecb367f032d93f642f64180aa3",
  counter: "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512",
  plainA: "0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0",
  plainB: "0xcf7ed3acca5a467e9e704c703e8d87f634fb0fc9",
} as const;
