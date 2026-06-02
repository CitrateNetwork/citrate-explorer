/**
 * MCP server discovery endpoint. CitrateScan exposes its read-only tools over the
 * Model Context Protocol so external agents (Claude, ChatGPT, Cursor) use it as
 * their on-chain tool — the Blockscout-validated pattern: decoded, dual-unit
 * (grains + SALT), cursor-paginated outputs (EXPLORER_SPEC.md, DESIGN_BRIEF.md).
 *
 * This GET returns the tool manifest for discovery. The full MCP JSON-RPC
 * transport (initialize / tools/list / tools/call) lands in S-6.
 */
const TOOLS = [
  { name: "getChainStatus", description: "Chain id, latest block, gas price." },
  { name: "getBlock", description: "Block by height/hash/latest." },
  { name: "getTransaction", description: "Transaction + receipt by hash." },
  { name: "getAddress", description: "Balance, nonce, contract status." },
  { name: "getLogs", description: "Event logs by address/range." },
  { name: "exploreDag", description: "GHOSTDAG topology: tips, blue/red, finality." },
  { name: "searchTransactions", description: "Indexed tx search by address." },
  { name: "addressActivity", description: "Indexed activity summary." },
  { name: "topHolders", description: "Token holder leaderboard from the index." },
];

export async function GET() {
  return Response.json({
    name: "citratescan",
    protocol: "mcp",
    status: "discovery-only",
    note: "Full MCP JSON-RPC transport lands in S-6.",
    capabilities: { tools: true },
    tools: TOOLS,
  });
}

export async function POST() {
  return Response.json(
    {
      error: "MCP JSON-RPC transport not implemented yet (S-6).",
      hint: "GET /api/mcp returns the tool manifest for discovery.",
    },
    { status: 501 },
  );
}
