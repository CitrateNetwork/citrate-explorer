// HUP US-7.1 AC2: /api/agents and /api/agents/[tokenId] refuse bad input before any chain read,
// and answer honestly when this build's address book names no AgentSBT. The reads themselves run
// against a real anvil deploy in src/lib/harness/agentSbt.anvil.test.ts.
import { describe, it, expect, afterEach } from "vitest";
import { GET as list } from "./route";
import { GET as one } from "./[tokenId]/route";
import { NO_REGISTRY_NOTE } from "@/lib/harness/agentSbt";

let ipSeq = 0;
const req = (path: string) => {
  ipSeq += 1;
  return new Request(`http://x${path}`, { headers: { "x-forwarded-for": `10.71.0.${ipSeq}` } });
};
const ctx = (tokenId: string) => ({ params: Promise.resolve({ tokenId }) });

const saved = process.env.NEXT_PUBLIC_AGENT_SBT;
afterEach(() => {
  if (saved === undefined) delete process.env.NEXT_PUBLIC_AGENT_SBT;
  else process.env.NEXT_PUBLIC_AGENT_SBT = saved;
});

describe("GET /api/agents/[tokenId]", () => {
  it.each([["-1"], ["01"], ["abc"], ["0x1"], ["18446744073709551616"]])("400 for token id %j", async (id) => {
    const res = await one(req(`/api/agents/${id}`), ctx(id));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/invalid token id/);
  });

  it("404 with a plain reason when the address book names no AgentSBT", async () => {
    process.env.NEXT_PUBLIC_AGENT_SBT = "0xnot-an-address";
    const res = await one(req("/api/agents/0"), ctx("0"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/no AgentSBT/);
  });
});

describe("GET /api/agents", () => {
  it.each([["before=-1"], ["before=x"], ["limit=0"], ["limit=26"], ["limit=2.5"], ["limit=abc"]])("400 for %s", async (q) => {
    const res = await list(req(`/api/agents?${q}`));
    expect(res.status).toBe(400);
  });

  it("an address book without AgentSBT renders an empty list with a note, not an error", async () => {
    process.env.NEXT_PUBLIC_AGENT_SBT = "0x1234";
    const res = await list(req("/api/agents"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ registry: null, agents: [], nextBefore: null, note: NO_REGISTRY_NOTE });
  });
});
