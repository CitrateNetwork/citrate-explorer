/**
 * Owner requirement 2026-11-07: the redesign keeps every agentic capability.
 * This guard fails if a route, its handlers, or the agent surface in the shell
 * is removed. Behavior of each route is covered by its own route tests; this
 * file pins that nothing disappears.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const ROUTES: Array<[string, string[]]> = [
  ["src/app/api/chat/route.ts", ["POST"]],
  ["src/app/api/agents/route.ts", ["GET"]],
  ["src/app/api/agents/[tokenId]/route.ts", ["GET"]],
  ["src/app/api/mcp/route.ts", ["GET", "POST"]],
  ["src/app/api/threads/route.ts", ["GET", "POST"]],
  ["src/app/api/threads/[id]/route.ts", ["GET", "PATCH", "DELETE"]],
  ["src/app/api/relay/route.ts", ["POST"]],
  ["src/app/api/keys/route.ts", ["GET", "POST", "DELETE"]],
  ["src/app/api/watchlist/route.ts", ["GET", "POST", "DELETE"]],
  ["src/app/api/settings/route.ts", ["GET", "PUT"]],
];

describe("agentic routes are all still served", () => {
  for (const [file, methods] of ROUTES) {
    it(`${file} exports ${methods.join(", ")}`, () => {
      expect(existsSync(join(ROOT, file))).toBe(true);
      const src = read(file);
      for (const m of methods) {
        expect(src).toMatch(new RegExp(`export (async )?(function ${m}\\b|const ${m}\\b|\\{[^}]*\\b${m}\\b)`));
      }
    });
  }
});

describe("the direction-B shell keeps the agent surfaces", () => {
  const app = read("src/scan/app.tsx");
  it("mounts the agent panel with the typed page context", () => {
    expect(app).toMatch(/<AgentPanel[^>]*pageContext=/);
  });
  it("keeps the command palette with its Ask row", () => {
    expect(app).toContain("<CommandPalette");
    expect(app).toContain("Ask the agent");
  });
  it("routes the registered-agents screens", () => {
    expect(app).toContain("AgentsScreen");
    expect(app).toContain("AgentScreen");
  });
  it("sends the page context with each chat request", () => {
    expect(read("src/scan/screens/agent.tsx")).toMatch(/pageContext: pageContextRef\.current/);
  });
});
