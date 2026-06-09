import { describe, it, expect } from "vitest";
import { parseRichBlocks } from "./richBlocks";

describe("markdown/parseRichBlocks", () => {
  it("parses a markdown table (header + separator + rows)", () => {
    const text = [
      "Here are the biggest transfers:",
      "",
      "| Amount | From | To |",
      "| --- | --- | --- |",
      "| 30,000 SALT | 0xaceaa7… | 0x52bb1… |",
      "| 10 SALT | 0xf4adb1… | 0x…c0de |",
    ].join("\n");
    const b = parseRichBlocks(text);
    expect(b[0]).toEqual({ type: "p", text: "Here are the biggest transfers:" });
    expect(b[1].type).toBe("table");
    if (b[1].type === "table") {
      expect(b[1].header).toEqual(["Amount", "From", "To"]);
      expect(b[1].rows).toHaveLength(2);
      expect(b[1].rows[0]).toEqual(["30,000 SALT", "0xaceaa7…", "0x52bb1…"]);
    }
  });

  it("tolerates tables without outer pipes + alignment colons", () => {
    const text = ["Token | Holders", ":---|---:", "wSALT | 12"].join("\n");
    const b = parseRichBlocks(text);
    expect(b[0].type).toBe("table");
    if (b[0].type === "table") {
      expect(b[0].header).toEqual(["Token", "Holders"]);
      expect(b[0].rows[0]).toEqual(["wSALT", "12"]);
    }
  });

  it("does NOT treat a pipe-bearing paragraph as a table without a separator", () => {
    const b = parseRichBlocks("use a | b syntax here");
    expect(b[0]).toEqual({ type: "p", text: "use a | b syntax here" });
  });

  it("still parses ordered + unordered lists and paragraphs", () => {
    const b = parseRichBlocks("intro\n\n1. first\n2. second\n\n- a\n- b");
    expect(b.map((x) => x.type)).toEqual(["p", "ol", "ul"]);
    if (b[1].type === "ol") expect(b[1].items).toEqual(["first", "second"]);
    if (b[2].type === "ul") expect(b[2].items).toEqual(["a", "b"]);
  });

  it("a table ends cleanly and following prose is its own block", () => {
    const text = ["| A | B |", "| - | - |", "| 1 | 2 |", "", "Done."].join("\n");
    const b = parseRichBlocks(text);
    expect(b[0].type).toBe("table");
    expect(b[1]).toEqual({ type: "p", text: "Done." });
  });
});
