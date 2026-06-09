import { describe, it, expect } from "vitest";
import { GET, POST } from "./route";

// These exercise the JSON-RPC transport + validation only — no network method is
// invoked (tools/call here is an invalid-args case that fails validation before
// any RPC). Live tool execution is covered by the dev smoke + harness ops tests.

let ipSeq = 0;
function rpc(body: unknown): Promise<Response> {
  // Unique source IP per call → each request gets its own rate-limit bucket so
  // the suite never trips the anonymous limiter on itself.
  ipSeq += 1;
  return POST(
    new Request("http://x/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `10.9.0.${ipSeq}` },
      body: JSON.stringify(body),
    }),
  );
}

describe("MCP GET — discovery manifest", () => {
  it("advertises the read-only tool surface", async () => {
    const res = await GET();
    const json = await res.json();
    expect(json.protocol).toBe("mcp");
    expect(json.readOnly).toBe(true);
    expect(Array.isArray(json.tools)).toBe(true);
    // RA-4: generated from the agent's tool set — same surface, no drift.
    expect(json.tools.length).toBe(22);
    const names = json.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("exploreDag");
    expect(names).toContain("findTransfers"); // was missing from the old hand-written list
    expect(names).toContain("ledger");
    expect(names).toContain("describeContract"); // RA-5 — auto-flows via the shared registry
  });
});

describe("MCP POST — JSON-RPC transport", () => {
  it("responds to initialize with serverInfo + protocolVersion", async () => {
    const json = await (await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })).json();
    expect(json.result.serverInfo.name).toBe("citratescan");
    expect(json.result.protocolVersion).toBeTruthy();
    expect(json.result.capabilities.tools).toBeDefined();
  });

  it("lists all tools with input schemas", async () => {
    const json = await (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json();
    expect(json.result.tools.length).toBe(22);
    for (const t of json.result.tools) {
      expect(t.inputSchema.type).toBe("object");
    }
  });

  it("answers ping", async () => {
    const json = await (await rpc({ jsonrpc: "2.0", id: 3, method: "ping" })).json();
    expect(json.result).toEqual({});
  });

  it("returns -32601 for an unknown method", async () => {
    const json = await (await rpc({ jsonrpc: "2.0", id: 4, method: "frobnicate" })).json();
    expect(json.error.code).toBe(-32601);
  });

  it("returns -32600 for a malformed request", async () => {
    const json = await (await rpc({ id: 5, method: "ping" })).json(); // missing jsonrpc
    expect(json.error.code).toBe(-32600);
  });

  it("rejects an unknown tool name", async () => {
    const json = await (
      await rpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "nope", arguments: {} } })
    ).json();
    expect(json.error.code).toBe(-32602);
  });

  it("validates tool arguments before execution (-32602)", async () => {
    const json = await (
      await rpc({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "getAddress", arguments: { address: "not-an-address" } },
      })
    ).json();
    expect(json.error.code).toBe(-32602);
    // RA-4: zod validation — message is "Invalid params"; the field detail is in data.
    expect(json.error.message).toMatch(/invalid params/i);
    expect(JSON.stringify(json.error.data)).toMatch(/address/i);
  });

  it("returns 204 with no body for a notification", async () => {
    const res = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(res.status).toBe(204);
  });

  it("drops notifications from a batch and returns only responses", async () => {
    const res = await rpc([
      { jsonrpc: "2.0", id: "a", method: "ping" },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: "b", method: "tools/list" },
    ]);
    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);
    expect(json.length).toBe(2);
    expect(json.map((m: { id: string }) => m.id).sort()).toEqual(["a", "b"]);
  });

  it("returns -32700 for unparseable JSON", async () => {
    ipSeq += 1;
    const res = await POST(
      new Request("http://x/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": `10.9.1.${ipSeq}` },
        body: "{ not json",
      }),
    );
    const json = await res.json();
    expect(json.error.code).toBe(-32700);
  });
});
