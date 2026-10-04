import { describe, it, expect, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/client";
import book from "@/generated/addresses.json";
import provenance from "@/generated/addresses.provenance.json";
import {
  bookLabels,
  bookNameFor,
  deriveBookLabels,
  labelsUpsert,
  planLabelUpserts,
  seedBookLabels,
  type BookLabel,
} from "./contractLabels";

const ADDRESS_RE = /^0x[0-9a-f]{40}$/;

describe("vendored 40204 address book → labels", () => {
  const labels = bookLabels();

  it("labels every deployed-contract section, one name per address", () => {
    // Distinct addresses across the labelled sections (the top-level
    // CitrateMemberSBT / MembershipStakeVault keys repeat `contracts` entries).
    const expected = new Set(
      [
        ...Object.values(book.contracts),
        ...Object.values(book.aaStack),
        ...Object.values(book.genesis),
        book.governance.GOVERNANCE,
        book.governance.GUARDIAN,
        book.CitrateMemberSBT,
        book.MembershipStakeVault,
      ].map((a) => a.toLowerCase()),
    ).size;
    expect(labels).toHaveLength(expected);
    expect(new Set(labels.map((l) => l.address)).size).toBe(labels.length);
    for (const l of labels) expect(l.address).toMatch(ADDRESS_RE);
    expect(bookNameFor(book.contracts.ModelRegistry)).toBe("ModelRegistry");
    expect(bookNameFor(book.governance.GOVERNANCE.toUpperCase().replace("0X", "0x"))).toBe("GOVERNANCE");
    expect(bookNameFor(book.CitrateMemberSBT)).toBe("CitrateMemberSBT");
  });

  it("does not label precompiles or the deployer EOA", () => {
    for (const addr of Object.values(book.precompiles)) expect(bookNameFor(addr)).toBeNull();
    expect(bookNameFor(book.deployer)).toBeNull();
  });

  it("agrees with the provenance ledger: every canonical named entry is the book's address", () => {
    const sections = book as unknown as Record<string, Record<string, string> | string>;
    const canonical = provenance.ledger.filter(
      (e) => e.status === "canonical" && (e.kind === "CREATE" || e.kind === "CREATE2") && e.name,
    );
    expect(canonical.length).toBeGreaterThan(90);
    for (const e of canonical) {
      const section = sections[e.section as string];
      const bookAddr = typeof section === "object" ? section[e.name as string] : sections[e.name as string];
      expect(String(bookAddr).toLowerCase(), `${e.section}.${e.name}`).toBe(String(e.address).toLowerCase());
      const label = labels.find((l) => l.address === String(e.address).toLowerCase());
      expect(label?.creationTx).toBe(String(e.tx).toLowerCase());
      expect(label?.creator).toBe(provenance.deployer.toLowerCase());
    }
  });

  it("never labels an orphan (superseded) deployment", () => {
    for (const e of provenance.ledger.filter((x) => x.status === "orphan")) {
      expect(bookNameFor(String(e.address))).toBeNull();
    }
  });
});

describe("deriveBookLabels", () => {
  const A = "0x00000000000000000000000000000000000000Aa";
  it("rejects one address under two names", () => {
    expect(() => deriveBookLabels({ contracts: { X: A, Y: A } }, { ledger: [] })).toThrow(/twice/);
  });
  it("tolerates the same name repeated across sections and skips non-addresses", () => {
    const out = deriveBookLabels({ contracts: { X: A, Bad: "nope" }, aaStack: { X: A }, comment: "hi" }, { ledger: [] });
    expect(out).toEqual([{ address: A.toLowerCase(), name: "X", section: "contracts", creationTx: null, creator: null, kind: null }]);
  });
});

const label = (address: string, name: string): BookLabel => ({
  address,
  name,
  section: "contracts",
  creationTx: null,
  creator: null,
  kind: null,
});

describe("planLabelUpserts", () => {
  it("book wins over missing/null/unverified names, keeps verified names, reports the conflict", () => {
    const plan = planLabelUpserts(
      [label("0xa1", "New"), label("0xa2", "Null"), label("0xa3", "Book"), label("0xa4", "Book"), label("0xa5", "Same")],
      [
        { address: "0xa2", name: null, verified: false },
        { address: "0xa3", name: "OldUnverified", verified: false },
        { address: "0xa4", name: "src/X.sol:Verified", verified: true },
        { address: "0xa5", name: "Same", verified: true },
      ],
    );
    expect(plan.rename.map((l) => l.address)).toEqual(["0xa1", "0xa2", "0xa3"]);
    expect(plan.conflicts).toEqual([{ address: "0xa4", bookName: "Book", verifiedName: "src/X.sol:Verified" }]);
    expect(plan.unchanged.map((l) => l.address)).toEqual(["0xa5"]);
  });
});

describe("labelsUpsert SQL", () => {
  it("guards a verified name in SQL and only fills null creation_tx/creator", () => {
    const db = drizzle.mock({ schema }) as unknown as Database;
    const q = labelsUpsert(db, [label("0xa1", "X")]).toSQL().sql;
    expect(q).toContain('on conflict ("address") do update set');
    expect(q).toContain(
      '"name" = case when "contracts"."verified" and "contracts"."name" is not null then "contracts"."name" else excluded.name end',
    );
    expect(q).toContain('"creation_tx" = coalesce("contracts"."creation_tx", excluded.creation_tx)');
    expect(q).toContain('"creator" = coalesce("contracts"."creator", excluded.creator)');
  });
});

describe("seedBookLabels", () => {
  function recordingDb(existing: { address: string; name: string | null; verified: boolean }[]) {
    const writes: unknown[] = [];
    const selectChain = { from: () => selectChain, where: async () => existing };
    const insertChain = {
      values: (v: unknown) => {
        writes.push(v);
        return insertChain;
      },
      onConflictDoUpdate: async () => [],
    };
    const db = { select: () => selectChain, insert: () => insertChain } as unknown as Database;
    return { db, writes };
  }

  it("reads once, writes every label in one batch, and logs verified-name conflicts", async () => {
    const { db, writes } = recordingDb([{ address: "0xa2", name: "src/V.sol:V", verified: true }]);
    const warn = vi.fn();
    const r = await seedBookLabels(db, { labels: [label("0xa1", "A"), label("0xa2", "B")], warn });
    expect(writes).toHaveLength(1);
    expect((writes[0] as unknown[]).length).toBe(2);
    expect(r).toMatchObject({ total: 2, renamed: 1, unchanged: 0, dryRun: false });
    expect(r.conflicts).toEqual([{ address: "0xa2", bookName: "B", verifiedName: "src/V.sol:V" }]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("keeping the verified name"));
  });

  it("dry run plans without writing", async () => {
    const { db, writes } = recordingDb([]);
    const r = await seedBookLabels(db, { labels: [label("0xa1", "A")], dryRun: true, warn: () => {} });
    expect(writes).toHaveLength(0);
    expect(r).toMatchObject({ total: 1, renamed: 1, dryRun: true });
  });
});

describe("scripts/sync-addresses.mjs (the vendoring generator)", () => {
  const SCRIPT = resolve(__dirname, "../../../scripts/sync-addresses.mjs");
  const GENERATED = resolve(__dirname, "../../generated");

  /** A throwaway citrate-chain checkout whose canonical files equal our vendored copies. */
  function fakeChain() {
    const dir = mkdtempSync(join(tmpdir(), "chain-"));
    const addrDir = join(dir, "contracts", "addresses");
    mkdirSync(addrDir, { recursive: true });
    cpSync(join(GENERATED, "addresses.json"), join(addrDir, "40204.json"));
    cpSync(join(GENERATED, "addresses.provenance.json"), join(addrDir, "40204.provenance.json"));
    return { dir, addrDir };
  }
  const run = (chainDir: string, args: string[], vendoredDir?: string) =>
    spawnSync(process.execPath, [SCRIPT, ...args], {
      env: { ...process.env, CITRATE_CHAIN_DIR: chainDir, ...(vendoredDir ? { VENDORED_DIR: vendoredDir } : {}) },
      encoding: "utf8",
    });

  it("--check passes when the vendored copies match the canonical", () => {
    const { dir } = fakeChain();
    const r = run(dir, ["--check"]);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it("--check fails when the canonical provenance moved on", () => {
    const { dir, addrDir } = fakeChain();
    const p = JSON.parse(readFileSync(join(addrDir, "40204.provenance.json"), "utf8"));
    p.ledger[0].block += 1;
    writeFileSync(join(addrDir, "40204.provenance.json"), JSON.stringify(p));
    expect(run(dir, ["--check"]).status).toBe(1);
  });

  it("regenerates byte-identical vendored files", () => {
    const { dir } = fakeChain();
    const out = mkdtempSync(join(tmpdir(), "vendored-"));
    expect(run(dir, [], out).status).toBe(0);
    for (const f of ["addresses.json", "addresses.provenance.json"]) {
      expect(readFileSync(join(out, f), "utf8")).toBe(readFileSync(join(GENERATED, f), "utf8"));
    }
  });

  it("refuses a malformed provenance ledger", () => {
    const { dir, addrDir } = fakeChain();
    writeFileSync(join(addrDir, "40204.provenance.json"), JSON.stringify({ chainId: 40204, ledger: [{ kind: "CREATE2", tx: "0x1", address: "0x2" }] }));
    const out = mkdtempSync(join(tmpdir(), "vendored-"));
    expect(run(dir, [], out).status).toBe(1);
  });
});
