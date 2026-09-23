import { describe, it, expect } from "vitest";
import type { Hex } from "viem";
import { explainTransaction } from "./explainTransaction";
import { getDagBlock } from "@/lib/citrate/rpc";

const live = process.env.LIVE_RPC === "1";
const liveIt = live ? it : it.skip;

/** Scans recent blocks for the first transaction hash (testnet can be sparse). */
async function findRecentTxHash(scan = 60): Promise<Hex | null> {
  const head = await getDagBlock("latest");
  if (!head) return null;
  for (let h = head.height; h > Math.max(0, head.height - scan); h--) {
    const block = await getDagBlock(h);
    const tx = block?.raw.transactions?.[0];
    if (tx) return tx.hash as Hex;
  }
  return null;
}

describe("explainTransaction synthesis (WP-1.6, live)", () => {
  liveIt("returns only fields grounded in the tx + its logs", async () => {
    const hash = await findRecentTxHash();
    if (!hash) {
      console.warn("[explaintx] no recent tx found in scan window — skipping");
      return;
    }
    const ex = await explainTransaction(hash);
    expect(ex.hash.toLowerCase()).toBe(hash.toLowerCase());
    expect(ex.from).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(["success", "reverted", "pending"]).toContain(ex.status);
    // decodedEvents count never exceeds the raw log count (no invented events).
    expect(ex.decodedEvents.length).toBeLessThanOrEqual(ex.rawLogCount);
    expect(ex.note).toContain(ex.from);
  });
});

// --- pure decodeLog unit tests (no RPC) ---
import { decodeLog } from "./explainTransaction";

const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const APPROVAL = "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";
const topicAddr = (a: string) => `0x000000000000000000000000${a.replace(/^0x/, "")}` as const;
const MODEL_REGISTRY = "0xba36fa0da9327030bd14351db968c8c43c5a67e4"; // current canonical ModelRegistry (src/generated/addresses.json)
const ALICE = "0x1111111111111111111111111111111111111111";
const BOB = "0x2222222222222222222222222222222222222222";

describe("decodeLog — labeled ERC-20/721 event decoding", () => {
  it("decodes an ERC-20 Transfer (3 topics + data = amount)", () => {
    const e = decodeLog({
      address: MODEL_REGISTRY,
      topics: [TRANSFER, topicAddr(ALICE), topicAddr(BOB)],
      data: "0x0000000000000000000000000000000000000000000000000de0b6b3a7640000", // 1e18
    });
    expect(e.type).toBe("ERC-20 Transfer");
    expect(e.from?.toLowerCase()).toBe(ALICE);
    expect(e.to?.toLowerCase()).toBe(BOB);
    expect(e.valueRaw).toBe("1000000000000000000");
    expect(e.value).toBe("1");
    expect(e.tokenId).toBeUndefined();
    expect(e.contractLabel).toBe("ModelRegistry"); // known-address labeling
  });

  it("decodes an ERC-721 Transfer (4 topics, tokenId indexed, no amount)", () => {
    const e = decodeLog({
      address: BOB,
      topics: [TRANSFER, topicAddr(ALICE), topicAddr(BOB), `0x${"0".repeat(63)}7`],
      data: "0x",
    });
    expect(e.type).toBe("ERC-721 Transfer");
    expect(e.tokenId).toBe("7");
    expect(e.valueRaw).toBeUndefined();
  });

  it("decodes an ERC-20 Approval", () => {
    const e = decodeLog({ address: ALICE, topics: [APPROVAL, topicAddr(ALICE), topicAddr(BOB)], data: "0x05" });
    expect(e.type).toBe("ERC-20 Approval");
    expect(e.owner?.toLowerCase()).toBe(ALICE);
    expect(e.spender?.toLowerCase()).toBe(BOB);
  });

  it("flags an unknown event with its topic0", () => {
    const e = decodeLog({ address: ALICE, topics: ["0xdeadbeef"], data: "0x" });
    expect(e.type).toBe("unknown");
    expect(e.topic0).toBe("0xdeadbeef");
  });
});
