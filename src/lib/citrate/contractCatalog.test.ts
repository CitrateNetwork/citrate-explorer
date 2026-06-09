import { describe, it, expect } from "vitest";
import { describeContract, listContracts, PRECOMPILES, CITRATE_OVERVIEW } from "./contractCatalog";
import { CONTRACT_ADDRESSES } from "./addresses";

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
    expect(d.name).toBe("InferenceDeploy");
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
});
