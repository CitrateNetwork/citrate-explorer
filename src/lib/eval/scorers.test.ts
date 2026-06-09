import { describe, it, expect } from "vitest";
import {
  scoreToolSelection,
  extractNumbers,
  scoreAccuracy,
  scoreItem,
  aggregate,
  aggregateRuns,
  meanStdev,
  type ItemScore,
} from "./scorers";
import type { AnswerAssertion, GoldenRecord } from "./golden";
import type { TruthValue } from "./groundTruth";
import type { ChatRunResult } from "./chatDriver";

describe("scorers/tool-selection", () => {
  it("perfect match -> F1 1", () => {
    const s = scoreToolSelection(["a", "b"], ["a", "b"]);
    expect(s.f1).toBe(1);
  });
  it("empty expectation answered tool-free -> perfect", () => {
    expect(scoreToolSelection([], []).f1).toBe(1);
  });
  it("missing one + an extra -> precision and recall both 0.5", () => {
    const s = scoreToolSelection(["a", "b"], ["a", "c"]);
    expect(s.precision).toBeCloseTo(0.5);
    expect(s.recall).toBeCloseTo(0.5);
    expect(s.f1).toBeCloseTo(0.5);
  });
});

describe("scorers/extractNumbers", () => {
  it("parses comma-grouped and plain numbers", () => {
    expect(extractNumbers("sent 30,000 SALT in block 12345 with 7 txs")).toEqual([30000, 12345, 7]);
  });
});

const A = (a: AnswerAssertion) => a;

describe("scorers/accuracy", () => {
  it("numeric within tolerance passes; outside fails", () => {
    expect(scoreAccuracy(A({ kind: "numeric", number: 100 }), "the height is 100", null)).toBe("pass");
    expect(scoreAccuracy(A({ kind: "numeric", number: 100, tolerance: 0.05 }), "about 103", null)).toBe("pass");
    expect(scoreAccuracy(A({ kind: "numeric", number: 100 }), "it is 200", null)).toBe("fail");
  });
  it("contains_all / contains_any / address", () => {
    expect(scoreAccuracy(A({ kind: "contains_all", values: ["40204", "SALT"] }), "Chain 40204, token SALT", null)).toBe("pass");
    expect(scoreAccuracy(A({ kind: "contains_all", values: ["40204", "SALT"] }), "Chain 40204", null)).toBe("fail");
    expect(scoreAccuracy(A({ kind: "contains_any", values: ["wallet", "eoa"] }), "It's an EOA.", null)).toBe("pass");
  });

  it("address matching tolerates model truncation", () => {
    const full = "0xaceaa7d00c024d32e6e0a07094ceb1a7706786d1";
    // truncated forms the small model actually emits
    expect(scoreAccuracy(A({ kind: "address", values: [full] }), "held by 0xaceaa7…", null)).toBe("pass");
    expect(scoreAccuracy(A({ kind: "address", values: [full] }), "held by 0xAcEaA7d0...", null)).toBe("pass");
    expect(scoreAccuracy(A({ kind: "address", values: [full] }), `held by ${full}`, null)).toBe("pass");
    // a different address must NOT match
    expect(scoreAccuracy(A({ kind: "address", values: [full] }), "held by 0xdeadbeef…", null)).toBe("fail");
  });

  it("address-typed values inside contains_all also tolerate truncation", () => {
    const truth: TruthValue = { kind: "address", values: ["0x4250675f9015e65fc866f3a373f82bb9dfc000c6"] };
    expect(scoreAccuracy(A({ kind: "set_contains" }), "the deployer 0x425067… did it", truth)).toBe("pass");
  });
  it("uses rpc truth when present (addressKind contract)", () => {
    const truth: TruthValue = { kind: "strings", values: ["contract"] };
    expect(scoreAccuracy(A({ kind: "contains_any" }), "Yes, it is a contract.", truth)).toBe("pass");
    expect(scoreAccuracy(A({ kind: "contains_any" }), "It's a normal wallet.", truth)).toBe("fail");
  });
  it("rpc numeric truth drives the comparison", () => {
    const truth: TruthValue = { kind: "number", number: 42 };
    expect(scoreAccuracy(A({ kind: "numeric", tolerance: 0 }), "there are 42 transactions", truth)).toBe("pass");
  });
  it("unsupported / indeterminate truth excluded from pass/fail", () => {
    expect(scoreAccuracy(A({ kind: "numeric", number: 1 }), "x", { kind: "unsupported", reason: "later" })).toBe("not_supported");
    expect(scoreAccuracy(A({ kind: "numeric", number: 1 }), "x", { kind: "indeterminate", reason: "no meta" })).toBe("indeterminate");
  });

  // X-3: native-vs-token disambiguation.
  it("labeled_native passes only when the answer says native SALT", () => {
    expect(scoreAccuracy(A({ kind: "labeled_native" }), "You received 30,000 SALT (the native coin).", null)).toBe("pass");
    // mislabels native SALT as a token transfer -> fail
    expect(scoreAccuracy(A({ kind: "labeled_native" }), "30,000 wSALT token was transferred via ERC-20.", null)).toBe("fail");
  });
  it("labeled_token requires the token identity AND a token label", () => {
    const a = A({ kind: "labeled_token", token: { symbol: "wSALT" } });
    expect(scoreAccuracy(a, "wSALT token: 1,500 received", null)).toBe("pass");
    expect(scoreAccuracy(a, "1,500 SALT received", null)).toBe("fail");
  });
});

// --- per-item + aggregate ---

function mkRecord(over: Partial<GoldenRecord>): GoldenRecord {
  return {
    id: "x",
    persona: "auditor",
    class: "chain",
    question: "q",
    expected_tools: ["getChainStatus"],
    answer_assertion: { kind: "contains_all", values: ["40204"] },
    ground_truth: { type: "static" },
    ...over,
  };
}
function mkResult(over: Partial<ChatRunResult>): ChatRunResult {
  return { answerText: "", toolCalls: [], steps: 1, latencyMs: 100, httpStatus: 200, ...over };
}

describe("scorers/aggregate", () => {
  it("excludes blocked items and computes the families", () => {
    const items: ItemScore[] = [
      scoreItem({
        record: mkRecord({ id: "ok", expected_tools: ["getChainStatus"], answer_assertion: { kind: "contains_all", values: ["40204"] } }),
        result: mkResult({ answerText: "chain 40204", toolCalls: [{ name: "getChainStatus" }], latencyMs: 50 }),
        truth: null,
      }),
      scoreItem({
        record: mkRecord({ id: "miss", answer_assertion: { kind: "contains_all", values: ["40204"] } }),
        result: mkResult({ answerText: "no idea", toolCalls: [], latencyMs: 150 }),
        truth: null,
      }),
      scoreItem({
        record: mkRecord({ id: "blocked", blocked_until: "RA-2", expected_tools: ["findTransfers"] }),
        result: mkResult({ answerText: "whatever", toolCalls: [] }),
        truth: null,
      }),
    ];
    const agg = aggregate(items);
    expect(agg.scored).toBe(2); // blocked excluded
    expect(agg.accuracy).toBeCloseTo(0.5); // one pass, one fail
    expect(agg.groundedness).toBeCloseTo(0.5); // one called a tool, one didn't
    expect(agg.latencyP50).toBeGreaterThan(0);
    expect(agg.accuracyByClass.chain).toBeCloseTo(0.5);
  });
});

describe("scorers/meanStdev + aggregateRuns", () => {
  it("meanStdev", () => {
    expect(meanStdev([2, 4, 6])).toMatchObject({ mean: 4 });
    expect(meanStdev([5, 5, 5]).stdev).toBe(0);
  });

  it("aggregateRuns exposes per-item pass-rate + flaky items + variance", () => {
    const item = (id: string, acc: "pass" | "fail") =>
      scoreItem({
        record: mkRecord({ id, expected_tools: ["getChainStatus"], answer_assertion: { kind: "contains_all", values: ["x"] } }),
        result: mkResult({ answerText: acc === "pass" ? "x" : "y", toolCalls: [{ name: "getChainStatus" }] }),
        truth: null,
      });
    // 3 runs: 'stable' passes every time; 'flaky' passes 2/3.
    const runs: ItemScore[][] = [
      [item("stable", "pass"), item("flaky", "pass")],
      [item("stable", "pass"), item("flaky", "fail")],
      [item("stable", "pass"), item("flaky", "pass")],
    ];
    const m = aggregateRuns(runs);
    expect(m.runs).toBe(3);
    expect(m.perItemPassRate.stable).toBe(1);
    expect(m.perItemPassRate.flaky).toBeCloseTo(2 / 3);
    expect(m.flaky).toEqual(["flaky"]);
    expect(m.accuracy.stdev).toBeGreaterThan(0); // runs differ -> visible variance
  });
});
