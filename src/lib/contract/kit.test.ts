import { describe, expect, it, vi } from "vitest";
import { encodeErrorResult, encodeFunctionData, encodeFunctionResult, pad, parseAbi, type Abi, type Hex } from "viem";
import { memoryReader } from "./testReader.testutil";
import { EIP1967_IMPLEMENTATION_SLOT } from "./proxy";
import { approveWrite, executeWrite, prepareWrite, rawCall, readCall, resolveAbi, supportsHistoricalState, type WriteExecutor } from "./kit";
import type { ContractInfo, ContractInfoSource } from "./types";
import fixture from "./__fixtures__/registry.json";

const abi = fixture.abi as Abi;
const C = "0x1111111111111111111111111111111111111111";
const IMPL = "0x2222222222222222222222222222222222222222";
const USER = "0x000000000000000000000000000000000000dEaD";
const CODE = fixture.runtimeBytecode as Hex;

function info(over: Partial<ContractInfo> = {}): ContractInfo {
  return {
    address: C,
    status: "unverified",
    verified: false,
    matchType: null,
    contractName: null,
    compilerVersion: null,
    abi: null,
    sources: [],
    sourceIndexById: null,
    deployedSourceMap: null,
    settings: null,
    runtimeMatch: null,
    creationMatch: null,
    constructorArgs: null,
    verifiedAt: null,
    note: "",
    origin: "api-source-v1",
    ...over,
  };
}

function infoSource(map: Record<string, ContractInfo>): ContractInfoSource {
  return { origin: "api-source-v1", load: async (a) => map[a.toLowerCase()] ?? info({ address: a }) };
}

const verified = info({ status: "verified", verified: true, matchType: "full", contractName: "Registry", abi });
const activated = { hasUserActivation: () => true };

describe("kit.resolveAbi", () => {
  it("uses the verified ABI first", async () => {
    const r = await resolveAbi({ address: C, reader: memoryReader({ code: { [C]: CODE } }), info: infoSource({ [C]: verified }) });
    expect(r.abiSource).toBe("verified");
    expect(r.abi).toBe(abi);
    expect(r.proxy).toBeNull();
  });

  it("uses the implementation's verified ABI for a proxy", async () => {
    const reader = memoryReader({
      code: { [C]: "0x6080" as Hex, [IMPL]: CODE },
      storage: { [C]: { [EIP1967_IMPLEMENTATION_SLOT]: pad(IMPL, { size: 32 }) } },
    });
    const r = await resolveAbi({ address: C, reader, info: infoSource({ [IMPL]: { ...verified, address: IMPL } }) });
    expect(r.abiSource).toBe("proxy-implementation");
    expect(r.proxy?.implementation).toBe("0x2222222222222222222222222222222222222222");
    expect(r.abi).toBe(abi);
  });

  it("falls back to the signature subset for unverified code", async () => {
    const r = await resolveAbi({ address: C, reader: memoryReader({ code: { [C]: CODE } }), info: infoSource({}) });
    expect(r.abiSource).toBe("signature-subset");
    expect(r.abi.some((x) => x.type === "function" && x.name === "owner")).toBe(true);
    expect(r.guess?.functions).toHaveLength(9);
  });

  it("reports no code", async () => {
    const r = await resolveAbi({ address: C, reader: memoryReader({}), info: infoSource({}) });
    expect(r.abiSource).toBe("none");
    expect(r.hasCode).toBe(false);
  });
});

describe("kit.readCall", () => {
  it("encodes, calls and decodes", async () => {
    const ret = encodeFunctionResult({ abi, functionName: "fee", result: 7n });
    const reader = memoryReader({ calls: [{ to: C, data: "0xddca3f43", result: ret }] });
    const r = await readCall({ reader, address: C, abi, fn: "fee", args: [] });
    expect(r).toMatchObject({ ok: true, decoded: [7n], display: ["7"], calldata: "0xddca3f43" });
  });

  it("returns a decoded revert reason", async () => {
    const e = Object.assign(new Error("reverted"), { data: encodeErrorResult({ abi, errorName: "NotOwner" }) });
    const reader = memoryReader({ calls: [{ to: C, data: "0x69fe0e2d", result: e }] });
    const r = await readCall({ reader, address: C, abi, fn: "setFee", args: [1n] });
    expect(r).toMatchObject({ ok: false, revert: { kind: "custom", name: "NotOwner" } });
  });

  it("refuses a historical block the node cannot serve, with the node's reason", async () => {
    const r = await readCall({ reader: memoryReader({}), address: C, abi, fn: "fee", args: [], block: 10n });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/historical state not available/);
  });

  it("feature-detects historical state", async () => {
    expect(await supportsHistoricalState(memoryReader({ head: 900n }), C)).toEqual({ supported: false, reason: expect.stringMatching(/historical/) });
    expect(await supportsHistoricalState(memoryReader({ head: 900n, historical: true }), C)).toEqual({ supported: true, reason: null });
  });
});

describe("kit.prepareWrite", () => {
  it("builds calldata, value, simulation, gas and payable risk for a payable call", async () => {
    const reader = memoryReader({ calls: [{ to: C, data: "0xf2c298be", result: "0x" }], gas: 61_000n });
    const p = await prepareWrite({ reader, address: C, abi, abiSource: "verified", fn: "register", args: ["harbor"], value: 10n, from: USER });
    expect(p.to).toBe(C);
    expect(p.data).toBe(encodeFunctionData({ abi, functionName: "register", args: ["harbor"] }));
    expect(p.value).toBe(10n);
    expect(p.method).toMatchObject({ name: "register", signature: "register(string)", selector: "0xf2c298be", stateMutability: "payable" });
    expect(p.args).toEqual([{ name: "name", type: "string", value: "harbor", display: "harbor" }]);
    expect(p.simulation).toEqual({ status: "ok", returnData: "0x" });
    expect(p.gas).toEqual({ estimate: 61_000n, error: null });
    expect(p.risks.map((r) => r.code)).toContain("payable");
    expect(p.risks.map((r) => r.code)).toContain("value-transfer");
    expect(p.gasless.eligible).toBe(false);
    expect(Object.isFrozen(p)).toBe(true);
  });

  it("rejects value on a non-payable function", async () => {
    await expect(prepareWrite({ reader: memoryReader({}), address: C, abi, abiSource: "verified", fn: "setFee", args: [1n], value: 1n, from: USER })).rejects.toThrow(/not payable/);
  });

  it("records the simulated revert reason", async () => {
    const e = Object.assign(new Error("reverted"), { data: encodeErrorResult({ abi, errorName: "NotOwner" }) });
    const reader = memoryReader({ calls: [{ to: C, data: "0x69fe0e2d", result: e }], gas: new Error("execution reverted") });
    const p = await prepareWrite({ reader, address: C, abi, abiSource: "verified", fn: "setFee", args: [5n], from: USER });
    expect(p.simulation).toMatchObject({ status: "reverted", revert: { name: "NotOwner" } });
    expect(p.gas.estimate).toBeNull();
    expect(p.risks.find((r) => r.code === "simulation-reverted")?.severity).toBe("high");
  });

  it("flags approvals, operator approvals, ownership transfers, upgrades and unverified targets", async () => {
    const std = parseAbi([
      "function approve(address spender, uint256 amount) returns (bool)",
      "function setApprovalForAll(address operator, bool approved)",
      "function transferOwnership(address newOwner)",
      "function renounceOwnership()",
      "function upgradeToAndCall(address newImplementation, bytes data) payable",
    ]);
    const reader = memoryReader({ calls: [{ to: C, data: "0x", result: "0x" }] });
    const codes = async (fn: string, args: unknown[], abiSource: "verified" | "signature-subset" = "verified") =>
      (await prepareWrite({ reader, address: C, abi: std, abiSource, fn, args, from: USER })).risks.map((r) => r.code);
    expect(await codes("approve", [IMPL, 2n ** 256n - 1n])).toEqual(expect.arrayContaining(["token-approval", "unlimited-approval"]));
    expect(await codes("approve", [IMPL, 5n])).not.toContain("unlimited-approval");
    // One risk vocabulary for the page and the agent (src/lib/contract/risk.ts): operator approval is "approval-for-all".
    expect(await codes("setApprovalForAll", [IMPL, true])).toContain("approval-for-all");
    expect(await codes("setApprovalForAll", [IMPL, false])).not.toContain("approval-for-all");
    expect(await codes("transferOwnership", [IMPL])).toContain("ownership-transfer");
    expect(await codes("renounceOwnership", [])).toContain("ownership-renounce");
    expect(await codes("upgradeToAndCall", [IMPL, "0x"])).toContain("proxy-upgrade");
    expect(await codes("approve", [IMPL, 5n], "signature-subset")).toEqual(expect.arrayContaining(["unverified-target", "guessed-abi"]));
  });
});

describe("kit.executeWrite: always behind an explicit user approval", () => {
  async function prepared() {
    const reader = memoryReader({ calls: [{ to: C, data: "0xf2c298be", result: "0x" }] });
    return prepareWrite({ reader, address: C, abi, abiSource: "verified", fn: "register", args: ["harbor"], value: 10n, from: USER });
  }
  const executor = (): WriteExecutor & { send: ReturnType<typeof vi.fn> } => ({ path: "wallet", send: vi.fn(async () => pad("0xab", { size: 32 })) });

  it("refuses without an approval, and never calls the executor", async () => {
    const p = await prepared();
    const ex = executor();
    await expect(executeWrite(p, null as never, ex)).rejects.toThrow(/approval/);
    expect(ex.send).not.toHaveBeenCalled();
  });

  it("refuses an approval made outside a user gesture", async () => {
    const p = await prepared();
    expect(() => approveWrite(p, { path: "wallet", acknowledged: ["payable", "value-transfer"] }, { hasUserActivation: () => false })).toThrow(/user gesture/);
  });

  it("requires every high-severity risk to be acknowledged", async () => {
    const reader = memoryReader({ calls: [{ to: C, data: "0x", result: "0x" }] });
    const p = await prepareWrite({ reader, address: C, abi: parseAbi(["function transferOwnership(address newOwner)"]), abiSource: "verified", fn: "transferOwnership", args: [IMPL], from: USER });
    expect(() => approveWrite(p, { path: "wallet", acknowledged: [] }, activated)).toThrow(/ownership-transfer/);
    // An elevated write also needs the typed confirmation (the agent lane's rule, now in the kit).
    expect(p.elevated).toBe(true);
    expect(() => approveWrite(p, { path: "wallet", acknowledged: ["ownership-transfer"] }, activated)).toThrow(/type "transferOwnership"/);
    expect(() => approveWrite(p, { path: "wallet", acknowledged: ["ownership-transfer"], confirmation: "transferownership" }, activated)).toThrow(/type "transferOwnership"/);
    expect(approveWrite(p, { path: "wallet", acknowledged: ["ownership-transfer"], confirmation: "transferOwnership" }, activated).preparedId).toBe(p.id);
  });

  it("sends once with a matching approval; a reused or mismatched approval is refused", async () => {
    const p = await prepared();
    const ex = executor();
    const a = approveWrite(p, { path: "wallet", acknowledged: [] }, activated);
    expect(await executeWrite(p, a, ex)).toBe(pad("0xab", { size: 32 }));
    expect(ex.send).toHaveBeenCalledTimes(1);
    await expect(executeWrite(p, a, ex)).rejects.toThrow(/already used/);
    const other = await prepared();
    await expect(executeWrite(other, approveWrite(p, { path: "wallet", acknowledged: [] }, activated), ex)).rejects.toThrow(/does not match/);
    await expect(executeWrite(p, approveWrite(p, { path: "gasless", acknowledged: [] }, activated), ex)).rejects.toThrow(/path/);
  });

  it("refuses to approve an object the kit did not prepare (executable flag missing or true)", async () => {
    const p = await prepared();
    expect(p.executable).toBe(false);
    expect(() => approveWrite({ ...p, executable: true } as never, { path: "wallet", acknowledged: [] }, activated)).toThrow(/not a prepared write/);
    const { executable: _e, ...noFlag } = p;
    void _e;
    expect(() => approveWrite(noFlag as never, { path: "wallet", acknowledged: [] }, activated)).toThrow(/not a prepared write/);
  });

  it("a simulation that could not run (not a revert) is 'unavailable', high risk, and never gasless", async () => {
    const reader = memoryReader({ calls: [{ to: C, data: "0xf2c298be", result: new Error("fetch failed: ECONNREFUSED") }] });
    const p = await prepareWrite({ reader, address: C, abi, abiSource: "verified", fn: "register", args: ["harbor"], value: 0n, from: USER });
    expect(p.simulation.status).toBe("unavailable");
    expect(p.risks.find((r) => r.code === "simulation-unavailable")?.severity).toBe("high");
    expect(p.gasless.eligible).toBe(false);
    expect(p.gas.estimate).toBeNull();
  });

  it("refuses a stale preparation", async () => {
    const p = await prepared();
    const a = approveWrite(p, { path: "wallet", acknowledged: [] }, activated);
    await expect(executeWrite(p, a, executor(), { now: () => p.preparedAt + 10 * 60_000 })).rejects.toThrow(/stale/);
  });

  it("refuses the gasless path when the preparation is not eligible", async () => {
    const p = await prepared();
    const a = approveWrite(p, { path: "gasless", acknowledged: [] }, activated);
    await expect(executeWrite(p, a, { path: "gasless", send: vi.fn() })).rejects.toThrow(/gasless/);
  });
});

describe("kit.rawCall", () => {
  it("returns raw 32-byte words and refuses malformed calldata", async () => {
    const reader = memoryReader({ calls: [{ to: C, data: "0x12345678", result: ("0x" + "00".repeat(31) + "05" + "ff".repeat(32)) as Hex }] });
    const r = await rawCall({ reader, address: C, data: "0x12345678" });
    expect(r).toMatchObject({ ok: true, words: ["0x" + "00".repeat(31) + "05", "0x" + "ff".repeat(32)] });
    expect(await rawCall({ reader, address: C, data: "0x12" as Hex })).toMatchObject({ ok: false });
  });
});
