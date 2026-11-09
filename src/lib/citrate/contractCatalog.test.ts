import { describe, it, expect } from "vitest";
import { describeContract, listContracts, PRECOMPILES, CITRATE_OVERVIEW, CATALOG_NAMES } from "./contractCatalog";
import { CONTRACT_ADDRESSES, AA_STACK } from "./addresses";

describe("citrate/contractCatalog", () => {
  it("describes a known system contract with name + category + purpose", () => {
    const d = describeContract(CONTRACT_ADDRESSES.InferenceRouter);
    expect(d.known).toBe(true);
    expect(d.name).toBe("InferenceRouter");
    expect(d.category).toBe("AI / Inference");
    expect(d.purpose?.toLowerCase()).toMatch(/inference|route/);
  });

  it("describes the LoRA registry", () => {
    const d = describeContract(CONTRACT_ADDRESSES.LoRAFactory);
    expect(d.name).toBe("LoRAFactory");
    expect(d.purpose?.toLowerCase()).toContain("lora");
  });

  it("describes a precompile", () => {
    const d = describeContract("0x0000000000000000000000000000000000000100");
    expect(d.isPrecompile).toBe(true);
    expect(d.name).toBe("ModelDeploy");
    expect(PRECOMPILES["0x0000000000000000000000000000000000000100"]).toBeTruthy();
  });

  it("returns known=false for a non-system address (honest)", () => {
    const d = describeContract("0x1111111111111111111111111111111111111111");
    expect(d.known).toBe(false);
    expect(d.name).toBeNull();
    expect(d.note).toMatch(/getAddress|callView/);
  });

  it("lists contracts by category", () => {
    const ai = listContracts("AI / Inference");
    expect(ai.map((c) => c.name)).toEqual(expect.arrayContaining(["ModelRegistry", "InferenceRouter"]));
    expect(ai.every((c) => c.category === "AI / Inference")).toBe(true);
    expect(listContracts().length).toBeGreaterThan(ai.length);
  });

  it("overview names the core capabilities", () => {
    expect(CITRATE_OVERVIEW).toMatch(/inference marketplace/i);
    expect(CITRATE_OVERVIEW).toMatch(/compute-share/i);
    expect(CITRATE_OVERVIEW).toMatch(/LoRA/);
  });

  it("has no catalog entry for a name the vendored book does not carry (a re-roll removed it)", () => {
    const book = new Set([...Object.keys(CONTRACT_ADDRESSES), ...Object.keys(AA_STACK)]);
    expect(CATALOG_NAMES.filter((n) => !book.has(n))).toEqual([]);
  });

  it("describes the r1006 governance contracts", () => {
    for (const name of ["GovernanceTimelock", "GovernanceMultisig", "GuardianTimelock", "GuardianMultisig", "GuardianCanceller"]) {
      const d = describeContract(CONTRACT_ADDRESSES[name]);
      expect(d.name).toBe(name);
      expect(d.category).toBe("Governance / Treasury");
      expect(d.purpose).toBeTruthy();
    }
  });

  it("reads a dotted book key as one name, not a nested path", () => {
    const addr = CONTRACT_ADDRESSES["Quorum.AnchorRegistry"];
    expect(addr).toMatch(/^0x[0-9a-f]{40}$/);
    const d = describeContract(addr);
    expect(d.name).toBe("Quorum.AnchorRegistry");
    expect(d.category).toBe("Tokenization / Data");
    expect(listContracts("Tokenization / Data").map((c) => c.name)).toContain("Quorum.AnchorRegistry");
  });

  it("matches book addresses case-insensitively (r1006 books are lowercase)", () => {
    const lower = CONTRACT_ADDRESSES.InferenceRouter.toLowerCase();
    const upper = "0x" + lower.slice(2).toUpperCase();
    expect(describeContract(upper).name).toBe("InferenceRouter");
  });
});
