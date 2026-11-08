import { describe, expect, it } from "vitest";
import { guessAbi } from "./abiGuess";
import fixture from "./__fixtures__/registry.json";

describe("abiGuess: unverified bytecode", () => {
  const g = guessAbi(fixture.runtimeBytecode);

  it("finds all nine selectors in the fixture's dispatcher", () => {
    expect(g.functions.map((f) => f.selector).sort()).toHaveLength(9);
  });

  it("resolves the selectors the signature subset knows, and leaves the rest unresolved", () => {
    const by = Object.fromEntries(g.functions.map((f) => [f.selector, f]));
    expect(by["0x8da5cb5b"].resolved?.name).toBe("owner");
    expect(by["0xf2fde38b"].resolved?.name).toBe("transferOwnership");
    // register(string) is the fixture's own function: not in the bundled subset
    expect(by["0xf2c298be"].resolved).toBeNull();
  });

  it("guesses payability from the bytecode (register is payable)", () => {
    const reg = g.functions.find((f) => f.selector === "0xf2c298be")!;
    expect(reg.payable).toBe(true);
    const owner = g.functions.find((f) => f.selector === "0x8da5cb5b")!;
    expect(owner.payable).toBe(false);
  });

  it("finds event topics and builds a usable ABI only from resolved entries", () => {
    expect(g.eventTopics).toContain("0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0"); // OwnershipTransferred
    expect(g.abi.every((x) => x.type === "function" || x.type === "event")).toBe(true);
    expect(g.abi.find((x) => x.type === "function" && x.name === "owner")).toBeTruthy();
  });

  it("returns nothing for empty code", () => {
    expect(guessAbi("0x")).toEqual({ functions: [], eventTopics: [], events: [], abi: [] });
  });
});
