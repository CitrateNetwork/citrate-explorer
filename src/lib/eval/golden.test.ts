import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { citrateTools } from "@/lib/ai/tools";
import {
  parseGoldenJsonl,
  validateGoldenRecord,
  activeRecords,
  PERSONAS,
  CAPABILITY_CLASSES,
  FUTURE_TOOLS,
  type GoldenRecord,
} from "./golden";

// The golden set is data under scripts/eval/; the schema lives here so the test
// counts toward the ratchet and guards the corpus the RA-1 harness scores.
const GOLDEN_PATH = resolve(process.cwd(), "scripts/eval/golden/citrate.golden.jsonl");

function loadGolden(): GoldenRecord[] {
  return parseGoldenJsonl(readFileSync(GOLDEN_PATH, "utf8"));
}

function knownToolNames(): string[] {
  // Authoritative live tool set — keeps golden expected_tools honest as tools change.
  return Object.keys(citrateTools({}));
}

describe("eval/golden — corpus integrity", () => {
  const records = loadGolden();
  const knownTools = knownToolNames();

  it("loads a non-trivial golden set", () => {
    expect(records.length).toBeGreaterThanOrEqual(25);
  });

  it("every record validates against the schema and references real (or planned) tools", () => {
    const allErrors: string[] = [];
    for (const r of records) {
      const errs = validateGoldenRecord(r, { knownTools, futureTools: FUTURE_TOOLS });
      if (errs.length) allErrors.push(`[${(r as GoldenRecord).id ?? "??"}] ${errs.join("; ")}`);
    }
    expect(allErrors).toEqual([]);
  });

  it("ids are unique", () => {
    const ids = records.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers all three personas and all capability classes", () => {
    const personas = new Set(records.map((r) => r.persona));
    const classes = new Set(records.map((r) => r.class));
    for (const p of PERSONAS) expect(personas.has(p)).toBe(true);
    for (const c of CAPABILITY_CLASSES) expect(classes.has(c)).toBe(true);
  });

  it("has live (non-blocked) records to baseline against today", () => {
    expect(activeRecords(records).length).toBeGreaterThanOrEqual(12);
  });

  it("only blocked records may reference future tools", () => {
    const future = new Set<string>(FUTURE_TOOLS);
    for (const r of records) {
      const usesFuture = r.expected_tools.some((t) => future.has(t));
      if (usesFuture) {
        expect(r.blocked_until, `${r.id} uses a future tool but isn't blocked_until a sprint`).toBeTruthy();
      }
    }
  });
});
