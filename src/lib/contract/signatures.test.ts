import { describe, expect, it } from "vitest";
import { parseAbi } from "viem";
import bundled from "@/generated/signatures.json";
import { buildSignatureDb, knownAbiItems, lookupError, lookupEvent, lookupFunction, serializeSignatureDb } from "./signatures";

describe("signatures: building the bundled subset", () => {
  it("indexes functions by selector, events by topic0 and errors by selector", () => {
    const db = buildSignatureDb(
      parseAbi([
        "function transfer(address to, uint256 amount) returns (bool)",
        "event Transfer(address indexed from, address indexed to, uint256 value)",
        "error NotOwner()",
      ]),
    );
    expect(db.functions["0xa9059cbb"]).toEqual(["function transfer(address to, uint256 amount) returns (bool)"]);
    expect(db.events["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"]).toEqual([
      "event Transfer(address indexed from, address indexed to, uint256 value)",
    ]);
    expect(db.errors["0x30cd7471"]).toEqual(["error NotOwner()"]);
  });

  it("deduplicates and keeps colliding signatures side by side, sorted", () => {
    const db = buildSignatureDb(
      parseAbi(["function transfer(address to, uint256 amount) returns (bool)", "function transfer(address recipient, uint256 value) returns (bool)", "function transfer(address to, uint256 amount) returns (bool)"]),
    );
    expect(db.functions["0xa9059cbb"]).toHaveLength(2);
  });

  it("is in sync with the committed src/generated/signatures.json (run pnpm contract:signatures)", () => {
    expect(serializeSignatureDb(buildSignatureDb(knownAbiItems()))).toBe(JSON.stringify(bundled, null, 1) + "\n");
  });
});

describe("signatures: lookups against the bundled subset", () => {
  it("resolves standard and explorer-known selectors to parsed ABI items", () => {
    expect(lookupFunction("0x095ea7b3")[0]).toMatchObject({ type: "function", name: "approve" });
    expect(lookupFunction("0xd0e30db0")[0]).toMatchObject({ name: "deposit", stateMutability: "payable" });
    expect(lookupFunction("0x572b6c05")[0]).toMatchObject({ name: "isTrustedForwarder" });
    expect(lookupEvent("0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b")[0]).toMatchObject({ name: "Upgraded" });
    expect(lookupError("0x118cdaa7")[0]).toMatchObject({ name: "OwnableUnauthorizedAccount" });
    expect(lookupFunction("0x00000000")).toEqual([]);
  });
});
