/**
 * MCP server for CitrateScan (P-7 WP-7.4). Exposes the explorer's READ-ONLY
 * harness over the Model Context Protocol so external agents (Claude, ChatGPT,
 * Cursor) use CitrateScan as their on-chain tool — the Blockscout-validated
 * pattern: decoded, dual-unit (SALT + raw grains), structured outputs.
 *
 * Single source of truth (Rule 11): every tool here dispatches to the SAME
 * read-only ops the AI agent uses (`src/lib/harness/ops.ts`) and the same indexer
 * repository (`src/lib/indexer/repository.ts`). There is no write/sign tool by
 * construction. Data is live Citrate RPC + the indexed Neon DB (honest
 * not-provisioned notes when the index is absent).
 *
 * Transport: JSON-RPC 2.0 over HTTP POST (`initialize`, `tools/list`,
 * `tools/call`, `ping`, and the `notifications/initialized` notification). GET
 * returns a human/agent-readable discovery manifest.
 */
import type { Address, Hex } from "viem";
import {
  getChainStatus,
  getBlock,
  getTransaction,
  getAddress,
  getBalance,
  getLogs,
  exploreDag,
  dagOverview,
  isContract,
  getContractCode,
  getToken,
  getGasOracle,
  saltDistribution,
  callView,
} from "@/lib/harness/ops";
import { explainTransaction } from "@/lib/ai/synthesis/explainTransaction";
import {
  searchTransactions,
  addressActivity,
  topHolders,
} from "@/lib/indexer/repository";
import { extractApiKey, validateApiKey, clientIp } from "@/lib/api/keys";
import { checkRateLimit } from "@/lib/api/ratelimit";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "citratescan", version: "1.0.0" };

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;

type Json = Record<string, unknown>;
interface ToolDef {
  description: string;
  inputSchema: Json;
  run: (args: Json) => Promise<unknown>;
}

/** Throwable JSON-RPC error so handlers can signal -32602 invalid params. */
class RpcError extends Error {
  constructor(public code: number, message: string, public data?: unknown) {
    super(message);
  }
}
const badArg = (msg: string): never => {
  throw new RpcError(-32602, msg);
};
const reqAddr = (v: unknown, field = "address"): Address => {
  if (typeof v !== "string" || !ADDR.test(v)) badArg(`${field} must be a 0x 20-byte address`);
  return (v as string) as Address;
};
const reqHash = (v: unknown, field = "hash"): Hex => {
  if (typeof v !== "string" || !HASH.test(v)) badArg(`${field} must be a 0x 32-byte hash`);
  return (v as string) as Hex;
};
const optInt = (v: unknown, field: string): number | undefined => {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v)) badArg(`${field} must be an integer`);
  return v as number;
};
const clampLimit = (v: unknown, def: number, max: number): number => {
  const n = optInt(v, "limit");
  if (n === undefined) return def;
  return Math.min(Math.max(n, 1), max);
};

/** The tool registry — names/semantics mirror src/lib/ai/tools.ts 1:1. */
const TOOLS: Record<string, ToolDef> = {
  getChainStatus: {
    description: "Live chain status: chain id, latest block number, and gas price (dual-unit).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async () => getChainStatus(),
  },
  getBlock: {
    description: "Fetch a block by height (number-as-string), 0x hash, or 'latest'.",
    inputSchema: {
      type: "object",
      properties: { ref: { type: "string", description: "block height, 0x hash, or 'latest'", default: "latest" } },
      additionalProperties: false,
    },
    run: async (a) => {
      const ref = typeof a.ref === "string" && a.ref.length ? a.ref : "latest";
      const r = ref === "latest" ? "latest" : ref.startsWith("0x") ? (ref as Hex) : Number(ref);
      if (r !== "latest" && typeof r === "number" && Number.isNaN(r)) badArg("ref must be a height, 0x hash, or 'latest'");
      return getBlock(r);
    },
  },
  getTransaction: {
    description: "Fetch a transaction and its receipt by hash.",
    inputSchema: {
      type: "object",
      properties: { hash: { type: "string", description: "0x 32-byte tx hash" } },
      required: ["hash"],
      additionalProperties: false,
    },
    run: async (a) => getTransaction(reqHash(a.hash)),
  },
  explainTransaction: {
    description: "Fetch a tx plus decoded events (ERC-20/721 transfers, approvals) as a structured bundle to narrate a plain-English 'what happened'.",
    inputSchema: {
      type: "object",
      properties: { hash: { type: "string", description: "0x 32-byte tx hash" } },
      required: ["hash"],
      additionalProperties: false,
    },
    run: async (a) => explainTransaction(reqHash(a.hash)),
  },
  getAddress: {
    description: "An address's SALT balance, nonce, and whether it is a contract.",
    inputSchema: {
      type: "object",
      properties: { address: { type: "string", description: "0x 20-byte address" } },
      required: ["address"],
      additionalProperties: false,
    },
    run: async (a) => getAddress(reqAddr(a.address)),
  },
  getBalance: {
    description: "An address's SALT balance (dual-unit: SALT + raw grains/wei).",
    inputSchema: {
      type: "object",
      properties: { address: { type: "string", description: "0x 20-byte address" } },
      required: ["address"],
      additionalProperties: false,
    },
    run: async (a) => getBalance(reqAddr(a.address)),
  },
  isContract: {
    description: "Whether an address holds contract bytecode.",
    inputSchema: {
      type: "object",
      properties: { address: { type: "string", description: "0x 20-byte address" } },
      required: ["address"],
      additionalProperties: false,
    },
    run: async (a) => {
      const address = reqAddr(a.address);
      return { address, isContract: await isContract(address) };
    },
  },
  getLogs: {
    description: "Event logs, optionally filtered by contract address and block range.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "optional 0x contract address" },
        fromBlock: { type: "integer", description: "optional start block height" },
        toBlock: { type: "integer", description: "optional end block height" },
      },
      additionalProperties: false,
    },
    run: async (a) => {
      const from = optInt(a.fromBlock, "fromBlock");
      const to = optInt(a.toBlock, "toBlock");
      return getLogs({
        address: a.address === undefined ? undefined : reqAddr(a.address),
        fromBlock: from !== undefined ? BigInt(from) : undefined,
        toBlock: to !== undefined ? BigInt(to) : undefined,
      });
    },
  },
  exploreDag: {
    description: "GHOSTDAG topology. With no blockHash: the overview (tips, blue/red, max blue score, finality params). With a blockHash: that block's selected-parent ancestor chain, its merge parents, and finalization.",
    inputSchema: {
      type: "object",
      properties: { blockHash: { type: "string", description: "optional 0x block hash to walk" } },
      additionalProperties: false,
    },
    run: async (a) => (a.blockHash !== undefined ? exploreDag(reqHash(a.blockHash, "blockHash"), 10) : dagOverview()),
  },
  searchTransactions: {
    description: "Search indexed transactions by address (from/to). Requires the indexer; returns a not-provisioned note otherwise.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "0x 20-byte address" },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
      },
      required: ["address"],
      additionalProperties: false,
    },
    run: async (a) => searchTransactions(reqAddr(a.address), clampLimit(a.limit, 25, 100)),
  },
  addressActivity: {
    description: "Summarize an address's recent activity (tx counts, first/last seen) from the index.",
    inputSchema: {
      type: "object",
      properties: { address: { type: "string", description: "0x 20-byte address" } },
      required: ["address"],
      additionalProperties: false,
    },
    run: async (a) => addressActivity(reqAddr(a.address)),
  },
  topHolders: {
    description: "Top holders of an ERC-20/721 token from indexed transfers. Requires the indexer. NOT for native SALT — use saltDistribution.",
    inputSchema: {
      type: "object",
      properties: {
        token: { type: "string", description: "0x 20-byte token address" },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 10 },
      },
      required: ["token"],
      additionalProperties: false,
    },
    run: async (a) => topHolders(reqAddr(a.token, "token"), clampLimit(a.limit, 10, 100)),
  },
  getContractCode: {
    description: "A contract's deployed bytecode: size, keccak code hash, raw bytecode, EOA-vs-contract. Source needs verification.",
    inputSchema: {
      type: "object",
      properties: { address: { type: "string", description: "0x 20-byte address" } },
      required: ["address"],
      additionalProperties: false,
    },
    run: async (a) => getContractCode(reqAddr(a.address)),
  },
  getToken: {
    description: "Token metadata (auto-detects ERC-20/721): name, symbol, decimals, total supply, + optional holder balance.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "0x 20-byte token address" },
        holder: { type: "string", description: "optional 0x holder to read balance of" },
      },
      required: ["address"],
      additionalProperties: false,
    },
    run: async (a) => getToken(reqAddr(a.address), a.holder === undefined ? undefined : reqAddr(a.holder, "holder")),
  },
  callView: {
    description: "Read ANY view/pure function by Solidity signature, e.g. \"function getModel(bytes32) view returns (address,string,uint256)\". Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "0x 20-byte contract address" },
        signature: { type: "string", description: "full Solidity function signature" },
        args: { type: "array", description: "function arguments", items: {} },
      },
      required: ["address", "signature"],
      additionalProperties: false,
    },
    run: async (a) => callView(reqAddr(a.address), String(a.signature), Array.isArray(a.args) ? (a.args as unknown[]) : []),
  },
  getGasOracle: {
    description: "Current gas price (wei + gwei) and reference cost estimates for common operations, dual-unit.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async () => getGasOracle(),
  },
  saltDistribution: {
    description: "Who holds the most native SALT: known genesis allocations with LIVE balances (biggest first). SALT is native (no Transfer events), so a full leaderboard needs a balance indexer.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async () => saltDistribution(),
  },
};

const toolList = () =>
  Object.entries(TOOLS).map(([name, t]) => ({
    name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));

/** GET — discovery manifest (also handy for humans hitting the endpoint). */
export async function GET() {
  return Response.json({
    name: SERVER_INFO.name,
    version: SERVER_INFO.version,
    protocol: "mcp",
    protocolVersion: PROTOCOL_VERSION,
    transport: "json-rpc-2.0 over HTTP POST",
    capabilities: { tools: { listChanged: false } },
    readOnly: true,
    units: "dual (SALT + raw grains/wei)",
    tools: toolList(),
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
async function handleOne(msg: RpcReq): Promise<object | null> {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return rpcErr(msg?.id ?? null, -32600, "Invalid Request");
  }
  const isNotification = msg.id === undefined || msg.id === null;
  const { method, id } = msg;

  switch (method) {
    case "initialize":
      return rpcOk(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
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
      return rpcOk(id, { tools: toolList() });
    case "tools/call": {
      const params = msg.params ?? {};
      const name = params.name as string | undefined;
      const args = (params.arguments as Json) ?? {};
      const tool = name ? TOOLS[name] : undefined;
      if (!tool) return rpcErr(id, -32602, `Unknown tool: ${name ?? "(missing)"}`);
      try {
        const result = await tool.run(args);
        return rpcOk(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Json,
          isError: false,
        });
      } catch (err) {
        if (err instanceof RpcError) return rpcErr(id, err.code, err.message, err.data);
        // Tool execution failure is reported as an MCP tool result with isError,
        // not a protocol error, so the agent can read the message.
        const message = (err as Error)?.message ?? "tool execution failed";
        return rpcOk(id, {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true,
        });
      }
    }
    default:
      return isNotification ? null : rpcErr(id, -32601, `Method not found: ${method}`);
  }
}

/** POST — JSON-RPC 2.0 transport (single message or batch). */
export async function POST(req: Request) {
  // Abuse guard: optional API key (higher limit) else anonymous per-IP limit,
  // shared with /api/v1. MCP tools/call hits live RPC, so it must be bounded.
  const ip = clientIp(req);
  const raw = extractApiKey(req);
  const keyInfo = raw ? await validateApiKey(raw, ip) : null;
  const limitId = keyInfo?.valid ? `mcp:key:${keyInfo.keyId}` : `mcp:ip:${ip}`;
  const perSec = keyInfo?.valid ? keyInfo.perSec : 2;
  const limited = await checkRateLimit(limitId, perSec);
  if (!limited.ok) {
    return Response.json(rpcErr(null, -32000, "Rate limit exceeded"), {
      status: 429,
      headers: { "retry-after": String(limited.retryAfter ?? 1) },
    });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(rpcErr(null, -32700, "Parse error"), { status: 400 });
  }

  if (Array.isArray(body)) {
    if (body.length === 0) return Response.json(rpcErr(null, -32600, "Empty batch"), { status: 400 });
    const out = (await Promise.all(body.map((m) => handleOne(m as RpcReq)))).filter(Boolean);
    // An all-notification batch yields no responses → 204.
    if (out.length === 0) return new Response(null, { status: 204 });
    return Response.json(out);
  }

  const res = await handleOne(body as RpcReq);
  if (res === null) return new Response(null, { status: 204 });
  return Response.json(res);
}
