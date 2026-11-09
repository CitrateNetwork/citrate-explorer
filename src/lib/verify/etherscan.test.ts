import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { encodeAbiParameters } from "viem";
import { migratedPglite } from "@/lib/db/tests/pglite";
import type { ChainDb } from "@/lib/indexer/types";
import { contractAction, type ContractApiDeps, type EtherscanReply } from "./etherscan";
import { EIP1967_IMPL_SLOT } from "./proxy";
import { runOnce } from "./worker";
import { FORGE, fixtureChain, loadFixture, realCompiler, seedIndexedCreations } from "./tests/fixtures";

/**
 * EXP-S2 Etherscan `module=contract` actions: the `{status, message, result}`
 * envelope and the exact strings forge and hardhat-verify poll for, against
 * PGlite, the recorded anvil chain, and the real worker + solc.
 */
const forge = loadFixture("forge-etherscan");
const submitBody = (run: number) => forge.runs[run].requests.find((r) => r.method === "POST" && r.body.includes("verifysourcecode"))!.body;
const COUNTER_ARGS = encodeAbiParameters([{ type: "uint256" }, { type: "string" }], [7n, "citrate fixture"]).slice(2);

describe("Etherscan contract API (EXP-S2)", () => {
  let ctx: Awaited<ReturnType<typeof migratedPglite>>;
  let deps: ContractApiDeps;
  const chain = fixtureChain(forge, {
    storage: { [FORGE.plainB]: { [EIP1967_IMPL_SLOT]: "0x" + "0".repeat(24) + FORGE.counter.slice(2) } },
  });
  const compile = realCompiler();
  const call = (action: string, params: Record<string, string>, method: "GET" | "POST" = "GET"): Promise<EtherscanReply> =>
    contractAction(action, new URLSearchParams({ module: "contract", action, ...params }), method, deps);
  const work = async () => {
    while ((await runOnce({ db: deps.db!, chain, compile, similarScanLimit: 50 }, { workerId: "t" })) === "processed");
  };

  beforeAll(async () => {
    ctx = await migratedPglite();
    deps = { db: ctx.db as unknown as ChainDb, chain };
    await seedIndexedCreations(deps.db!, forge);
  });
  afterAll(async () => ctx.close());

  it("before verification: getabi says not verified, getsourcecode returns Etherscan's empty entry", async () => {
    expect(await call("getabi", { address: FORGE.counter })).toEqual({ status: "0", message: "NOTOK", result: "Contract source code not verified" });
    const src = await call("getsourcecode", { address: FORGE.counter });
    expect(src.status).toBe("1");
    expect(src.message).toBe("OK");
    expect((src.result as Array<Record<string, string>>)[0]).toMatchObject({ SourceCode: "", ABI: "Contract source code not verified", Proxy: "0" });
  });

  it("verifysourcecode needs POST", async () => {
    expect(await call("verifysourcecode", Object.fromEntries(new URLSearchParams(submitBody(0))))).toMatchObject({ status: "0", result: "verifysourcecode requires POST" });
  });

  it("submit -> 'Pending in queue' -> worker -> 'Pass - Verified'", async () => {
    const sub = await contractAction("verifysourcecode", new URLSearchParams(submitBody(0)), "POST", deps);
    expect(sub.status).toBe("1");
    expect(sub.message).toBe("OK");
    expect(sub.result).toMatch(/^[0-9a-f-]{36}$/);
    const guid = sub.result as string;
    expect(await call("checkverifystatus", { guid })).toEqual({ status: "0", message: "NOTOK", result: "Pending in queue" });
    await work();
    expect(await call("checkverifystatus", { guid })).toEqual({ status: "1", message: "OK", result: "Pass - Verified" });
  }, 120_000);

  it("after verification: getabi returns the ABI string; getsourcecode the Etherscan entry", async () => {
    const abi = await call("getabi", { address: FORGE.counter });
    expect(abi.status).toBe("1");
    expect(JSON.parse(abi.result as string).some((x: { name?: string }) => x.name === "label")).toBe(true);
    const [e] = (await call("getsourcecode", { address: FORGE.counter })).result as Array<Record<string, string>>;
    expect(e.SourceCode.startsWith("{{")).toBe(true);
    expect(JSON.parse(e.SourceCode.slice(1, -1)).language).toBe("Solidity");
    expect(e).toMatchObject({
      ContractName: "FixtureCounter",
      CompilerVersion: "v0.8.26+commit.8a97fa7a",
      OptimizationUsed: "1",
      Runs: "200",
      ConstructorArguments: COUNTER_ARGS,
      EVMVersion: "cancun",
      Library: `FixtureMath:${FORGE.library}`,
      LicenseType: "Apache-2.0",
      ContractFileName: "src/Fixture.sol",
      Proxy: "0",
      SimilarMatch: "",
    });
  });

  it("a second submission for a fully verified contract is refused with Etherscan's string", async () => {
    const r = await contractAction("verifysourcecode", new URLSearchParams(submitBody(0)), "POST", deps);
    expect(r).toEqual({ status: "0", message: "NOTOK", result: "Contract source code already verified" });
  });

  it("a non-matching source ends in exactly 'Fail - Unable to verify'", async () => {
    const p = new URLSearchParams(submitBody(2));
    p.set("sourceCode", p.get("sourceCode")!.replace("value = v;", "value = v + 1;"));
    const sub = await contractAction("verifysourcecode", p, "POST", deps);
    await work();
    expect(await call("checkverifystatus", { guid: sub.result as string })).toEqual({ status: "0", message: "NOTOK", result: "Fail - Unable to verify" });
  }, 120_000);

  it("verified FixturePlain is applied to the identical FixturePlain as a similar match", async () => {
    const sub = await contractAction("verifysourcecode", new URLSearchParams(submitBody(2)), "POST", deps);
    await work();
    expect((await call("checkverifystatus", { guid: sub.result as string })).result).toBe("Pass - Verified");
    const [e] = (await call("getsourcecode", { address: FORGE.plainB })).result as Array<Record<string, string>>;
    expect(e.ContractName).toBe("FixturePlain");
    expect(e.SimilarMatch).toBe(FORGE.plainA);
  }, 120_000);

  it("an address without code is refused at submission", async () => {
    const p = new URLSearchParams(submitBody(2));
    p.set("contractaddress", "0x" + "12".repeat(20));
    expect(await contractAction("verifysourcecode", p, "POST", deps)).toEqual({
      status: "0",
      message: "NOTOK",
      result: `Unable to locate ContractCode at 0x${"12".repeat(20)}`,
    });
  });

  it("refuses another chain id (Etherscan v2 chainid parameter)", async () => {
    const r = await call("getabi", { address: FORGE.counter, chainid: "1" });
    expect(r.status).toBe("0");
    expect(r.result).toMatch(/unsupported chainid/);
  });

  it("getcontractcreation returns the creator, tx and creation bytecode from the index", async () => {
    const r = await call("getcontractcreation", { contractaddresses: `${FORGE.counter},${FORGE.plainA}` });
    expect(r.status).toBe("1");
    const rows = r.result as Array<Record<string, string>>;
    expect(rows.map((x) => x.contractAddress)).toEqual([FORGE.counter, FORGE.plainA]);
    expect(rows[0]).toMatchObject({
      contractCreator: forge.chain.contracts[1].creationTx.from.toLowerCase(),
      txHash: forge.chain.contracts[1].creationTx.hash,
      blockNumber: "2",
      creationBytecode: forge.chain.contracts[1].creationTx.input.toLowerCase(),
    });
    expect(await call("getcontractcreation", { contractaddresses: "0x" + "12".repeat(20) })).toEqual({ status: "0", message: "No data found", result: null });
  });

  it("verifyproxycontract -> checkproxyverification -> getsourcecode shows the implementation", async () => {
    const sub = await call("verifyproxycontract", { address: FORGE.plainB }, "POST");
    expect(sub.status).toBe("1");
    expect(await call("checkproxyverification", { guid: sub.result as string })).toEqual({ status: "0", message: "NOTOK", result: "Pending in queue" });
    await work();
    expect(await call("checkproxyverification", { guid: sub.result as string })).toEqual({
      status: "1",
      message: "OK",
      result: `The proxy's (${FORGE.plainB}) implementation contract is found at ${FORGE.counter} and is successfully updated.`,
    });
    const [e] = (await call("getsourcecode", { address: FORGE.plainB })).result as Array<Record<string, string>>;
    expect(e).toMatchObject({ Proxy: "1", Implementation: FORGE.counter });
  });

  it("without a database every action says so in the envelope", async () => {
    const r = await contractAction("getabi", new URLSearchParams({ address: FORGE.counter }), "GET", { db: null, chain });
    expect(r.status).toBe("0");
    expect(r.result).toMatch(/no database/);
  });
});
