import { describe, it, expect } from "vitest";
import { encodeAbiParameters } from "viem";
import {
  decodeTransferLog,
  isTransferLog,
  TRANSFER_TOPIC,
  TRANSFER_SINGLE_TOPIC,
  TRANSFER_BATCH_TOPIC,
} from "./transferDecode";

const TOKEN = "0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa";
const OP = "0x9999999999999999999999999999999999999999";
const ALICE = "0x1111111111111111111111111111111111111111";
const BOB = "0x2222222222222222222222222222222222222222";
const topic = (a: string) => `0x000000000000000000000000${a.replace(/^0x/, "")}`;

describe("transferDecode", () => {
  it("decodes an ERC-20 Transfer (3 topics, value in data)", () => {
    const [r] = decodeTransferLog({
      address: TOKEN,
      topics: [TRANSFER_TOPIC, topic(ALICE), topic(BOB)],
      data: "0x0000000000000000000000000000000000000000000000000de0b6b3a7640000", // 1e18
      logIndex: 3,
    });
    expect(r).toMatchObject({ standard: "erc20", token: TOKEN.toLowerCase(), from: ALICE, to: BOB, value: "1000000000000000000", logIndex: 3 });
    expect(r.tokenId).toBeUndefined();
  });

  it("decodes an ERC-721 Transfer (4 topics, tokenId indexed, no value)", () => {
    const [r] = decodeTransferLog({
      address: TOKEN,
      topics: [TRANSFER_TOPIC, topic(ALICE), topic(BOB), `0x${"0".repeat(63)}7`],
      data: "0x",
    });
    expect(r).toMatchObject({ standard: "erc721", from: ALICE, to: BOB, tokenId: "7" });
    expect(r.value).toBeUndefined();
  });

  it("decodes an ERC-1155 TransferSingle (id+value in data, operator skipped)", () => {
    const data = encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [42n, 5n]);
    const [r] = decodeTransferLog({
      address: TOKEN,
      topics: [TRANSFER_SINGLE_TOPIC, topic(OP), topic(ALICE), topic(BOB)],
      data,
    });
    expect(r).toMatchObject({ standard: "erc1155", from: ALICE, to: BOB, tokenId: "42", value: "5" });
  });

  it("decodes an ERC-1155 TransferBatch into one record per id", () => {
    const data = encodeAbiParameters(
      [{ type: "uint256[]" }, { type: "uint256[]" }],
      [
        [1n, 2n],
        [10n, 20n],
      ],
    );
    const rs = decodeTransferLog({
      address: TOKEN,
      topics: [TRANSFER_BATCH_TOPIC, topic(OP), topic(ALICE), topic(BOB)],
      data,
    });
    expect(rs).toHaveLength(2);
    expect(rs.map((r) => [r.tokenId, r.value])).toEqual([
      ["1", "10"],
      ["2", "20"],
    ]);
  });

  it("returns [] for a non-transfer log and recognizes transfer topics", () => {
    expect(decodeTransferLog({ address: TOKEN, topics: ["0xdeadbeef"], data: "0x" })).toEqual([]);
    expect(isTransferLog({ address: TOKEN, topics: [TRANSFER_TOPIC], data: "0x" })).toBe(true);
    expect(isTransferLog({ address: TOKEN, topics: ["0xdeadbeef"], data: "0x" })).toBe(false);
  });

  it("does not throw on malformed data for a transfer-shaped topic", () => {
    expect(decodeTransferLog({ address: TOKEN, topics: [TRANSFER_SINGLE_TOPIC, topic(OP), topic(ALICE), topic(BOB)], data: "0x12" })).toEqual([]);
  });
});
