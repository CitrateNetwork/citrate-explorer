/**
 * MCP write tools return prepare-only results. An MCP client can never execute
 * a write: no tool sends, signs or relays, prepare_write's result is
 * executable:false with an approval link, and the manifest says so.
 */
import { describe, it, expect } from "vitest";
import { GET, POST } from "./route";
import { READ_ONLY_TOOLS } from "@/lib/ai/mcpAnnotations";
import { CONTRACT_TOOL_NAMES } from "@/lib/ai/contractTools";

let ip = 0;
const rpc = (body: unknown) => {
  ip += 1;
  return POST(new Request("http://x/api/mcp", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.77.0.${ip}` }, body: JSON.stringify(body) }));
};

describe("MCP contract tools", () => {
  it("lists every contract tool, annotated read-only (they only read or simulate)", async () => {
    const json = await (await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" })).json();
    const byName = Object.fromEntries(json.result.tools.map((t: { name: string }) => [t.name, t]));
    for (const n of CONTRACT_TOOL_NAMES) {
      expect(byName[n], n).toBeDefined();
      expect(byName[n].annotations.readOnlyHint, n).toBe(true);
      expect(READ_ONLY_TOOLS).toContain(n);
    }
  });

  it("offers no tool that could execute a write", async () => {
    const json = await (await GET()).json();
    expect(json.readOnly).toBe(true);
    for (const t of json.tools as Array<{ name: string; description: string }>) {
      expect(t.name).not.toMatch(/send|sign|relay|execute|submit|approve_write/i);
    }
  });

  it("initialize tells the client that prepare_write only proposes", async () => {
    const json = await (await rpc({ jsonrpc: "2.0", id: 2, method: "initialize", params: {} })).json();
    expect(json.result.instructions).toMatch(/prepare_write only PROPOSES/);
    expect(json.result.instructions).toMatch(/Nothing here can execute a write/);
  });

  it("prepare_write validates its arguments before any chain call (-32602)", async () => {
    const json = await (
      await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "prepare_write", arguments: { address: "0x12", function: "transfer" } } })
    ).json();
    expect(json.error.code).toBe(-32602);
  });

  it("prepare_write rejects a malformed SALT value (-32602)", async () => {
    const json = await (
      await rpc({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "prepare_write", arguments: { address: "0x1000000000000000000000000000000000000001", function: "deposit", value: "1e18" } },
      })
    ).json();
    expect(json.error.code).toBe(-32602);
  });

  it("explain_prepared_write refuses an object that claims to be executable (-32602)", async () => {
    const json = await (
      await rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "explain_prepared_write", arguments: { prepared: { executable: true } } } })
    ).json();
    expect(json.error.code).toBe(-32602);
  });
});
