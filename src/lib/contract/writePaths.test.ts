/**
 * No write path bypasses approval: from the contract page (UI), from chat, or
 * from MCP. Every send in the explorer must go
 *
 *   request/form → kit prepareWrite (prepareFromRequest) → the one approval dialog
 *   → kit approveWrite (inside the Approve click) → kit executeWrite → the wallet
 *
 * Part static (a tripwire over the source tree: who may touch the wallet and the
 * kit's send functions), part behavioural (the chat and MCP tool sets, and a
 * prepared write's flags).
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..", "..", "..");
const SRC = join(ROOT, "src");

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name === "__fixtures__" || name === "tests") continue;
      out.push(...files(p));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !/\.testutil\.ts$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

const PROD = files(SRC).map((p) => ({ path: relative(ROOT, p), text: readFileSync(p, "utf8") }));
const hits = (re: RegExp) => PROD.filter((f) => re.test(f.text)).map((f) => f.path).sort();
// Strip comments so prose about a function does not count as a call.
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const callHits = (re: RegExp) => PROD.filter((f) => re.test(code(f.text))).map((f) => f.path).sort();

describe("the kit's send functions have exactly one caller", () => {
  it("executeWrite is called only by the approval state machine", () => {
    expect(callHits(/\bexecuteWrite\s*\(/).filter((p) => p !== "src/lib/contract/kit.ts")).toEqual(["src/lib/agent/approval.ts"]);
  });

  it("approveWrite is called only by the approval state machine", () => {
    expect(callHits(/\bapproveWrite\s*\(/).filter((p) => p !== "src/lib/contract/kit.ts")).toEqual(["src/lib/agent/approval.ts"]);
  });

  it("the approval state machine is driven only by the one approval dialog", () => {
    expect(callHits(/from\s+["']@\/lib\/agent\/approval["']/).filter((p) => !p.endsWith("approval-view.tsx"))).toEqual(["src/scan/approval.tsx"]);
  });
});

describe("only the approval dialog can reach the user's wallet (UI)", () => {
  it("wallet send/sign hooks are used only by the dialog (and the relay hook it calls)", () => {
    expect(callHits(/\buseSendTransaction\b|\buseWriteContract\b|\buseSignTypedData\b|\bsignTypedDataAsync\b/)).toEqual(["src/lib/citrate/use-sponsored-write.ts", "src/scan/approval.tsx"]);
  });

  it("the gasless relay hook is used only by the dialog", () => {
    expect(callHits(/\buseSponsoredWrite\s*\(/).filter((p) => p !== "src/lib/citrate/use-sponsored-write.ts")).toEqual(["src/scan/approval.tsx"]);
  });

  it("the contract page's Write tab opens the shared dialog and has no send path of its own", () => {
    const w = PROD.find((f) => f.path === "src/scan/contract/WritePane.tsx")!.text;
    expect(w).toMatch(/<ApprovalDialog\b/);
    expect(code(w)).not.toMatch(/useSendTransaction|useSponsoredWrite|executeWrite|approveWrite|sendTransaction/);
  });

  it("the chat card and MCP approval links open the same dialog", () => {
    const a = PROD.find((f) => f.path === "src/scan/approval.tsx")!.text;
    expect(a).toMatch(/export function PreparedWriteCard[\s\S]*<ApprovalDialog\b/);
    expect(a).toMatch(/export function ApproveScreen[\s\S]*<ApprovalDialog\b/);
    // The Approve click handler is the only place approve() is called.
    expect(code(a).match(/\bapprove\(state, connected\)/g)?.length).toBe(1);
  });
});

describe("server code cannot approve or send (chat, MCP, API routes)", () => {
  const server = PROD.filter((f) => f.path.startsWith("src/app/api/") || f.path.startsWith("src/lib/ai/") || f.path.startsWith("src/lib/agent/") && f.path !== "src/lib/agent/approval.ts");
  it("no server module imports the approval machine, the kit's send functions, or wagmi", () => {
    for (const f of server) {
      const c = code(f.text);
      expect(c, f.path).not.toMatch(/from\s+["']@\/lib\/agent\/approval["']|from\s+["']\.\/approval["']/);
      expect(c, f.path).not.toMatch(/\b(executeWrite|approveWrite)\b/);
      expect(c, f.path).not.toMatch(/from\s+["']wagmi/);
    }
  });

  it("the agent's preparation is the kit's (one code path): the adapter prepares through prepareFromRequest", () => {
    const m = code(PROD.find((f) => f.path === "src/lib/agent/contractModule.ts")!.text);
    expect(m).toMatch(/prepareFromRequest\(/);
    expect(m).toMatch(/from\s+["']@\/lib\/contract\/kit["']/);
    // No second simulation / risk implementation in the agent.
    expect(m).not.toMatch(/\bassessRisk\(|estimateGas\(|eth_estimateGas"\s*,/);
  });

  it("the chat and MCP tool sets contain no tool that sends, signs, relays or executes", async () => {
    const { citrateTools } = await import("@/lib/ai/tools");
    for (const surface of ["chat", "mcp"] as const) {
      const names = Object.keys(citrateTools({ surface }));
      expect(names, surface).toContain("prepare_write");
      for (const n of names) expect(n, `${surface}:${n}`).not.toMatch(/send|sign|relay|execute|submit|broadcast|approve_write|write_contract/i);
    }
  });
});

describe("a prepared write is a proposal on every surface", () => {
  it("the kit marks it executable:false and the agent's wire form keeps it", async () => {
    const { fakeChain, kitPrepare, MALLORY } = await import("@/lib/agent/tests/fakeChain");
    const { createContractModule } = await import("@/lib/agent/contractModule");
    const f = fakeChain();
    const kit = await kitPrepare(f, { function: "transfer", args: [MALLORY, "1"] });
    expect(kit.executable).toBe(false);
    expect(Object.isFrozen(kit)).toBe(true);
    const wire = await createContractModule(f.deps).prepareWrite({ address: kit.to, function: "transfer", args: [MALLORY, "1"], origin: "mcp" });
    expect(wire.executable).toBe(false);
  });
});
