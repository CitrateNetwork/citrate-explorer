import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseGoldenJsonl } from "./golden";
import { generateGroundTruth, knownGenerators, UNSUPPORTED_GENERATORS } from "./groundTruth";

const GOLDEN_PATH = resolve(process.cwd(), "scripts/eval/golden/citrate.golden.jsonl");
const records = parseGoldenJsonl(readFileSync(GOLDEN_PATH, "utf8"));

describe("eval/groundTruth — registry integrity", () => {
  it("every rpc generator referenced by the golden set is known or explicitly unsupported", () => {
    const valid = new Set<string>([...knownGenerators(), ...UNSUPPORTED_GENERATORS]);
    const dangling: string[] = [];
    for (const r of records) {
      if (r.ground_truth.type === "rpc") {
        const g = r.ground_truth.generator ?? "";
        if (!valid.has(g)) dangling.push(`${r.id} -> "${g}"`);
      }
    }
    expect(dangling).toEqual([]);
  });

  it("unsupported + unknown generators resolve to a non-throwing 'unsupported' result", async () => {
    const blocked = await generateGroundTruth("findNativeTransfers", { minSalt: 30000 });
    expect(blocked.kind).toBe("unsupported");
    const unknown = await generateGroundTruth("nope");
    expect(unknown.kind).toBe("unsupported");
  });
});

// Live-RPC shape checks — only run when explicitly enabled (hits rpc.citrate.ai).
const live = process.env.LIVE_RPC === "1" ? describe : describe.skip;
live("eval/groundTruth — live shapes", () => {
  it("latestBlock returns a positive pinned block number", async () => {
    const t = await generateGroundTruth("latestBlock");
    expect(t.kind).toBe("number");
    if (t.kind === "number") {
      expect(t.number).toBeGreaterThan(0);
      expect(t.pinnedAtBlock).toBe(t.number);
    }
  });

  it("addressKind classifies a known contract as 'contract'", async () => {
    const t = await generateGroundTruth("addressKind", {
      address: "0xcdca7e85598485a562606cf8beec757dd265477f",
    });
    expect(t.kind).toBe("strings");
    if (t.kind === "strings") expect(t.values).toContain("contract");
  });
});
