import { describe, expect, it } from "vitest";
import { encodeErrorResult, encodeFunctionResult, type Abi } from "viem";
import { decodeCallResult, decodeRevert, encodeCallData, findFunction, functionSignature, revertDataOf } from "./codec";
import fixture from "./__fixtures__/registry.json";

const abi = fixture.abi as Abi;

/** The exact message rpc.citrate.ai returned for a reverting eth_call (2026-11-07). */
const CITRATE_REVERT_MESSAGE =
  "execution reverted: Execution reverted: Contract call reverted: 0x08c379a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000001b7753414c543a20696e73756666696369656e742062616c616e63650000000000 (gas used: 28806)";

describe("codec: encoding", () => {
  it("finds functions by name or full signature and encodes calldata", () => {
    const fn = findFunction(abi, "register")!;
    expect(functionSignature(fn)).toBe("register(string)");
    expect(findFunction(abi, "importEntries(bytes32[],(address,uint64,bytes32[])[])")?.name).toBe("importEntries");
    expect(findFunction(abi, "nope")).toBeNull();
    const data = encodeCallData(fn, ["harbor"]);
    expect(data.slice(0, 10)).toBe("0xf2c298be");
  });

  it("decodes a struct return value", () => {
    const fn = findFunction(abi, "entryOf")!;
    const tag = ("0x" + "11".repeat(32)) as `0x${string}`;
    const ret = encodeFunctionResult({
      abi,
      functionName: "entryOf",
      result: { owner: "0x000000000000000000000000000000000000dEaD", since: 9n, tags: [tag] },
    });
    const out = decodeCallResult(fn, ret);
    expect(out).toEqual([{ owner: "0x000000000000000000000000000000000000dEaD", since: 9n, tags: [tag] }]);
  });
});

describe("codec: reverts", () => {
  it("pulls revert data out of Citrate's error message text", () => {
    const err = new Error("RPC error");
    (err as { cause?: unknown }).cause = { message: CITRATE_REVERT_MESSAGE };
    expect(revertDataOf(err)?.slice(0, 10)).toBe("0x08c379a0");
  });

  it("prefers a structured data field when the node sends one", () => {
    expect(revertDataOf({ cause: { data: "0x4e487b710000000000000000000000000000000000000000000000000000000000000011" } })).toBe(
      "0x4e487b710000000000000000000000000000000000000000000000000000000000000011",
    );
    expect(revertDataOf({ message: "network down" })).toBeNull();
  });

  it("decodes Error(string), Panic(uint256), custom errors and empty reverts", () => {
    const data = revertDataOf({ message: CITRATE_REVERT_MESSAGE })!;
    expect(decodeRevert(data, abi)).toMatchObject({ kind: "error-string", message: "SALT: insufficient balance" });

    expect(decodeRevert("0x4e487b710000000000000000000000000000000000000000000000000000000000000011", abi)).toMatchObject({
      kind: "panic",
      code: 0x11,
      message: "Panic 0x11: arithmetic overflow or underflow",
    });

    const custom = encodeErrorResult({ abi, errorName: "FeeRequired", args: [10n, 1n] });
    expect(decodeRevert(custom, abi)).toMatchObject({ kind: "custom", name: "FeeRequired", signature: "FeeRequired(uint256,uint256)", message: "FeeRequired(required: 10, sent: 1)" });

    expect(decodeRevert("0x", abi)).toMatchObject({ kind: "empty" });
    expect(decodeRevert("0xdeadbeef", abi)).toMatchObject({ kind: "unknown", selector: "0xdeadbeef" });
  });

  it("falls back to the signature subset for a custom error the ABI does not have", () => {
    // OwnableUnauthorizedAccount(address) is in the curated standard set.
    const data = encodeErrorResult({
      abi: [{ type: "error", name: "OwnableUnauthorizedAccount", inputs: [{ name: "account", type: "address" }] }],
      errorName: "OwnableUnauthorizedAccount",
      args: ["0x000000000000000000000000000000000000dEaD"],
    });
    expect(decodeRevert(data, null)).toMatchObject({ kind: "custom", name: "OwnableUnauthorizedAccount", fromSignatureSubset: true });
  });
});
