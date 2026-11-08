/**
 * The shell's slot for the agent: the page the reader is on, as a small typed
 * value the EXP-AGENT lane consumes. This lane only produces it.
 */
import { describe, expect, it } from "vitest";
import { agentContextFromRoute, agentContextLabel, CITRATE_NETWORK } from "./agentContext";

const A = "0x" + "ab".repeat(20);
const T = "0x" + "cd".repeat(32);

describe("agentContextFromRoute", () => {
  it("names the network on every page", () => {
    expect(CITRATE_NETWORK).toEqual({ chainId: 40204, name: "Citrate testnet" });
    expect(agentContextFromRoute({ name: "home" })).toEqual({ kind: "network", id: null, network: CITRATE_NETWORK });
  });
  it("carries the entity being viewed", () => {
    expect(agentContextFromRoute({ name: "block", id: "123" })).toEqual({ kind: "block", id: "123", network: CITRATE_NETWORK });
    expect(agentContextFromRoute({ name: "tx", id: T }).kind).toBe("tx");
    expect(agentContextFromRoute({ name: "address", id: A })).toMatchObject({ kind: "address", id: A });
    expect(agentContextFromRoute({ name: "contract", id: A })).toMatchObject({ kind: "contract", id: A });
    expect(agentContextFromRoute({ name: "dag", id: T })).toMatchObject({ kind: "dag", id: T });
    expect(agentContextFromRoute({ name: "agent", id: "7" })).toMatchObject({ kind: "agent", id: "7" });
  });
  it("maps the other screens", () => {
    expect(agentContextFromRoute({ name: "dev" }).kind).toBe("developer");
    expect(agentContextFromRoute({ name: "settings" }).kind).toBe("settings");
    expect(agentContextFromRoute({ name: "verify", id: A })).toMatchObject({ kind: "verify", id: A });
    expect(agentContextFromRoute({ name: "nonsense" }).kind).toBe("network");
  });
  it("drops unsafe ids (the context reaches the model and the write gate)", () => {
    expect(agentContextFromRoute({ name: "tx", id: "<script>" }).id).toBeNull();
    expect(agentContextFromRoute({ name: "contract", id: "0x1;drop" }).id).toBeNull();
    expect(agentContextFromRoute({ name: "contract", id: A }).id).toBe(A);
  });
});

describe("agentContextLabel", () => {
  it("reads as plain words for the panel strip", () => {
    expect(agentContextLabel({ kind: "network", id: null, network: CITRATE_NETWORK })).toBe("Network state, chain 40204");
    expect(agentContextLabel({ kind: "block", id: "123", network: CITRATE_NETWORK })).toBe("Block 123");
    expect(agentContextLabel({ kind: "tx", id: T, network: CITRATE_NETWORK })).toBe("Transaction 0xcdcdcd…cdcd");
    expect(agentContextLabel({ kind: "address", id: A, network: CITRATE_NETWORK })).toBe("Address 0xabab…abab");
  });
});
