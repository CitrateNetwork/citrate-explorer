/**
 * EXP-AGENT step 1: pin the behaviour of every tool that existed before the
 * contract tools landed (2026-11-07 inventory, docs/AGENT.md). Each existing
 * tool keeps its name, its input schema (snapshot), its audit-before-run order,
 * and the way it forwards arguments to its data source. If any of these change,
 * this file fails and the change has to be argued for.
 *
 * The data sources are replaced with recording fakes here (tests only) so each
 * tool's argument mapping is checked without a network.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

const { calls, rec } = vi.hoisted(() => {
  const calls: Array<[string, unknown[]]> = [];
  const rec =
    (name: string, ret: unknown = { ok: name }) =>
    (...args: unknown[]) => {
      calls.push([name, args]);
      return Promise.resolve(typeof ret === "function" ? (ret as (...a: unknown[]) => unknown)(...args) : ret);
    };
  return { calls, rec };
});

vi.mock("@/lib/ai/audit", () => ({ logToolCall: (...a: unknown[]) => rec("audit")(...a) }));
vi.mock("@/lib/harness/ops", () => ({
  getChainStatus: rec("getChainStatus"),
  getBlock: rec("getBlock"),
  getTransaction: rec("getTransaction"),
  getAddress: rec("getAddress"),
  getBalance: rec("getBalance"),
  getLogs: rec("getLogs"),
  exploreDag: rec("exploreDag"),
  dagOverview: rec("dagOverview"),
  isContract: rec("isContract", true),
  getContractCode: rec("getContractCode", { address: "0x1", isContract: true, sizeBytes: 3, bytecode: "0x" + "ab".repeat(100), codeHash: "0xh", label: null, note: "" }),
  getToken: rec("getToken", { symbol: "TKN", decimals: 6, standard: "erc20", label: null }),
  getGasOracle: rec("getGasOracle"),
  saltDistribution: rec("saltDistribution"),
  callView: rec("callView"),
  addressActivityLive: rec("addressActivityLive", { live: true }),
}));
vi.mock("@/lib/ai/synthesis/explainTransaction", () => ({ explainTransaction: rec("explainTransaction") }));
vi.mock("@/lib/indexer/repository", () => ({
  searchTransactions: rec("searchTransactions"),
  addressActivity: rec("addressActivity", { provisioned: false }),
  topHolders: rec("topHolders"),
  findNativeTransfers: rec("findNativeTransfers", { results: [] }),
  findTokenTransfers: rec("findTokenTransfers", { results: [] }),
}));
vi.mock("@/lib/verify/verifiedSource", () => ({
  MAX_SOURCE_CHARS_LIMIT: 400_000,
  getVerifiedSource: rec("getVerifiedSource"),
}));
vi.mock("@/lib/harness/agentSbt", () => ({
  agentSbtSource: () => "SRC",
  lookupAgent: rec("lookupAgent"),
}));

import { citrateTools, runLedger } from "./tools";

/** The 24 tools that existed on main f5c1ba3 (2026-11-07). */
export const PRESERVED_TOOLS = [
  "getChainStatus",
  "getBlock",
  "getTransaction",
  "explainTransaction",
  "getAddress",
  "getBalance",
  "isContract",
  "getLogs",
  "exploreDag",
  "searchTransactions",
  "addressActivity",
  "recentActivity",
  "topHolders",
  "getContractCode",
  "getVerifiedSource",
  "getToken",
  "callView",
  "describeContract",
  "citrateContracts",
  "getGasOracle",
  "findTransfers",
  "getAgent",
  "saltDistribution",
  "ledger",
] as const;

interface T {
  description: string;
  inputSchema: z.ZodType;
  execute: (a: unknown, o?: unknown) => Promise<unknown>;
}
const tools = () => citrateTools({ subject: "sub-1" }) as unknown as Record<string, T>;
const run = async (name: string, args: unknown) => {
  const t = tools()[name];
  return t.execute(t.inputSchema.parse(args));
};
const A = "0x00000000000000000000000000000000000000a1";
const H = "0x" + "11".repeat(32);

beforeEach(() => {
  calls.length = 0;
});

describe("preserved tools: names and schemas", () => {
  it("every pre-existing tool is still registered", () => {
    const names = Object.keys(tools());
    for (const n of PRESERVED_TOOLS) expect(names, n).toContain(n);
  });

  it.each(PRESERVED_TOOLS)("%s keeps its input schema", (name) => {
    const js = z.toJSONSchema(tools()[name].inputSchema, { target: "draft-7" });
    expect(js).toMatchSnapshot();
  });
});

describe("preserved tools: audit then run", () => {
  it("records the call to the audit log, under the subject, before the data source runs", async () => {
    await run("getBalance", { address: A });
    expect(calls[0]).toEqual(["audit", ["getBalance", { address: A }, "sub-1"]]);
    expect(calls[1]).toEqual(["getBalance", [A]]);
  });
});

describe("preserved tools: argument mapping", () => {
  it("getBlock: 'latest', a height and a hash", async () => {
    await run("getBlock", {});
    await run("getBlock", { ref: "123" });
    await run("getBlock", { ref: H });
    const got = calls.filter((c) => c[0] === "getBlock").map((c) => c[1][0]);
    expect(got).toEqual(["latest", 123, H]);
  });

  it("exploreDag: overview without a hash, a 10-deep walk with one", async () => {
    await run("exploreDag", {});
    await run("exploreDag", { blockHash: H });
    expect(calls.filter((c) => c[0] !== "audit").map((c) => c[0])).toEqual(["dagOverview", "exploreDag"]);
    expect(calls.find((c) => c[0] === "exploreDag")?.[1]).toEqual([H, 10]);
  });

  it("getLogs converts the block range to bigints", async () => {
    await run("getLogs", { address: A, fromBlock: 1, toBlock: 5 });
    expect(calls.find((c) => c[0] === "getLogs")?.[1]).toEqual([{ address: A, fromBlock: 1n, toBlock: 5n }]);
  });

  it("getContractCode strips the raw bytecode to a 42-char preview", async () => {
    const out = (await run("getContractCode", { address: A })) as Record<string, unknown>;
    expect(out.bytecode).toBeUndefined();
    expect(out.bytecodePreview).toBe(("0x" + "ab".repeat(100)).slice(0, 42) + "…");
  });

  it("addressActivity falls back to the live scan when the index is not provisioned", async () => {
    const out = await run("addressActivity", { address: A });
    expect(out).toEqual({ live: true });
  });

  it("recentActivity defaults to a 60-block window", async () => {
    await run("recentActivity", { address: A });
    expect(calls.find((c) => c[0] === "addressActivityLive")?.[1]).toEqual([A, 60]);
  });

  it("isContract wraps the boolean", async () => {
    expect(await run("isContract", { address: A })).toEqual({ address: A, isContract: true });
  });

  it("callView forwards address, signature and args", async () => {
    await run("callView", { address: A, signature: "balanceOf(address)", args: [A] });
    expect(calls.find((c) => c[0] === "callView")?.[1]).toEqual([A, "balanceOf(address)", [A]]);
  });

  it("findTransfers: native by default, order mapping, amount parsed", async () => {
    await run("findTransfers", { amount: "30k SALT", order: "recent" });
    const q = calls.find((c) => c[0] === "findNativeTransfers")?.[1][0] as Record<string, unknown>;
    expect(q.order).toBe("time_desc");
    expect(q.limit).toBe(10);
    expect(typeof q.minGrains).toBe("bigint");
  });

  it("findTransfers with a token reads its decimals and labels the asset", async () => {
    const out = (await run("findTransfers", { token: A, amount: "5" })) as { token: { symbol: string; decimals: number } };
    expect(out.token).toMatchObject({ symbol: "TKN", decimals: 6 });
    const q = calls.find((c) => c[0] === "findTokenTransfers")?.[1][0] as Record<string, unknown>;
    expect(q.minRaw).toBeDefined();
  });

  it("findTransfers returns a readable error for an unreadable amount", async () => {
    const out = (await run("findTransfers", { amount: "lots" })) as { error?: string };
    expect(out.error).toMatch(/couldn't read the amount/);
  });

  it("getAgent parses a decimal token id and reads the AgentSBT", async () => {
    await run("getAgent", { tokenId: "7" });
    expect(calls.find((c) => c[0] === "lookupAgent")?.[1]).toEqual(["SRC", 7n]);
  });

  it("getVerifiedSource forwards maxSourceChars", async () => {
    await run("getVerifiedSource", { address: A, maxSourceChars: 100 });
    expect(calls.find((c) => c[0] === "getVerifiedSource")?.[1]).toEqual([A, { maxSourceChars: 100 }]);
  });

  it("citrateContracts returns the overview and the catalog", async () => {
    const out = (await run("citrateContracts", {})) as { overview: string; contracts: unknown[] };
    expect(out.overview.length).toBeGreaterThan(20);
    expect(Array.isArray(out.contracts)).toBe(true);
  });

  it("describeContract answers known=false for a non-system address", async () => {
    const out = (await run("describeContract", { address: A })) as { known: boolean };
    expect(out.known).toBe(false);
  });

  it("ledger totals exactly in grains", () => {
    expect(runLedger([{ label: "a", salt: "1.5" }, { label: "b", salt: "-0.25" }, { label: "c", grains: "1" }])).toEqual({
      lines: [
        { label: "a", salt: "1.5", grains: "1500000000000000000" },
        { label: "b", salt: "-0.25", grains: "-250000000000000000" },
        { label: "c", salt: "0.000000000000000001", grains: "1" },
      ],
      totalSalt: "1.250000000000000001",
      totalGrains: "1250000000000000001",
    });
  });
});
