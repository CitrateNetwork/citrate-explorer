/**
 * Copy rule (owner): no competitor or other-network names in prose. #49 cleaned
 * the visible copy but left them in the SEO metadata (keywords, description).
 * Technical identifiers are not prose and stay: the EVM, the
 * `wallet_addEthereumChain` RPC method, GHOSTDAG (the consensus protocol).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DESCRIPTION, KEYWORDS, TITLE, TWITTER_DESCRIPTION } from "./metadata";

const OTHER_NETWORKS = /\b(Etherscan|Ethereum|Solana|Akash|Render|Bittensor|Kaspa|Blockscout|Polygon|Arbitrum|Optimism|Avalanche|Bitcoin|Cosmos|Polkadot|NEAR|Aptos|Sui|Tron|BNB|Binance|Base chain)\b/;

describe("site metadata names no other network", () => {
  it("keywords", () => {
    for (const k of KEYWORDS) expect(k, k).not.toMatch(OTHER_NETWORKS);
    expect(KEYWORDS).toContain("CitrateScan");
    expect(KEYWORDS).toContain("Citrate Network");
  });
  it("title and descriptions", () => {
    for (const t of [TITLE, DESCRIPTION, TWITTER_DESCRIPTION]) expect(t).not.toMatch(OTHER_NETWORKS);
  });
  it("the layout uses this module (one source of truth for the metadata)", () => {
    const layout = readFileSync(join(__dirname, "..", "..", "app", "layout.tsx"), "utf8");
    expect(layout).toMatch(/from "@\/lib\/site\/metadata"/);
    expect(layout).not.toMatch(OTHER_NETWORKS);
  });
  it("the developer settings copy describes the REST API without naming another explorer", () => {
    const settings = readFileSync(join(__dirname, "..", "..", "scan", "screens", "settings.tsx"), "utf8").replace(/wallet_addEthereumChain/g, "");
    expect(settings).not.toMatch(OTHER_NETWORKS);
  });
});
