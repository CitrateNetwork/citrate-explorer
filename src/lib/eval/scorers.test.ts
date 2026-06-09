import { describe, it, expect } from "vitest";
import {
  scoreToolSelection,
  extractNumbers,
  scoreAccuracy,
  scoreItem,
  aggregate,
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
    expect(scoreAccuracy(A({ kind: "address", values: ["0xAcEaA7"] }), "held by 0xaceaa7...", null)).toBe("pass");
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
