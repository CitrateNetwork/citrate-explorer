import { describe, it, expect } from "vitest";
import { GET } from "./route";

// SR-1: provenance must be REAL, not hardcoded. These guard the exact regressions
// the audit found — wrong license (MIT), wrong repo org (citrate/...), fake build.
describe("GET /api/version — real provenance", () => {
  it("reports the canonical Apache-2.0 license and CitrateNetwork repo", async () => {
    const json = await (GET() as Response).json();
    expect(json.license).toBe("Apache-2.0");
    expect(json.repo).toMatch(/\/citrate-explorer$/);
    expect(json.repoUrl).toBe(`https://github.com/${json.repo}`);
    // Never the fabricated org the UI used to show.
    expect(json.repo).not.toBe("citrate/citrate-explorer");
  });

  it("exposes version + a model provenance object (no fake hash)", async () => {
    const json = await (GET() as Response).json();
    expect(typeof json.version).toBe("string");
    expect(json.name).toBe("citrate-explorer");
    // model is either the configured provider or an honest error — never a literal.
    expect(json.model).toBeTypeOf("object");
    if (!json.model.error) {
      expect(typeof json.model.id).toBe("string");
      expect(["local", "gateway", "onchain"]).toContain(json.model.mode);
      expect(json.model.attestation).toBe("pending");
    }
  });
});
