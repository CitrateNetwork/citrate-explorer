import { describe, expect, it } from "vitest";
import { fmtNum, shortHash, heightRef, fmtAge, fmtPct, fmtSalt, isoTime } from "./format";

describe("format", () => {
  it("groups integers with commas", () => {
    expect(fmtNum(41412)).toBe("41,412");
    expect(fmtNum(0)).toBe("0");
    expect(fmtNum(null)).toBe("n/a");
  });
  it("shortens hashes with an ellipsis, never a dash", () => {
    const h = "0x6a9c" + "0".repeat(56) + "1f2e";
    expect(shortHash(h)).toBe("0x6a9c…1f2e");
    expect(shortHash(h, 8, 6)).toBe("0x6a9c00…001f2e");
    expect(shortHash("0x12")).toBe("0x12");
    expect(shortHash(null)).toBe("");
  });
  it("names a block by height plus hash prefix, because siblings share heights", () => {
    expect(heightRef(41412, "0x6a9cdeadbeef")).toEqual({ height: "41,412", prefix: "0x6a9c", text: "41,412 0x6a9c" });
  });
  it("formats ages from seconds", () => {
    const now = 1_700_000_100_000;
    expect(fmtAge(1_700_000_095, now)).toBe("5 s ago");
    expect(fmtAge(1_700_000_100 - 180, now)).toBe("3 min ago");
    expect(fmtAge(1_700_000_100 - 7200, now)).toBe("2 h ago");
    expect(fmtAge(1_700_000_100 - 3 * 86400, now)).toBe("3 d ago");
    expect(fmtAge(1_700_000_200, now)).toBe("just now");
  });
  it("formats shares as percents", () => {
    expect(fmtPct(0.25)).toBe("25");
    expect(fmtPct(1 / 3, 1)).toBe("33.3");
  });
  it("trims SALT amounts", () => {
    expect(fmtSalt("1.250000000000000000")).toBe("1.25 SALT");
    expect(fmtSalt("0")).toBe("0 SALT");
    expect(fmtSalt("0.000000123456789")).toBe("0.000000123 SALT");
    expect(fmtSalt("12345.5")).toBe("12,345.5 SALT");
  });
  it("prints ISO times in UTC", () => {
    expect(isoTime(1_700_000_000)).toBe("2023-11-14 22:13:20 UTC");
  });
});
