// HUP US-7.1 AC2: the pure half of the explorer's AgentSBT view. The address lookup, the token-id
// parser that stands in front of every read, and the DID naming rule (a DID string is shown only
// when its keccak-256 equals the stored hash).
import { describe, it, expect } from "vitest";
import { keccak256, stringToBytes, toEventSelector } from "viem";
import {
  AGENT_TRANSFER_EVENT,
  MAX_AGENT_TOKEN_ID,
  TRANSFER_TOPIC,
  agentDidFor,
  agentSbtAddress,
  describeDid,
  isAgentSbt,
  parseAgentTokenId,
  tokenIdTopic,
} from "./agentSbt";
import canonical from "@/generated/addresses.json";

const OWNER = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";
const BOOK_SBT = (canonical.contracts as Record<string, string>).AgentSBT;

describe("agentSbtAddress", () => {
  it("reads the AgentSBT pinned in the canonical address book", () => {
    expect(BOOK_SBT).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(agentSbtAddress(undefined)).toBe(BOOK_SBT.toLowerCase());
  });

  it("prefers a well-formed override (preview, staging, local anvil)", () => {
    expect(agentSbtAddress("0x00000000000000000000000000000000000000AA")).toBe("0x00000000000000000000000000000000000000aa");
  });

  it("an empty override falls back to the book", () => {
    expect(agentSbtAddress("")).toBe(BOOK_SBT.toLowerCase());
  });

  it("a malformed override yields null instead of reading the book's contract", () => {
    expect(agentSbtAddress("0x1234")).toBeNull();
    expect(agentSbtAddress("not-an-address")).toBeNull();
  });

  it("a book without AgentSBT yields null", () => {
    expect(agentSbtAddress(undefined, { ModelRegistry: BOOK_SBT })).toBeNull();
    expect(agentSbtAddress(undefined, { AgentSBT: "0xdead" })).toBeNull();
  });

  it("isAgentSbt matches case-insensitively and never matches without a registry", () => {
    const sbt = agentSbtAddress(undefined);
    expect(isAgentSbt(BOOK_SBT.toUpperCase().replace("0X", "0x"), sbt)).toBe(true);
    expect(isAgentSbt(OWNER, sbt)).toBe(false);
    expect(isAgentSbt(BOOK_SBT, null)).toBe(false);
    expect(isAgentSbt(null, sbt)).toBe(false);
  });
});

describe("parseAgentTokenId", () => {
  it.each([
    ["0", 0n],
    ["7", 7n],
    ["18446744073709551615", MAX_AGENT_TOKEN_ID],
  ])("accepts %j", (raw, want) => {
    expect(parseAgentTokenId(raw)).toBe(want);
  });

  it.each([["-1"], ["01"], ["1.0"], [" 1"], ["1 "], ["0x1"], [""], ["1e3"], ["18446744073709551616"], ["123456789012345678901"]])(
    "refuses %j",
    (raw) => {
      expect(parseAgentTokenId(raw)).toBeNull();
    },
  );

  it("accepts a safe non-negative integer number and refuses anything else", () => {
    expect(parseAgentTokenId(3)).toBe(3n);
    expect(parseAgentTokenId(-1)).toBeNull();
    expect(parseAgentTokenId(1.5)).toBeNull();
    expect(parseAgentTokenId(Number.MAX_SAFE_INTEGER + 1)).toBeNull();
    expect(parseAgentTokenId(null)).toBeNull();
    expect(parseAgentTokenId(undefined)).toBeNull();
  });
});

describe("Transfer topic and token-id topic", () => {
  it("TRANSFER_TOPIC is the keccak of the ERC-721 Transfer signature", () => {
    expect(TRANSFER_TOPIC).toBe(keccak256(stringToBytes("Transfer(address,address,uint256)")));
    expect(toEventSelector(AGENT_TRANSFER_EVENT)).toBe(TRANSFER_TOPIC);
  });

  it("tokenIdTopic left-pads the id to one 32-byte word", () => {
    expect(tokenIdTopic(0n)).toBe(`0x${"0".repeat(64)}`);
    expect(tokenIdTopic(255n)).toBe(`0x${"0".repeat(62)}ff`);
    expect(tokenIdTopic(MAX_AGENT_TOKEN_ID)).toBe(`0x${"0".repeat(48)}${"f".repeat(16)}`);
  });
});

describe("DID naming", () => {
  it("agentDidFor is did:citrate:agent:<owner, lowercase>, matching citrate-core's mint", () => {
    expect(agentDidFor(OWNER)).toBe(`did:citrate:agent:${OWNER.toLowerCase()}`);
    expect(agentDidFor("0x12")).toBeNull();
  });

  it("names the DID string when the stored hash is the owner's DID hash", () => {
    const hash = keccak256(stringToBytes(`did:citrate:agent:${OWNER.toLowerCase()}`));
    const v = describeDid(hash, OWNER);
    expect(v.did).toBe(`did:citrate:agent:${OWNER.toLowerCase()}`);
    expect(v.hash).toBe(hash);
    expect(v.empty).toBe(false);
  });

  it("shows only the raw hash when the stored hash is some other DID", () => {
    const other = keccak256(stringToBytes("did:citrate:agent:someone-else"));
    const v = describeDid(other, OWNER);
    expect(v.did).toBeNull();
    expect(v.hash).toBe(other);
  });

  it("does not name a DID without an owner, and flags an all-zero hash as empty", () => {
    const hash = keccak256(stringToBytes(`did:citrate:agent:${OWNER.toLowerCase()}`));
    expect(describeDid(hash, null).did).toBeNull();
    const zero = describeDid(`0x${"0".repeat(64)}`, OWNER);
    expect(zero.empty).toBe(true);
    expect(zero.did).toBeNull();
  });

  it("lowercases a mixed-case stored hash before comparing", () => {
    const hash = keccak256(stringToBytes(`did:citrate:agent:${OWNER.toLowerCase()}`));
    const upper = `0x${hash.slice(2).toUpperCase()}`;
    expect(describeDid(upper, OWNER).did).toBe(`did:citrate:agent:${OWNER.toLowerCase()}`);
  });
});
