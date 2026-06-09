import { describe, it, expect } from "vitest";
import { RESOURCES, PROMPTS, getResource, getPrompt } from "./mcpResources";

describe("mcpResources", () => {
  it("exposes the core resources with readable content", () => {
    const uris = RESOURCES.map((r) => r.uri);
    expect(uris).toEqual(
      expect.arrayContaining(["citrate://overview", "citrate://contracts", "citrate://addresses", "citrate://index-schema"]),
    );
    const contracts = getResource("citrate://contracts")!;
    const md = contracts.read();
    expect(md).toMatch(/InferenceRouter/);
    expect(md).toMatch(/\| Name \| Category \| Address \| Purpose \|/);

    const addrs = JSON.parse(getResource("citrate://addresses")!.read());
    expect(addrs.chainId).toBe(40204);
    expect(addrs.contracts.ModelRegistry).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("prompts render with their arguments substituted", () => {
    const audit = getPrompt("audit_address")!;
    expect(audit.arguments[0]).toMatchObject({ name: "address", required: true });
    const text = audit.render({ address: "0xabc0000000000000000000000000000000000001" });
    expect(text).toContain("0xabc0000000000000000000000000000000000001");
    expect(text.toLowerCase()).toMatch(/balance|activity/);

    // optional arg omitted → still renders
    const fin = getPrompt("explain_finality")!;
    expect(fin.render({})).toMatch(/GHOSTDAG|finality/i);
    expect(fin.render({ block: "1234" })).toContain("1234");
  });

  it("unknown resource/prompt → undefined", () => {
    expect(getResource("citrate://nope")).toBeUndefined();
    expect(getPrompt("nope")).toBeUndefined();
  });
});
