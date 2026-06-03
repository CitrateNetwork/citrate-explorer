import { describe, it, expect } from "vitest";
import { parseEther, type Address, type Hex } from "viem";
import { saltAmount, getBalance, isContract, exploreDag, getBlock } from "./ops";

const live = process.env.LIVE_RPC === "1";
const liveIt = live ? it : it.skip;

// A real contract on live 40204 (verified has bytecode) and an empty EOA-ish addr.
const KNOWN_CONTRACT = "0x077fbc3338a9e6bad90a3a041e6b7425689754ef" as Address;
const EMPTY_ADDR = "0x0000000000000000000000000000000000000001" as Address;

describe("dual-unit SALT (WP-1.5, X-4, unit)", () => {
  it("round-trips an 18-decimal value with no float loss", () => {
    const amt = saltAmount(parseEther("1.5"));
    expect(amt.grains).toBe("1500000000000000000");
    expect(amt.salt).toBe("1.5");
  });

  it("exposes both SALT and raw grains", () => {
    const amt = saltAmount(123456789n);
    expect(amt.grains).toBe("123456789");
    expect(typeof amt.salt).toBe("string");
  });
});

describe("harness live ops (WP-1.5)", () => {
  liveIt("getBalance returns dual-unit", async () => {
    const r = await getBalance(KNOWN_CONTRACT);
    expect(r.balance.grains).toMatch(/^\d+$/);
    expect(typeof r.balance.salt).toBe("string");
  });

  liveIt("isContract: true for a known contract, false for an empty address", async () => {
    expect(await isContract(KNOWN_CONTRACT)).toBe(true);
    expect(await isContract(EMPTY_ADDR)).toBe(false);
  });

  liveIt("exploreDag walks the selected-parent chain and reports finality", async () => {
    const latest = await getBlock("latest");
    expect(latest.hash).not.toBeNull();
    const walk = await exploreDag(latest.hash as Hex, 5);
    expect(walk.selectedParentChain.length).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(walk.mergeParents)).toBe(true);
    expect(typeof walk.finalized).toBe("boolean");
  });
});
