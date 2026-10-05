// HUP US-7.1 AC2: the AgentSBT screens' view models. The empty registry must render
// "No agents registered yet." (today's 40204), a DID string is shown only when the route
// named one, and an address page links only to agents the address still holds.
import { describe, it, expect } from "vitest";
import { deriveAgentsView, deriveAgentView, agentIdsHeldBy, EMPTY_AGENTS_LINE } from "./agentView";
import { deriveAddressView } from "./live";
import canonical from "@/generated/addresses.json";

const ZERO = "0x0000000000000000000000000000000000000000";
const SBT = "0xd16b1ad6e744f3e92223c65f492c35d36ae07c7b";
const OWNER = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const OTHER = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
const DID = `did:citrate:agent:${OWNER}`;
const HASH = `0x${"ab".repeat(32)}`;
const TX = `0x${"12".repeat(32)}`;

const registry = (total: string) => ({ address: SBT, deployed: true, total, orgContract: OTHER });

describe("deriveAgentsView", () => {
  it("an empty registry shows the route's note, which is 'No agents registered yet.'", () => {
    const v = deriveAgentsView({ registry: registry("0"), agents: [], nextBefore: null, note: "No agents registered yet." });
    expect(v?.rows).toEqual([]);
    expect(v?.total).toBe(0);
    expect(v?.deployed).toBe(true);
    expect(v?.emptyLine).toBe("No agents registered yet.");
  });

  it("falls back to the same line when the route sent no note", () => {
    expect(deriveAgentsView({ registry: registry("0"), agents: [], nextBefore: null, note: null })?.emptyLine).toBe(EMPTY_AGENTS_LINE);
  });

  it("an address book without AgentSBT says so instead of an empty table", () => {
    const v = deriveAgentsView({ registry: null, agents: [], nextBefore: null, note: "This explorer's address book has no AgentSBT for this chain." });
    expect(v?.registry).toBeNull();
    expect(v?.emptyLine).toMatch(/no AgentSBT/);
  });

  it("maps rows, naming a DID only when the route matched it", () => {
    const v = deriveAgentsView({
      registry: registry("2"),
      agents: [
        { tokenId: "1", owner: OTHER, parentOrgId: "0", did: { hash: HASH, did: null, empty: false }, quarantined: true },
        { tokenId: "0", owner: OWNER, parentOrgId: "0", did: { hash: HASH, did: DID, empty: false }, quarantined: false },
      ],
      nextBefore: null,
      note: null,
    });
    expect(v?.emptyLine).toBeNull();
    expect(v?.total).toBe(2);
    expect(v?.rows.map((r) => [r.tokenId, r.didLabel, r.didNamed, r.quarantined])).toEqual([
      ["1", HASH, false, true],
      ["0", DID, true, false],
    ]);
  });

  it("returns null on an errored response", () => {
    expect(deriveAgentsView(null)).toBeNull();
    expect(deriveAgentsView({ error: "upstream" })).toBeNull();
  });
});

describe("deriveAgentView", () => {
  const detail = (over: Record<string, unknown> = {}) => ({
    registry: SBT,
    tokenId: "0",
    owner: OWNER,
    did: { hash: HASH, did: DID, empty: false },
    pubkeyFingerprint: `0x${"cd".repeat(32)}`,
    quarantined: false,
    parentOrg: { id: "0", contract: OTHER, did: HASH, active: true, signingAuthority: OTHER },
    mint: { from: ZERO, to: OWNER, txHash: TX, blockNumber: "42", logIndex: 0 },
    transfers: [{ from: ZERO, to: OWNER, txHash: TX, blockNumber: "42", logIndex: 0 }],
    history: { source: "rpc-window", fromBlock: "0", toBlock: "50", complete: true },
    ...over,
  });

  it("maps DID, owner, parent org and the mint tx", () => {
    const v = deriveAgentView(detail());
    expect(v?.owner).toBe(OWNER);
    expect(v?.didLabel).toBe(DID);
    expect(v?.didNamed).toBe(true);
    expect(v?.mintTx).toBe(TX);
    expect(v?.mintBlock).toBe("42");
    expect(v?.parentOrg.active).toBe(true);
    expect(v?.transfers).toEqual([{ kind: "mint", from: ZERO, to: OWNER, txHash: TX, blockNumber: "42" }]);
    expect(v?.summary).toContain("Agent #0");
    expect(v?.summary).toContain("an active parent organization #0");
    expect(v?.summary).toContain(DID);
    expect(v?.historyNote).toBe("History from Transfer logs, blocks 0 to 50.");
  });

  it("says when the mint is older than the scanned window instead of inventing one", () => {
    const v = deriveAgentView(
      detail({ mint: null, transfers: [], history: { source: "rpc-window", fromBlock: "90001", toBlock: "100000", complete: false } }),
    );
    expect(v?.mintTx).toBeNull();
    expect(v?.historyNote).toMatch(/older than this window/);
  });

  it("names the indexer as the source when it supplied the history", () => {
    expect(deriveAgentView(detail({ history: { source: "indexer", fromBlock: null, toBlock: null, complete: true } }))?.historyNote).toBe(
      "History from the explorer's index.",
    );
  });

  it("labels burns and reports quarantine and an unmatched DID", () => {
    const v = deriveAgentView(
      detail({
        quarantined: true,
        did: { hash: HASH, did: null, empty: false },
        transfers: [
          { from: ZERO, to: OWNER, txHash: TX, blockNumber: "1", logIndex: 0 },
          { from: OWNER, to: ZERO, txHash: TX, blockNumber: "2", logIndex: 0 },
        ],
      }),
    );
    expect(v?.transfers.map((t) => t.kind)).toEqual(["mint", "burn"]);
    expect(v?.didNamed).toBe(false);
    expect(v?.didLabel).toBe(HASH);
    expect(v?.summary).toContain("quarantined");
  });

  it("returns null on a 404 or errored response", () => {
    expect(deriveAgentView({ error: "agent #3 is not registered" })).toBeNull();
    expect(deriveAgentView(null)).toBeNull();
  });
});

describe("address page links to agents", () => {
  const tt = (rows: unknown[]) => ({ provisioned: true, results: rows });

  it("lists the AgentSBT ids an address received and still holds", () => {
    const ids = agentIdsHeldBy(
      OWNER,
      tt([
        { token: SBT, tokenId: "3", from: ZERO, to: OWNER, blockHeight: 10 },
        { token: SBT, tokenId: "1", from: ZERO, to: OWNER, blockHeight: 5 },
        { token: OTHER, tokenId: "9", from: ZERO, to: OWNER, blockHeight: 6 },
      ]),
      SBT,
    );
    expect(ids).toEqual(["1", "3"]);
  });

  it("drops an id the address later sent away, whatever order the rows arrive in", () => {
    const rows = [
      { token: SBT, tokenId: "1", from: OWNER, to: ZERO, blockHeight: 20 },
      { token: SBT, tokenId: "1", from: ZERO, to: OWNER, blockHeight: 10 },
    ];
    expect(agentIdsHeldBy(OWNER, tt(rows), SBT)).toEqual([]);
  });

  it("is empty without an index or without a registry", () => {
    expect(agentIdsHeldBy(OWNER, { provisioned: false, note: "x" }, SBT)).toEqual([]);
    expect(agentIdsHeldBy(OWNER, tt([{ token: SBT, tokenId: "1", from: ZERO, to: OWNER }]), null)).toEqual([]);
  });

  it("deriveAddressView carries the agent ids and flags the registry's own address", () => {
    const book = (canonical.contracts as Record<string, string>).AgentSBT.toLowerCase();
    const resp = (addr: string) => ({
      balanceSalt: "0",
      nonce: 0,
      isContract: addr === book,
      activity: { provisioned: true, address: addr, sent: 0, received: 0, tokenSent: 0, tokenReceived: 1 },
      tokenTransfers: tt([{ txHash: TX, blockHeight: 1, timestamp: 1, standard: "erc721", token: book, from: ZERO, to: OWNER, value: null, tokenId: "0" }]),
    });
    const holder = deriveAddressView(OWNER, resp(OWNER));
    expect(holder.agentIds).toEqual(["0"]);
    expect(holder.isAgentRegistry).toBe(false);
    const registryPage = deriveAddressView(book, resp(book));
    expect(registryPage.isAgentRegistry).toBe(true);
  });
});
