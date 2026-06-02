import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "./system-prompt";

describe("buildSystemPrompt", () => {
  it("includes all five layers by default", () => {
    const p = buildSystemPrompt();
    expect(p).toContain("on-chain analyst"); // persona
    expect(p).toContain("Tool protocol"); // capabilities
    expect(p).toContain("GHOSTDAG"); // network
    expect(p).toContain("No fabrication"); // guardrails
    expect(p).toContain("Lead with the answer"); // style
  });

  it("force-includes guardrails even when omitted", () => {
    const p = buildSystemPrompt({ sections: ["persona"] });
    expect(p).toContain("READ-ONLY");
    expect(p).toContain("No financial or investment advice");
  });

  it("mentions the DAG finality rule and chain id", () => {
    const p = buildSystemPrompt();
    expect(p).toContain("blue_score");
    expect(p).toContain("40204");
  });
});
