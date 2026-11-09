import { describe, it, expect } from "vitest";
import { parseEther, toFunctionSelector } from "viem";
import { assessRisk, payableThresholdWei, type RiskInput } from "./risk";

const SPENDER = "0x000000000000000000000000000000000000bad1";
const base = (over: Partial<RiskInput> = {}): RiskInput => ({
  functionName: "poke",
  selector: toFunctionSelector("poke(uint256)"),
  args: [1n],
  valueWei: 0n,
  target: { isContract: true, verification: "verified", abiSource: "verified", proxy: { isProxy: false, kind: null, implementation: null } },
  simulation: { ok: true, from: "0x00000000000000000000000000000000000a11ce", revertReason: null, gasEstimate: "21000" },
  thresholdWei: parseEther("1"),
  ...over,
});
const codes = (i: RiskInput) => assessRisk(i).flags.map((f) => f.code);

describe("elevated warnings (each requires the typed confirmation)", () => {
  it.each([
    ["approve", "approve(address,uint256)", [SPENDER, 5n], "token-approval"],
    ["increaseAllowance", "increaseAllowance(address,uint256)", [SPENDER, 5n], "token-approval"],
    ["permit", "permit(address,address,uint256,uint256,uint8,bytes32,bytes32)", [], "permit"],
    ["setApprovalForAll", "setApprovalForAll(address,bool)", [SPENDER, true], "approval-for-all"],
    ["transferOwnership", "transferOwnership(address)", [SPENDER], "ownership-transfer"],
    ["renounceOwnership", "renounceOwnership()", [], "ownership-transfer"],
    ["changeAdmin", "changeAdmin(address)", [SPENDER], "admin-transfer"],
    ["grantRole", "grantRole(bytes32,address)", ["0x00", SPENDER], "admin-transfer"],
    ["upgradeTo", "upgradeTo(address)", [SPENDER], "proxy-upgrade"],
    ["upgradeToAndCall", "upgradeToAndCall(address,bytes)", [SPENDER, "0x"], "proxy-upgrade"],
  ])("%s", (name, sig, args, code) => {
    const a = assessRisk(base({ functionName: name, selector: toFunctionSelector(sig), args }));
    expect(a.flags.map((f) => f.code)).toContain(code);
    expect(a.elevated).toBe(true);
    expect(a.confirmPhrase).toBe(name);
  });

  it("catches a dangerous selector even under an innocent-looking name", () => {
    expect(codes(base({ functionName: "claimReward", selector: toFunctionSelector("approve(address,uint256)"), args: [SPENDER, 1n] }))).toContain("token-approval");
  });

  it("adds unlimited-approval for a max allowance", () => {
    expect(codes(base({ functionName: "approve", selector: toFunctionSelector("approve(address,uint256)"), args: [SPENDER, 2n ** 256n - 1n] }))).toContain("unlimited-approval");
  });

  it("setApprovalForAll(false) (a revoke) is not elevated", () => {
    expect(assessRisk(base({ functionName: "setApprovalForAll", selector: toFunctionSelector("setApprovalForAll(address,bool)"), args: [SPENDER, false] })).elevated).toBe(false);
  });

  it("payable value above the threshold is elevated; at or below it only warns", () => {
    const above = assessRisk(base({ valueWei: parseEther("2") }));
    expect(above.flags.map((f) => f.code)).toContain("payable-above-threshold");
    expect(above.elevated).toBe(true);
    const below = assessRisk(base({ valueWei: parseEther("0.5") }));
    expect(below.flags.map((f) => f.code)).toEqual(["value-transfer"]);
    expect(below.elevated).toBe(false);
  });

  it("an unverified target is elevated", () => {
    expect(assessRisk(base({ target: { ...base().target, verification: "unverified", abiSource: "signature" } })).elevated).toBe(true);
  });

  it("a signature outside a verified contract's ABI is elevated", () => {
    const a = assessRisk(base({ target: { ...base().target, verification: "verified", abiSource: "signature" } }));
    expect(a.elevated).toBe(true);
    expect(a.flags[0].message).toMatch(/not in its verified ABI/);
  });

  it("an unknown verification status is elevated and says it is unknown", () => {
    const a = assessRisk(base({ target: { ...base().target, verification: "unavailable", abiSource: "signature" } }));
    expect(a.elevated).toBe(true);
    expect(a.flags[0].message).toMatch(/unknown/);
  });

  it("a partial-match target is elevated", () => {
    expect(codes(base({ target: { ...base().target, verification: "partial-match", abiSource: "partial-match" } }))).toContain("partial-match-target");
  });

  it("a target with no code is elevated", () => {
    expect(codes(base({ target: { ...base().target, isContract: false } }))).toContain("eoa-target");
  });

  it("a reverting simulation is elevated", () => {
    expect(assessRisk(base({ simulation: { ok: false, from: null, revertReason: "nope", gasEstimate: null } })).elevated).toBe(true);
  });

  it("a simulation that could not run is elevated too", () => {
    expect(codes(base({ simulation: { ok: false, from: "0x00000000000000000000000000000000000a11ce", revertReason: null, gasEstimate: null } }))).toContain("simulation-unavailable");
  });

  it("a proxy target warns, and a plain verified call has no flags", () => {
    expect(codes(base({ target: { ...base().target, proxy: { isProxy: true, kind: "eip1967", implementation: SPENDER } } }))).toEqual(["proxy-target"]);
    expect(assessRisk(base())).toEqual({ flags: [], elevated: false, confirmPhrase: null });
  });
});

describe("payable threshold", () => {
  it("defaults to 1 SALT and ignores malformed overrides", () => {
    expect(payableThresholdWei({} as NodeJS.ProcessEnv)).toBe(parseEther("1"));
    expect(payableThresholdWei({ AGENT_PAYABLE_WARN_SALT: "abc" } as unknown as NodeJS.ProcessEnv)).toBe(parseEther("1"));
    expect(payableThresholdWei({ AGENT_PAYABLE_WARN_SALT: "0.25" } as unknown as NodeJS.ProcessEnv)).toBe(parseEther("0.25"));
  });
});
