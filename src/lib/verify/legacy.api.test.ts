import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { migratedPglite } from "@/lib/db/tests/pglite";
import { contractVerifications } from "@/lib/db/schema";
import type { ChainDb } from "@/lib/indexer/types";
import type { ChainReader } from "./chain";
import { contractAction, NOT_VERIFIED, PASS } from "./etherscan";
import { sourcifyContract, sourcifyJob } from "./sourcify";
import { FORGE, fixtureChain, loadFixture } from "./tests/fixtures";

/**
 * Records copied forward from the v1 store (migration 0006) are not confirmed for the code at
 * the address now. Every machine-readable door treats them as not verified:
 *   - Etherscan getabi / getsourcecode: "Contract source code not verified", like no record;
 *   - Etherscan checkverifystatus and GET /api/verify/{guid} for an old guid: never "Pass";
 *   - Sourcify GET /v2/contract: 404 not_found; GET /v2/verify/{id}: completed, no match.
 * The human contract page still shows the legacy source, labelled (infoSources.ts).
 */
const holder: { db: ChainDb | null; chain: ChainReader | null } = { db: null, chain: null };
vi.mock("@/lib/verify/deps", () => ({ verifyDeps: () => ({ db: holder.db, chain: holder.chain }) }));

import { GET as verifyGuid } from "@/app/api/verify/[guid]/route";
import { GET as contractRecord } from "@/app/api/contract/[addr]/verified/route";

const f = loadFixture("forge-etherscan");
const MIGRATION = readFileSync(join(__dirname, "..", "db", "migrations", "0006_verification_v2.sql"), "utf8");
/** The copy-forward statements of 0006, as the runbook re-runs them. */
const COPY_FORWARD = MIGRATION.slice(MIGRATION.indexOf("-- Carry contract_verifications forward"))
  .split("--> statement-breakpoint")
  .filter((s) => s.trim());

describe("records copied forward from v1 are not verified on any machine-readable API", () => {
  let ctx: Awaited<ReturnType<typeof migratedPglite>>;
  const deps = () => ({ db: holder.db!, chain: holder.chain! });
  const call = (action: string, p: Record<string, string>) => contractAction(action, new URLSearchParams(p), "GET", deps());

  beforeAll(async () => {
    ctx = await migratedPglite();
  });
  afterAll(async () => ctx.close());
  beforeEach(async () => {
    await ctx.truncateAll();
    holder.db = ctx.db as unknown as ChainDb;
    holder.chain = fixtureChain(f);
    // A passing v1 row for a live contract, full match, with source and ABI, carried forward.
    await holder.db.insert(contractVerifications).values({
      guid: "v1guid0001",
      address: FORGE.counter,
      status: "pass",
      matchType: "full",
      contractName: "src/Fixture.sol:FixtureCounter",
      compilerVersion: "v0.8.26+commit.8a97fa7a",
      source: "contract FixtureCounter {}",
      abi: '[{"type":"function","name":"bump","inputs":[],"outputs":[],"stateMutability":"nonpayable"}]',
      submittedAt: new Date(),
      verifiedAt: new Date(),
    });
    for (const stmt of COPY_FORWARD) await ctx.client.exec(stmt);
  });

  it("the copy-forward made a legacy full record and a passing legacy job (the setup under test)", async () => {
    const { rows } = await ctx.client.query<{ match_type: string; genesis_hash: string | null }>("select match_type, genesis_hash from verified_contracts");
    expect(rows).toEqual([{ match_type: "full", genesis_hash: null }]);
  });

  it("Etherscan getabi: not verified", async () => {
    expect(await call("getabi", { address: FORGE.counter })).toEqual({ status: "0", message: "NOTOK", result: NOT_VERIFIED });
  });

  it("Etherscan getsourcecode: the empty not-verified entry, no source or ABI", async () => {
    const r = await call("getsourcecode", { address: FORGE.counter });
    const [e] = r.result as Array<Record<string, string>>;
    expect(e.SourceCode).toBe("");
    expect(e.ABI).toBe(NOT_VERIFIED);
    expect(e.ContractName).toBe("");
  });

  it("Etherscan checkverifystatus on the old guid is not a pass", async () => {
    const r = await call("checkverifystatus", { guid: "v1guid0001" });
    expect(r.status).toBe("0");
    expect(r.result).not.toBe(PASS);
    expect(String(r.result)).toMatch(/not confirmed/i);
    expect(String(r.result)).not.toMatch(/already verified|pending|rate limit/i);
  });

  it("GET /api/verify/{guid} for the old guid is not a pass", async () => {
    const res = await verifyGuid(new Request("https://explorer.citrate.ai/api/verify/v1guid0001", { headers: { "x-forwarded-for": "203.0.113.90" } }), {
      params: Promise.resolve({ guid: "v1guid0001" }),
    });
    const body = (await res.json()) as { status: string; matchType: string | null; message: string };
    expect(body.status).toBe("fail");
    expect(body.matchType).toBeNull();
    expect(body.message).toMatch(/not confirmed/i);
  });

  it("GET /api/contract/{a}/verified (the contract page's record): legacy, not verified, no match types; source kept", async () => {
    const res = await contractRecord(new Request(`https://explorer.citrate.ai/api/contract/${FORGE.counter}/verified`, { headers: { "x-forwarded-for": "203.0.113.91" } }), {
      params: Promise.resolve({ addr: FORGE.counter }),
    });
    const body = (await res.json()) as { record: Record<string, unknown> | null };
    expect(body.record).toMatchObject({ legacy: true, verified: false, matchType: null, runtimeMatch: null, creationMatch: null, legacySource: "contract FixtureCounter {}" });
  });

  it("Sourcify GET /v2/contract: 404 not_found", async () => {
    const r = await sourcifyContract(deps(), "40204", FORGE.counter, "all");
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ customCode: "not_found" });
  });

  it("Sourcify GET /v2/verify/{id} for the old guid: completed with no match and an error", async () => {
    const r = await sourcifyJob(deps(), "v1guid0001");
    expect(r.status).toBe(200);
    const body = r.body as { isJobCompleted: boolean; contract: { match: unknown; runtimeMatch: unknown }; error?: { customCode: string } };
    expect(body.isJobCompleted).toBe(true);
    expect(body.contract.match).toBeNull();
    expect(body.contract.runtimeMatch).toBeNull();
    expect(body.error?.customCode).toBe("legacy_unconfirmed");
  });
});
