/**
 * MCP resources + prompts (RA-7).
 *
 * RESOURCES let an MCP client PULL grounding context (what Citrate is, its system
 * contracts, the address book, what the index can answer) without a tool round-trip.
 * PROMPTS are reusable research templates (audit an address, trace a token, …) that
 * expand into a first user turn driving the tools. Pure + data-driven so they're
 * unit-tested; the route just serves them.
 */
import { CITRATE_OVERVIEW, listContracts, PRECOMPILES } from "@/lib/citrate/contractCatalog";
import { CONTRACT_ADDRESSES, AA_STACK, GENESIS_ALLOCATIONS } from "@/lib/citrate/addresses";

export interface McpResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  read: () => string;
}

const contractsMarkdown = (): string => {
  const rows = listContracts().map((c) => `| ${c.name} | ${c.category} | ${c.address} | ${c.purpose} |`);
  const pre = Object.entries(PRECOMPILES).map(([a, p]) => `| ${p.name} | Precompile | ${a} | ${p.purpose} |`);
  return [
    "# Citrate system contracts",
    "",
    "| Name | Category | Address | Purpose |",
    "| --- | --- | --- | --- |",
    ...rows,
    ...pre,
  ].join("\n");
};

const addressBook = (): string =>
  JSON.stringify(
    {
      chainId: 40204,
      contracts: CONTRACT_ADDRESSES,
      accountAbstraction: AA_STACK,
      precompiles: Object.fromEntries(Object.entries(PRECOMPILES).map(([a, p]) => [p.name, a])),
      genesisAllocations: GENESIS_ALLOCATIONS,
    },
    null,
    2,
  );

const SCHEMA_DOC = `# What CitrateScan's index can answer (Neon)

Queryable via the tools (findTransfers / searchTransactions / topHolders / etc.):
- blocks(hash, height, blue_score, finalized, timestamp, proposer, …) — DAG-native.
- transactions(hash, block_height, from, to, value /*native SALT grains*/, status, timestamp, method_id).
- token_transfers(token, standard, from, to, value, token_id, block_height, timestamp) — decoded ERC-20/721/1155.
- tokens(address, type, name, symbol, decimals, total_supply).
- receipts, logs(topic0..3, data).

Native SALT lives in transactions.value; token transfers in token_transfers. The index
may lag the tip or be unprovisioned — tools fall back to live RPC and say so.`;

export const RESOURCES: McpResource[] = [
  {
    uri: "citrate://overview",
    name: "Citrate overview",
    description: "What the Citrate Network is (chain 40204, SALT, AI-native L1) and its core capabilities.",
    mimeType: "text/markdown",
    read: () => CITRATE_OVERVIEW,
  },
  {
    uri: "citrate://contracts",
    name: "Citrate contract catalog",
    description: "Every documented system contract + precompile: name, category, address, purpose.",
    mimeType: "text/markdown",
    read: contractsMarkdown,
  },
  {
    uri: "citrate://addresses",
    name: "Citrate address book",
    description: "Canonical chain-40204 contract addresses, AA stack, precompiles, and genesis allocations (JSON).",
    mimeType: "application/json",
    read: addressBook,
  },
  {
    uri: "citrate://index-schema",
    name: "Index schema",
    description: "What the CitrateScan index can answer and the tables behind the query tools.",
    mimeType: "text/markdown",
    read: () => SCHEMA_DOC,
  },
];

export interface McpPromptArg {
  name: string;
  description: string;
  required: boolean;
}
export interface McpPrompt {
  name: string;
  description: string;
  arguments: McpPromptArg[];
  render: (args: Record<string, string>) => string;
}

const need = (args: Record<string, string>, k: string) => (args?.[k] ?? `{${k}}`).trim();

export const PROMPTS: McpPrompt[] = [
  {
    name: "audit_address",
    description: "Investigate an address: what it is, its balance, and its notable activity.",
    arguments: [{ name: "address", description: "0x address to audit", required: true }],
    render: (a) =>
      `Audit ${need(a, "address")} on Citrate. Determine what it is (describeContract, else getAddress), its SALT ` +
      `balance, and its notable recent activity (recentActivity / findTransfers). Summarize: identity, balance, ` +
      `biggest movements, and anything notable — concisely, with a table of key transfers.`,
  },
  {
    name: "trace_token",
    description: "Profile a token: metadata, holders, and how it moves.",
    arguments: [{ name: "token", description: "0x token address", required: true }],
    render: (a) =>
      `Profile the token at ${need(a, "token")}. Use getToken for metadata, topHolders for the leaderboard, and ` +
      `findTransfers(token=…) + tokenActivity for how it moves. Summarize who holds it and recent flow in a table. ` +
      `Say WHICH token (symbol) throughout — never conflate with native SALT.`,
  },
  {
    name: "explain_finality",
    description: "Explain Citrate's GHOSTDAG finality (and a specific block's state, if given).",
    arguments: [{ name: "block", description: "optional block height or hash", required: false }],
    render: (a) => {
      const b = a?.block?.trim();
      return (
        `Explain how finality works on Citrate (GHOSTDAG, finality by blue_score depth) using exploreDag.` +
        (b ? ` Then assess whether block ${b} is finalized and how deep it is.` : "")
      );
    },
  },
  {
    name: "summarize_contract",
    description: "Summarize a contract: purpose, deployment facts, and key reads.",
    arguments: [{ name: "address", description: "0x contract address", required: true }],
    render: (a) =>
      `Summarize the contract at ${need(a, "address")}: describeContract for its purpose/category, getContractCode ` +
      `for deployment facts (size, code hash), and if it's a token, getToken. Note any callView reads worth running.`,
  },
];

export function getResource(uri: string): McpResource | undefined {
  return RESOURCES.find((r) => r.uri === uri);
}
export function getPrompt(name: string): McpPrompt | undefined {
  return PROMPTS.find((p) => p.name === name);
}
