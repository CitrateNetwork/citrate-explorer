import { describe, it, expect, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { getContractAddress, keccak256, type Address, type Hex } from "viem";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/client";
import fixture from "./fixtures/arachnid-create2-membership-stake-vault.json";
import {
  ARACHNID_FACTORY,
  arachnidDeployAddress,
  contractCandidates,
  contractsUpsert,
  create2Address,
  parseArachnidInput,
  resolveCandidates,
  type ContractCandidate,
  type CreationReceipt,
} from "./contracts";
import { bookLabels } from "./contractLabels";

const ZERO32 = `0x${"0".repeat(64)}` as Hex;

describe("create2Address (EIP-1014)", () => {
  // The worked examples from the EIP-1014 specification.
  const vectors: [Hex, Hex, Hex, string][] = [
    ["0x0000000000000000000000000000000000000000", ZERO32, "0x00", "0x4D1A2e2bB4F88F0250f26Ffff098B0b30B26BF38"],
    ["0xdeadbeef00000000000000000000000000000000", ZERO32, "0x00", "0xB928f69Bb1D91Cd65274e3c79d8986362984fDA3"],
    [
      "0xdeadbeef00000000000000000000000000000000",
      "0x000000000000000000000000feed000000000000000000000000000000000000",
      "0x00",
      "0xD04116cDd17beBE565EB2422F2497E06cC1C9833",
    ],
    ["0x0000000000000000000000000000000000000000", ZERO32, "0xdeadbeef", "0x70f2b2914A2a4b783FaEFb75f459A580616Fcb5e"],
    [
      "0x00000000000000000000000000000000deadbeef",
      "0x00000000000000000000000000000000000000000000000000000000cafebabe",
      "0xdeadbeef",
      "0x60f3f640a8508fC6a86d45DF051962668E1e8AC7",
    ],
    [
      "0x00000000000000000000000000000000deadbeef",
      "0x00000000000000000000000000000000000000000000000000000000cafebabe",
      `0x${"deadbeef".repeat(11)}`,
      "0x1d8bfDC5D46DC4f61D6b6115972536eBE6A8854C",
    ],
    ["0x0000000000000000000000000000000000000000", ZERO32, "0x", "0xE33C0C7F7df4809055C3ebA6c09CFe4BaF1BD9e0"],
  ];

  it.each(vectors)("deployer %s salt %s initcode %s", (deployer, salt, init, expected) => {
    expect(create2Address(deployer, salt, init)).toBe(expected.toLowerCase());
  });

  it("agrees with viem's CREATE2 derivation for the Arachnid factory", () => {
    const salt = keccak256("0x01");
    const init = "0x6080604052348015600f57600080fd5b50" as Hex;
    expect(create2Address(ARACHNID_FACTORY, salt, init)).toBe(
      getContractAddress({ opcode: "CREATE2", from: ARACHNID_FACTORY as Address, salt, bytecode: init }).toLowerCase(),
    );
  });

  it("derives a real chain-40204 Arachnid deployment from its tx input", () => {
    // MembershipStakeVault: provenance-ledger CREATE2 tx; the receipt has no contractAddress.
    expect(fixture.tx.to).toBe(ARACHNID_FACTORY);
    expect(fixture.receipt.contractAddress).toBeNull();
    expect(arachnidDeployAddress(fixture.tx.input)).toBe(fixture.expectedAddress.toLowerCase());
    // …and the vendored book + provenance agree on the name and the tx.
    const label = bookLabels().find((l) => l.address === fixture.expectedAddress.toLowerCase());
    expect(label?.name).toBe("MembershipStakeVault");
    expect(label?.creationTx).toBe(fixture.tx.hash.toLowerCase());
    expect(label?.kind).toBe("CREATE2");
  });
});

describe("parseArachnidInput", () => {
  it("splits salt and initcode", () => {
    const p = parseArachnidInput(`0x${"11".repeat(32)}6080`);
    expect(p).toEqual({ salt: `0x${"11".repeat(32)}`, initCode: "0x6080" });
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty", "0x"],
    ["salt only (no initcode)", `0x${"11".repeat(32)}`],
    ["odd length", `0x${"11".repeat(32)}608`],
    ["not hex", `0x${"zz".repeat(40)}`],
    ["no 0x prefix", "11".repeat(40)],
  ])("rejects %s", (_label, input) => {
    expect(parseArachnidInput(input as string | null | undefined)).toBeNull();
    expect(arachnidDeployAddress(input as string | null | undefined)).toBeNull();
  });
});

const EOA = "0x00000000000000000000000000000000000000E0";
const CREATED = "0x00000000000000000000000000000000000000C1";
const create2Input = (n: number) => `0x${n.toString(16).padStart(64, "0")}6080604052`;

describe("contractCandidates", () => {
  const receipts = new Map<string, CreationReceipt>([
    ["0xaa01", { status: 1, contractAddress: CREATED }],
    ["0xaa02", { status: 1, contractAddress: null }],
    ["0xaa03", { status: 0, contractAddress: null }],
    ["0xaa04", { status: 1, contractAddress: null }],
    ["0xaa05", { status: 0, contractAddress: "0x00000000000000000000000000000000000000C2" }],
  ]);

  it("finds CREATE (receipt.contractAddress) and Arachnid CREATE2 (derived) deployments", () => {
    const out = contractCandidates(
      [
        { hash: "0xAA01", from: EOA, to: null, input: "0x6080" },
        { hash: "0xaa02", from: EOA, to: "0x4E59B44847B379578588920CA78FBF26C0B4956C", input: create2Input(1) },
        { hash: "0xaa04", from: EOA, to: "0x1111111111111111111111111111111111111111", input: create2Input(2) },
      ],
      receipts,
    );
    expect(out).toEqual([
      { address: CREATED.toLowerCase(), creator: EOA.toLowerCase(), creationTx: "0xaa01", kind: "CREATE" },
      {
        address: arachnidDeployAddress(create2Input(1)),
        creator: EOA.toLowerCase(),
        creationTx: "0xaa02",
        kind: "CREATE2",
      },
    ]);
  });

  it("drops reverted txs (no contract exists) for both paths", () => {
    const out = contractCandidates(
      [
        { hash: "0xaa03", from: EOA, to: ARACHNID_FACTORY, input: create2Input(3) },
        { hash: "0xaa05", from: EOA, to: null, input: "0x6080" },
      ],
      receipts,
    );
    expect(out).toEqual([]);
  });

  it("keeps a CREATE2 candidate whose receipt was unavailable (code check gates it)", () => {
    const out = contractCandidates([{ hash: "0xbb01", from: EOA, to: ARACHNID_FACTORY, input: create2Input(4) }], receipts);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("CREATE2");
  });

  it("deduplicates by address and ignores malformed txs", () => {
    const out = contractCandidates(
      [
        { hash: "0xbb02", from: EOA, to: ARACHNID_FACTORY, input: create2Input(5) },
        { hash: "0xbb03", from: EOA, to: ARACHNID_FACTORY, input: create2Input(5) },
        { hash: "0xbb04", from: EOA, to: ARACHNID_FACTORY, input: "0xnothex" },
        null as unknown as { hash: string; from: string },
      ],
      receipts,
    );
    expect(out.map((c) => c.creationTx)).toEqual(["0xbb02"]);
  });
});

describe("resolveCandidates", () => {
  const cand = (address: string, kind: "CREATE" | "CREATE2"): ContractCandidate => ({
    address,
    creator: EOA.toLowerCase(),
    creationTx: `0xtx-${address.slice(-2)}`,
    kind,
  });
  const A = "0x00000000000000000000000000000000000000a1";
  const B = "0x00000000000000000000000000000000000000b2";
  const C = "0x00000000000000000000000000000000000000c3";
  const D = "0x00000000000000000000000000000000000000d4";

  it("records code-bearing candidates with keccak256(runtime code) and the book name", async () => {
    const getCode = vi.fn(async (a: Address): Promise<Hex | undefined> => (a === A ? "0x6001" : "0x6002"));
    const rows = await resolveCandidates([cand(A, "CREATE"), cand(B, "CREATE2")], {
      getCode,
      nameFor: (a) => (a === B ? "SkillRegistry" : null),
    });
    expect(rows).toEqual([
      { address: A, name: null, creator: EOA.toLowerCase(), creationTx: "0xtx-a1", bytecodeHash: keccak256("0x6001") },
      { address: B, name: "SkillRegistry", creator: EOA.toLowerCase(), creationTx: "0xtx-b2", bytecodeHash: keccak256("0x6002") },
    ]);
    expect(getCode).toHaveBeenCalledTimes(2); // at most one getCode per candidate
  });

  it("drops a candidate with no code; on getCode failure keeps CREATE (hash null) but drops CREATE2", async () => {
    const warn = vi.fn();
    const rows = await resolveCandidates(
      [cand(A, "CREATE2"), cand(B, "CREATE"), cand(C, "CREATE2"), cand(D, "CREATE")],
      {
        getCode: async (a) => {
          if (a === A) return "0x";
          if (a === B) return undefined;
          throw new Error("rpc down");
        },
        warn,
      },
    );
    expect(rows).toEqual([{ address: D, name: null, creator: EOA.toLowerCase(), creationTx: "0xtx-d4", bytecodeHash: null }]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("bounds getCode concurrency", async () => {
    let inFlight = 0;
    let peak = 0;
    const many = Array.from({ length: 12 }, (_, i) => cand(`0x${(i + 1).toString(16).padStart(40, "0")}`, "CREATE"));
    await resolveCandidates(many, {
      concurrency: 3,
      getCode: async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 2));
        inFlight--;
        return "0x01";
      },
    });
    expect(peak).toBeLessThanOrEqual(3);
  });
});

describe("contractsUpsert SQL", () => {
  it("is an idempotent upsert that only fills null indexer-owned columns", () => {
    const db = drizzle.mock({ schema }) as unknown as Database;
    const q = contractsUpsert(db, [
      { address: "0xABC", name: "X", creator: "0xc", creationTx: "0xt", bytecodeHash: "0xh" },
    ]).toSQL();
    expect(q.sql).toContain('insert into "contracts"');
    expect(q.sql).toContain('on conflict ("address") do update set');
    for (const col of ["name", "creator", "creation_tx", "bytecode_hash"]) {
      expect(q.sql).toContain(`"${col}" = coalesce("contracts"."${col}", excluded.${col})`);
    }
    // The verify flow owns these: the indexer never overwrites them.
    expect(q.sql).not.toMatch(/"verified" =|"compiler_version" =|"proxy_impl" =/);
    expect(q.params).toContain("0xabc"); // addresses are stored lowercase
  });
});
