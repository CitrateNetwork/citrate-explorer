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
