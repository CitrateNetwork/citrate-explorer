/**
 * MCP server for CitrateScan (P-7 WP-7.4; RA-4 unified registry).
 *
 * Exposes the explorer's READ-ONLY tools over the Model Context Protocol so
 * external agents (Claude, ChatGPT, Cursor) use CitrateScan as their on-chain tool.
 *
 * SINGLE SOURCE OF TRUTH (ADR-003): the tools here are GENERATED from the exact
 * same `citrateTools()` the in-app agent uses — same names, zod input schemas
 * (converted to JSON Schema via zod's `toJSONSchema`), and `execute`. There is no
 * separate hand-maintained MCP tool list to drift (the old one was missing
 * findTransfers / its token support / ledger). Tool calls are audited under the
 * API-key identity.
 *
 * Transport: JSON-RPC 2.0 over HTTP POST (`initialize`, `tools/list`,
 * `tools/call`, `ping`, `notifications/initialized`). GET returns a discovery
 * manifest.
 */
import { z } from "zod";
import { citrateTools } from "@/lib/ai/tools";
import { RESOURCES, PROMPTS, getResource, getPrompt } from "@/lib/ai/mcpResources";
import { extractApiKey, validateApiKey, clientIp } from "@/lib/api/keys";
import { checkRateLimit } from "@/lib/api/ratelimit";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "citratescan", version: "1.1.0" };
/** EX-B-003: a batch fans out into parallel tool calls, each hitting live RPC. */
export const MAX_MCP_BATCH = 20;

type Json = Record<string, unknown>;
interface McpTool {
  description: string;
  inputSchema: z.ZodType;
  execute: (args: unknown, opts?: unknown) => Promise<unknown>;
}

/** Build the tool set (auditing under `subject` when known). Cheap — no IO. */
function buildTools(subject?: string): Record<string, McpTool> {
  return citrateTools({ subject }) as unknown as Record<string, McpTool>;
}

/** JSON Schema for a tool's inputs (MCP wants a plain object schema). */
function jsonSchema(tool: McpTool): Json {
  const js = z.toJSONSchema(tool.inputSchema, { target: "draft-7" }) as Json;
  delete js.$schema;
  return js;
}

function toolList(tools: Record<string, McpTool>) {
  return Object.entries(tools).map(([name, t]) => ({
    name,
    description: t.description,
    inputSchema: jsonSchema(t),
  }));
}

const CAPABILITIES = {
  tools: { listChanged: false },
  resources: { listChanged: false },
  prompts: { listChanged: false },
};
const resourceList = () => RESOURCES.map(({ uri, name, description, mimeType }) => ({ uri, name, description, mimeType }));
const promptList = () => PROMPTS.map(({ name, description, arguments: a }) => ({ name, description, arguments: a }));

/** GET — discovery manifest (also handy for humans hitting the endpoint). */
export async function GET() {
  return Response.json({
    name: SERVER_INFO.name,
    version: SERVER_INFO.version,
    protocol: "mcp",
    protocolVersion: PROTOCOL_VERSION,
    transport: "json-rpc-2.0 over HTTP POST",
    capabilities: CAPABILITIES,
    readOnly: true,
    units: "dual (SALT + raw grains/wei)",
    tools: toolList(buildTools()),
    resources: resourceList(),
    prompts: promptList(),
  });
}

interface RpcReq {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Json;
}

function rpcOk(id: RpcReq["id"], result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}
function rpcErr(id: RpcReq["id"], code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

/** Dispatch one JSON-RPC message. Returns null for notifications (no response). */
async function handleOne(msg: RpcReq, tools: Record<string, McpTool>): Promise<object | null> {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return rpcErr(msg?.id ?? null, -32600, "Invalid Request");
  }
  const isNotification = msg.id === undefined || msg.id === null;
  const { method, id } = msg;

  switch (method) {
    case "initialize":
      return rpcOk(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: CAPABILITIES,
        serverInfo: SERVER_INFO,
        instructions:
          "Read-only on-chain tools for the Citrate Network (chain 40204, native SALT). " +
          "Amounts are dual-unit (SALT + raw grains). DAG-native: blocks carry blue_score, " +
          "selected + merge parents; finality is by depth, not confirmations.",
      });
    case "notifications/initialized":
    case "notifications/cancelled":
      return null; // notifications get no response
    case "ping":
      return rpcOk(id, {});
    case "tools/list":
      return rpcOk(id, { tools: toolList(tools) });
    case "resources/list":
      return rpcOk(id, { resources: resourceList() });
    case "resources/read": {
      const uri = (msg.params?.uri as string) ?? "";
      const r = getResource(uri);
      if (!r) return rpcErr(id, -32602, `Unknown resource: ${uri || "(missing)"}`);
      return rpcOk(id, { contents: [{ uri: r.uri, mimeType: r.mimeType, text: r.read() }] });
    }
    case "prompts/list":
      return rpcOk(id, { prompts: promptList() });
    case "prompts/get": {
      const name = (msg.params?.name as string) ?? "";
      const prompt = getPrompt(name);
      if (!prompt) return rpcErr(id, -32602, `Unknown prompt: ${name || "(missing)"}`);
      const args = (msg.params?.arguments as Record<string, string>) ?? {};
      return rpcOk(id, {
        description: prompt.description,
        messages: [{ role: "user", content: { type: "text", text: prompt.render(args) } }],
      });
    }
    case "tools/call": {
      const params = msg.params ?? {};
      const name = params.name as string | undefined;
      const rawArgs = (params.arguments as Json) ?? {};
      const tool = name ? tools[name] : undefined;
      if (!tool) return rpcErr(id, -32602, `Unknown tool: ${name ?? "(missing)"}`);

      // Validate + coerce (defaults) with the SAME zod schema the agent uses.
      const parsed = tool.inputSchema.safeParse(rawArgs);
      if (!parsed.success) {
        return rpcErr(id, -32602, "Invalid params", parsed.error.issues.map((e) => ({ path: e.path.join("."), message: e.message })));
      }
      try {
        const result = await tool.execute(parsed.data);
        return rpcOk(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Json,
          isError: false,
        });
      } catch (err) {
        // Tool execution failure → an MCP tool result with isError (the agent can read it),
        // not a protocol error.
        const message = (err as Error)?.message ?? "tool execution failed";
        return rpcOk(id, { content: [{ type: "text", text: `Error: ${message}` }], isError: true });
      }
    }
    default:
      return isNotification ? null : rpcErr(id, -32601, `Method not found: ${method}`);
  }
}

/** POST — JSON-RPC 2.0 transport (single message or batch). */
export async function POST(req: Request) {
  // Abuse guard: optional API key (higher limit) else anonymous per-IP limit,
  // shared with /api/v1. MCP tools/call hits live RPC, so it must be bounded —
  // and a batch is charged one token PER MESSAGE (EX-B-003), not one per request.
  const ip = clientIp(req);
  const raw = extractApiKey(req);
  const keyInfo = raw ? await validateApiKey(raw, ip) : null;
  const limitId = keyInfo?.valid ? `mcp:key:${keyInfo.keyId}` : `mcp:ip:${ip}`;
  const perSec = keyInfo?.valid ? keyInfo.perSec : 2;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(rpcErr(null, -32700, "Parse error"), { status: 400 });
  }
  if (Array.isArray(body) && body.length === 0) {
    return Response.json(rpcErr(null, -32600, "Empty batch"), { status: 400 });
  }
  if (Array.isArray(body) && body.length > MAX_MCP_BATCH) {
    return Response.json(rpcErr(null, -32600, `Batch exceeds the ${MAX_MCP_BATCH}-message limit`), { status: 400 });
  }
  const cost = Array.isArray(body) ? body.length : 1;

  const limited = await checkRateLimit(limitId, perSec, undefined, { cost });
  if (!limited.ok) {
    return Response.json(rpcErr(null, -32000, "Rate limit exceeded"), {
      status: 429,
      headers: { "retry-after": String(limited.retryAfter ?? 1) },
    });
  }

  // Audit MCP tool calls under the caller's key identity (anon per-IP otherwise).
  const subject = keyInfo?.valid ? `mcp:key:${keyInfo.keyId}` : undefined;
  const tools = buildTools(subject);

  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handleOne(m as RpcReq, tools)))).filter(Boolean);
    if (out.length === 0) return new Response(null, { status: 204 });
    return Response.json(out);
  }

  const res = await handleOne(body as RpcReq, tools);
  if (res === null) return new Response(null, { status: 204 });
  return Response.json(res);
}
