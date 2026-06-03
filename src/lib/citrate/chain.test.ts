import { describe, it, expect } from "vitest";
import { citrate, CITRATE_CHAIN_ID } from "./chain";

describe("citrate chain config (WP-1.1)", () => {
  it("has chain id 40204 (0x9d0c)", () => {
    expect(CITRATE_CHAIN_ID).toBe(40204);
    expect(citrate.id).toBe(40204);
    expect(`0x${citrate.id.toString(16)}`).toBe("0x9d0c");
  });

  it("uses SALT as the native currency with 18 decimals", () => {
    expect(citrate.nativeCurrency.symbol).toBe("SALT");
    expect(citrate.nativeCurrency.decimals).toBe(18);
  });

  it("exposes http + websocket RPC URLs", () => {
    expect(citrate.rpcUrls.default.http[0]).toMatch(/^https?:\/\//);
    expect(citrate.rpcUrls.default.webSocket?.[0]).toMatch(/^wss?:\/\//);
  });
});
