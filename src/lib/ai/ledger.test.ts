import { describe, it, expect } from "vitest";
import { runLedger } from "./tools";

// The ledger tool gives the agent EXACT accounting in grains (wei) so it never
// makes floating-point/arithmetic mistakes while keeping a running tab.
describe("runLedger — exact dual-unit accounting", () => {
  it("sums SALT amounts precisely (no float drift)", () => {
    const r = runLedger([
      { label: "in", salt: "1.5" },
      { label: "in", salt: "0.25" },
      { label: "fee", salt: "-0.000021" },
    ]);
    expect(r.totalSalt).toBe("1.749979");
    expect(r.totalGrains).toBe("1749979000000000000");
  });

  it("handles raw grains and mixed units exactly", () => {
    const r = runLedger([
      { label: "a", grains: "1000000000000000000" }, // 1 SALT
      { label: "b", salt: "0.5" },
    ]);
    expect(r.totalGrains).toBe("1500000000000000000");
    expect(r.totalSalt).toBe("1.5");
  });

  it("supports debits to net to zero / negative", () => {
    const r = runLedger([
      { label: "credit", salt: "2" },
      { label: "debit", salt: "-2" },
    ]);
    expect(r.totalSalt).toBe("0");
    expect(r.totalGrains).toBe("0");

    const neg = runLedger([{ label: "x", grains: "-5" }]);
    expect(neg.totalGrains).toBe("-5");
  });

  it("preserves 18-decimal precision below the SALT unit", () => {
    const r = runLedger([{ label: "dust", grains: "1" }]);
    expect(r.totalSalt).toBe("0.000000000000000001");
    expect(r.lines[0].grains).toBe("1");
  });
});
