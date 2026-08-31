// A relayer-funded member (nonce 0) is never a transaction `from`/`to` — the relayer and the SBT/vault
// contracts are — so tx-only resolution reads the address as empty/unknown ("can't find that address").
// But the member IS the recipient of the SBT mint (+ any grant transfer) in token_transfers. These tests
// pin that such an address now resolves with real activity + holdings, without fabricating balances.
import { describe, it, expect } from "vitest";
import { deriveAddressView } from "./live";

const MEMBER = "0x99a464c84cff26f4910646dd1b24e36e706d5635";
const SBT = "0xad826d0439f7ad5a3512a8927b632cbca2840e10";
const ZERO = "0x0000000000000000000000000000000000000000";

function resp(overrides: Record<string, unknown> = {}) {
  return {
    balanceSalt: "0.05",
    nonce: 0,
    isContract: false,
    activity: { provisioned: true, address: MEMBER, sent: 0, received: 0, tokenSent: 0, tokenReceived: 1 },
    recentTransactions: { provisioned: true, results: [] },
    tokenTransfers: {
      provisioned: true,
      results: [
        { txHash: "0xabc", blockHeight: 148000, timestamp: 1788000000, standard: "erc721", token: SBT, from: ZERO, to: MEMBER, value: null, tokenId: "1" },
      ],
    },
    ...overrides,
  };
}

describe("address resolution for relayer-funded, nonce-0 recipients", () => {
  it("resolves with real activity + the SBT holding instead of an empty page", () => {
    const v = deriveAddressView(MEMBER, resp());
    expect(v).not.toBeNull();
    expect(v.txCount).toBe(1); // the token receipt counts — not a bare nonce-0 "0 transactions"
    expect(v.txns.length).toBe(1); // the SBT mint appears in history
    expect(v.txns[0].dir).toBe("in");
    expect(v.txns[0].action).toBe("NFT mint");
    expect(v.tokens.length).toBe(1); // the SBT holding is surfaced
    expect(v.tokens[0].balance).toBe("1");
    expect(v.summary).toContain("Holds");
  });

  it("does not fabricate ERC-20 balances — only ERC-721 holdings are surfaced (Rule 1)", () => {
    const v = deriveAddressView(
      MEMBER,
      resp({
        tokenTransfers: {
          provisioned: true,
          results: [
            { txHash: "0xdef", blockHeight: 1, timestamp: 1, standard: "erc20", token: "0xtok", from: ZERO, to: MEMBER, value: "1000", tokenId: null },
          ],
        },
      }),
    );
    expect(v.txns.length).toBe(1); // the transfer still shows in history
    expect(v.tokens.length).toBe(0); // but no fabricated erc20 balance rollup
  });

  it("returns null on an absent/errored response", () => {
    expect(deriveAddressView(MEMBER, null)).toBeNull();
    expect(deriveAddressView(MEMBER, { error: "boom" })).toBeNull();
  });
});
