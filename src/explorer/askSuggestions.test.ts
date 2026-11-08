/**
 * The Ask panel's empty state suggests questions about the page on screen (the
 * shell's AgentContext), not the prototype's sample data (#49 flagged SD.AGENT).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { askSuggestions } from "./askSuggestions";
import { AGENT_CONTEXT_KINDS, CITRATE_NETWORK, type AgentContext } from "./agentContext";
import { hasWriteIntent } from "@/lib/agent/writeIntent";

const A = "0x" + "ab".repeat(20);
const T = "0x" + "cd".repeat(32);
const ctx = (kind: AgentContext["kind"], id: string | null = null): AgentContext => ({ kind, id, network: CITRATE_NETWORK });

describe("askSuggestions", () => {
  it("offers 2 to 4 suggestions for every page kind", () => {
    for (const k of AGENT_CONTEXT_KINDS) {
      const s = askSuggestions(ctx(k));
      expect(s.length, k).toBeGreaterThanOrEqual(2);
      expect(s.length, k).toBeLessThanOrEqual(4);
      for (const x of s) {
        expect(x.prompt.length).toBeGreaterThan(8);
        expect(x.label.length).toBeGreaterThan(4);
      }
    }
  });

  it("names the entity on screen, in full in the prompt and short in the label", () => {
    const tx = askSuggestions(ctx("tx", T));
    expect(tx.some((s) => s.prompt.includes(T))).toBe(true);
    expect(tx.every((s) => !s.label.includes(T))).toBe(true);
    expect(askSuggestions(ctx("contract", A)).some((s) => s.prompt.includes(A))).toBe(true);
    expect(askSuggestions(ctx("block", "123")).some((s) => s.prompt.includes("123"))).toBe(true);
  });

  it("contains no sample data", () => {
    const all = AGENT_CONTEXT_KINDS.flatMap((k) => askSuggestions(ctx(k, k === "tx" ? T : A)).map((s) => s.prompt + " " + s.label)).join(" ");
    expect(all).not.toMatch(/0x9f4a|0x3a1c|alice|bob|cWETH|…2f4e1/i);
  });

  it("every suggestion is a read: none opens the write-intent gate", () => {
    for (const k of AGENT_CONTEXT_KINDS) for (const s of askSuggestions(ctx(k, A))) expect(hasWriteIntent(s.prompt), s.prompt).toBe(false);
  });

  it("the Ask panel uses them, not SD.AGENT's prompts or sample entities", () => {
    const panel = readFileSync(join(__dirname, "..", "scan", "screens", "agent.tsx"), "utf8");
    expect(panel).toMatch(/askSuggestions\(/);
    expect(panel).not.toMatch(/SD\.AGENT|AG\.prompts|SD\.L\.|SD\.TIP_BLOCK/);
  });
});
