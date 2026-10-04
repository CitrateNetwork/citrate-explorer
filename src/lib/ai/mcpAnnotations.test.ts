import { describe, it, expect } from "vitest";
import { citrateTools } from "./tools";
import { READ_ONLY_TOOLS, allReadOnly, annotationsFor } from "./mcpAnnotations";

// MCP hosts that follow the spec (citrate-agent-runtime's agent-mcp-host) offer a tool
// without a member decision only when it says `readOnlyHint: true`. That hint must be
// a per-tool, reviewed claim, never a blanket default, so a tool added to the shared
// registry later cannot inherit "read-only" by accident.

describe("MCP tool annotations are per tool", () => {
  it("the reviewed read-only set is exactly the registry's tool names", () => {
    const names = Object.keys(citrateTools()).sort();
    expect([...READ_ONLY_TOOLS].sort()).toEqual(names);
  });

  it("a reviewed read-only tool is annotated read-only and non-destructive", () => {
    expect(annotationsFor("getBlock")).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("a tool missing from the reviewed set is annotated as a write (fails closed)", () => {
    const a = annotationsFor("submitTransaction");
    expect(a.readOnlyHint).toBe(false);
    expect(a.destructiveHint).toBe(true);
    expect(a.idempotentHint).toBe(false);
    expect(a.openWorldHint).toBe(true);
  });

  it("names are matched exactly, with no case folding or prototype keys", () => {
    expect(annotationsFor("GETBLOCK").readOnlyHint).toBe(false);
    expect(annotationsFor("toString").readOnlyHint).toBe(false);
    expect(annotationsFor("__proto__").readOnlyHint).toBe(false);
    expect(annotationsFor("").readOnlyHint).toBe(false);
  });

  it("the returned annotations cannot be mutated to widen a later answer", () => {
    const a = annotationsFor("getBlock") as { readOnlyHint: boolean };
    expect(Object.isFrozen(a)).toBe(true);
    const w = annotationsFor("submitTransaction") as { readOnlyHint: boolean };
    expect(Object.isFrozen(w)).toBe(true);
  });

  it("the exported reviewed list cannot be widened at runtime", () => {
    expect(Object.isFrozen(READ_ONLY_TOOLS)).toBe(true);
    expect(() => (READ_ONLY_TOOLS as string[]).push("submitTransaction")).toThrow();
    // Even if a caller holds a mutable copy, the decision does not read it.
    const copy = [...READ_ONLY_TOOLS, "submitTransaction"];
    expect(copy).toContain("submitTransaction");
    expect(annotationsFor("submitTransaction").readOnlyHint).toBe(false);
  });

  it("the server-level readOnly flag is false as soon as one tool is unreviewed", () => {
    expect(allReadOnly(Object.keys(citrateTools()))).toBe(true);
    expect(allReadOnly(["getBlock", "submitTransaction"])).toBe(false);
  });
});
