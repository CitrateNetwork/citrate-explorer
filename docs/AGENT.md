---
created: 2026-11-07T16:40:00Z
branch: feat/agent-contracts
author: Larry Klosowski (owner) + Claude Opus 5.5 (EXP-AGENT lane)
sprint: EXP-AGENT (r1007 fan-out, owner requirement 2026-11-07)
status: active
---

# The CitrateScan agent

What the explorer's agent can do, where each answer comes from, and how a contract
write gets from "the agent prepared it" to "the user signed it". One page per
topic: the read harness is specified in `DESIGN_HARNESS_AND_SETTINGS.md`, the
prompt layers in `SYSTEM_PROMPTS.md`, the relay policy in `src/lib/relay/policy.ts`.

## 1. Preserved capabilities (inventory, main f5c1ba3, 2026-11-07)

Everything below existed before this lane and is pinned by tests so it cannot
regress silently: `src/lib/ai/tools.pinned.test.ts` (names, input-schema
snapshots, audit-before-run, argument mapping), `src/app/api/chat/route.pinned.test.ts`
(chat gates and wiring), `src/scan/harness.pinned.test.ts` (front-end mirror),
plus the existing `src/app/api/mcp/route.test.ts`, `src/app/api/relay/*.test.ts`,
`src/lib/relay/*.test.ts`, `src/app/api/keys/route.l3c013.test.ts`.

### 1.1 Surfaces

| Surface | What it does | Data source | Gates |
|---|---|---|---|
| `POST /api/chat` | "Ask CitrateScan": streams a model answer that calls the shared tool registry (AI SDK v6 `streamText`, up to `CITRATE_MAX_STEPS` steps) | inference provider (`src/lib/ai/provider.ts`, env `CITRATE_INFERENCE_MODE` = `gateway` (`CITRATE_GATEWAY_URL`, default infer.citrate.ai) or `local` (`CITRATE_INFERENCE_URL`); `onchain` fails loudly); tools below | same-origin; session when an authority is configured; 1 req/s, burst 5 per subject or IP; generic error text only |
| `POST /api/mcp`, `GET /api/mcp` | MCP server (JSON-RPC 2.0 over HTTP): `initialize`, `tools/list`, `tools/call`, `resources/*`, `prompts/*`, `ping`; tools generated from the same registry as chat | the tool registry; `src/lib/ai/mcpResources.ts` | optional API key (header only), per-owner bucket when keyed else 2/s per IP; batch ≤ 20, charged per message; per-tool `readOnlyHint` from `mcpAnnotations.ts` |
| `GET/POST /api/threads`, `GET/PATCH/DELETE /api/threads/[id]` | per-user conversation history | `threads` + `messages` tables, bodies sealed AES-256-GCM per subject (`src/lib/db/conversations.ts`) | session; same-origin on mutations; ownership-scoped by OIDC subject |
| `POST /api/relay` | gasless EIP-2771 writes: verifies a signed `ForwardRequest` on the `CitrateForwarder`, then the relayer submits `execute` | on-chain `verify`/`execute` on `NEXT_PUBLIC_FORWARDER_ADDRESS`, relayer key `RELAYER_PRIVATE_KEY` (server only) | same-origin; verified session; sponsor policy (value must be 0, target on the federation allowlist, gas ≤ `RELAY_MAX_GAS`); hourly caps per subject, `from` and IP |
| `GET/POST/DELETE /api/keys` | API keys for MCP and `/api/v1` | `api_keys` table, scrypt-v1 hash + pepper, shown once | verified session; ≤ 5 active keys per subject |
| `GET /api/agents`, `GET /api/agents/[tokenId]` | AgentSBT identities (on-chain agents, not the chat agent) | AgentSBT over live RPC | public-read budget |
| Agent drawer (`src/scan/screens/agent.tsx`) | chat UI: streaming, tool trace, "sources" list, clickable entity chips, conversation history (list, resume, new, delete) | `/api/chat`, `/api/threads` | sign-in prompt on 401 |
| `SH` (`src/scan/harness.ts`) | front-end mirror of the harness for sample screens (allowlist + forbidden list, omni-search classifier) | sample data (`src/scan/data.ts`) | read-only by construction |
| Audit log | every tool call, args clipped to 2 000 chars, scoped to the subject | `audit_log` table (`src/lib/ai/audit.ts`) | best-effort, never breaks a call |

### 1.2 Read tools (shared by chat and MCP)

| Tool | Answers | Data source |
|---|---|---|
| `getChainStatus` | chain id, head, gas price | `eth_chainId`, `eth_blockNumber`, `eth_gasPrice` |
| `getBlock` | block summary by height, hash or latest | `eth_getBlockBy*` + `citrate_getDagStats` |
| `getTransaction` | tx + receipt + raw logs | `eth_getTransactionByHash`, `eth_getTransactionReceipt` |
| `explainTransaction` | tx plus decoded transfers/approvals, for narration | the above + transfer decoders |
| `getAddress`, `getBalance`, `isContract` | balance, nonce, contract or EOA | `eth_getBalance`, `eth_getTransactionCount`, `eth_getCode` |
| `getLogs` | ≤ 1 000 logs for one contract over ≤ 10 000 blocks | `eth_getLogs` (bounded, `logBounds.ts`) |
| `exploreDag` | GHOSTDAG overview, or a block's selected-parent walk | `citrate_getDagStats`, `citrate_getBlock*` |
| `searchTransactions`, `addressActivity`, `topHolders` | indexed history | indexer tables (live-scan fallback for `addressActivity`) |
| `recentActivity` | last N blocks around an address | live block scan |
| `getContractCode` | size, code hash, label (bytecode stripped to a preview) | `eth_getCode` |
| `getVerifiedSource` | verified source, ABI, compiler; honest status | `contract_verifications` table |
| `getToken` | ERC-20/721 metadata (name/symbol clamped) | `eth_call` |
| `callView` | any view function by signature | `eth_call` |
| `describeContract`, `citrateContracts` | what a system contract is | the documented catalog (`contractCatalog.ts`) |
| `getGasOracle` | price + reference costs | `eth_gasPrice` |
| `findTransfers` | transfers by amount / time / counterparty | indexer `transactions` / `token_transfers` |
| `saltDistribution` | genesis allocations with live balances | address book + `eth_getBalance` |
| `ledger` | exact SALT arithmetic | pure function |
| `getAgent` | one AgentSBT identity | AgentSBT over live RPC |

Before this lane there was no write or sign tool: the GUARDRAILS layer of the
system prompt said so and the MCP manifest reported `readOnly: true`.
