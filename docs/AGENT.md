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

## 2. Contract tools (EXP-AGENT, 2026-11-07)

Registered in the same `citrateTools()` registry, so chat and MCP expose the same
nine tools (`src/lib/ai/contractTools.ts`). All of them read or simulate; none signs,
sends or relays. MCP annotates all nine `readOnlyHint: true` (`mcpAnnotations.ts`).

| Tool | Answers | Data source |
|---|---|---|
| `contract_identify(address)` | verified status, name, proxy kind + implementation, interfaces: ERC-165 exact, ERC-721/1155 via `supportsInterface`, ERC-20 labelled as a heuristic | `eth_getCode`, `eth_getStorageAt` (EIP-1967 implementation/admin/beacon slots, EIP-1822 slot), EIP-1167 bytecode pattern, `eth_call` probes, `contract_verifications` |
| `contract_abi(address)` | functions and events, with `abiSource` = verified, partial-match, implementation (behind a proxy) or none | `contract_verifications` (+ proxy slots) |
| `contract_read(address, function, args, block?)` | a real `eth_call`, decoded; a full signature works for unverified contracts (labelled `signature`) | `eth_call` at the head or the given block |
| `decode_tx(hash)` | the call and every log (≤ 50), decoded | `eth_getTransactionByHash`, receipt, verified ABIs, then labelled well-known signatures |
| `decode_calldata(data, address?)`, `decode_log(address, topics, data)` | one call or one log | verified ABI of the target/emitter, else well-known signatures (`decodedWith` says which) |
| `contract_source(address, pc?, maxChars?)` | source files, compiler settings (standard-JSON input) and the source line for a pc | `contract_verifications` + `eth_getCode`. The current store keeps no source maps, so `pc` answers `found:false` with the reason until it does (see §5) |
| `prepare_write(address, function, args, value?, from?)` | a `PreparedWrite` (below), its explanation and an approval link | `eth_call` (simulation from the sender), `eth_estimateGas`, `eth_gasPrice`, verified ABI, relay sponsor policy |
| `explain_prepared_write(prepared)` | plain-language effects, cost, risks, next step | the object passed in; template-based, not model-written |

`PreparedWrite` (`src/lib/contracts/types.ts`): id (keccak of chain, from, to, data,
value), chain 40204, target (address, label, has code, verification, contract name,
ABI source, proxy), call (function, signature, selector, decoded args, calldata),
value (wei and SALT), simulation (ok, sender, revert reason, gas, gas price, fee,
block), risk (flags, `elevated`, `confirmPhrase`), relay eligibility (with the gas the
relay request is signed with), origin (chat, mcp, ui) and `executable: false`, always.

## 3. Approvals

Nothing signs automatically. The agent can only prepare.

1. **Prepare.** In chat the model calls `prepare_write`; the result renders as a
   "Prepared transaction" card. Over MCP the result carries
   `approval.approvalUrl` = `<site>/#/approve/<base64url request>`. The link holds
   only the request (target, function, args, value), never the simulation or the
   risk verdict.
2. **Review.** The card's "Review and approve" button, or the link, opens the
   approval dialog (`src/scan/approval.tsx`, view `approval-view.tsx`). The dialog
   calls `POST /api/agent/prepare` with the connected wallet as `from`, so what is
   shown was simulated from the user's own address at the current head. It shows the
   network (Citrate, chain 40204), target with verification and proxy, method and
   selector, decoded arguments, value in SALT, simulation outcome or revert reason,
   gas estimate and fee, risk flags, and the deterministic explanation.
3. **Decide.** Reject ends the flow. Edit lets the user change arguments (and value
   for payable functions) and re-simulates; the new proposal has a new id and any
   earlier approval is void. Approve is disabled until every rule in
   `approvalBlockers()` (`src/lib/agent/approval.ts`) passes: chain 40204, a
   connected wallet, a simulation from that wallet, the typed confirmation when the
   call is elevated, relay eligibility when the relay is chosen.
4. **Sign.** `execute()` is the only function that reaches the wallet, and it refuses
   any state not approved for exactly the PreparedWrite on screen. The user signs in
   their own wallet (wagmi `sendTransaction`, chain 40204), or, where the existing
   relay policy allows the call (value 0, allowlisted target, gas within the cap),
   signs an EIP-712 ForwardRequest for `/api/relay`.
5. **Log.** prepared and edited (server, `/api/agent/prepare` and the chat tool),
   approved, rejected, submitted, executed and failed (`/api/agent/write-events`)
   are appended to the user's thread as sealed `system` messages
   (`[citrate-write-event] {json}`). For events with a tx hash the server reads the
   transaction back and records the chain's status, and flags a target mismatch. The
   drawer shows these lines when a conversation is resumed.

**Elevated (typed confirmation of the function name):** approve, increaseAllowance,
permit, setApprovalForAll(true), ownership or admin/role changes, proxy upgrades,
payable value above `AGENT_PAYABLE_WARN_SALT` (default 1 SALT), unverified or
partial-match targets, unknown verification status, a signature outside a verified
ABI, an address with no code, and any simulation that reverted or could not run.
Matching is by selector and by name (`src/lib/agent/risk.ts`).

**MCP:** write tools return prepare-only results plus the approval link. No MCP tool
can sign, send or relay.

**Rate limits and keys:** one prepare budget per identity (0.5/s, burst 10) shared by
chat, MCP and `/api/agent/prepare` (`src/lib/agent/limits.ts`); MCP and the prepare
route use the existing API-key scheme (header only, per owner, quota and throttle
answers as on `/api/mcp`); write events 2/s per owner.

## 4. Prompt-injection hardening

- On-chain text (token names and symbols, contract names, labels, source and NatSpec,
  revert reasons, decoded string values, log data) reaches the model wrapped as
  `⟦untrusted:<kind>⟧ … ⟦/untrusted⟧`, with control and bidi characters stripped
  and the delimiter characters replaced inside the text (`src/lib/agent/untrusted.ts`).
  GUARDRAILS tells the model these blocks are data.
- **Write gate** (`src/lib/agent/writeIntent.ts`): in chat, `prepare_write` is in
  `activeTools` only when the user's own latest message asks for a write, and the
  tool accepts only a target the user named or the page they are viewing. Both come
  from user input, never from tool output. The tool re-checks the gate itself.
- The explanation and the dialog are built from decoded calldata and simulation, not
  from model text, and the dialog re-simulates before Approve is possible.
- Tests: `src/lib/ai/contractTools.test.ts` ("prompt injection"),
  `src/app/api/chat/route.writegate.test.ts`.

## 5. Integration notes and known limits

- **EXP-CONTRACT:** `src/lib/agent/contractModule.ts` implements the shared
  `ContractModule`. Swap `defaultContractModule()` for EXP-CONTRACT's module; the
  tools, route and dialog use only the interface. Keep `PreparedWrite.executable`
  `false` and the risk codes, which the dialog and logs depend on.
- **EXP-REDESIGN:** the drawer sends `context: AgentContext` with every chat
  request, derived from the route (`src/lib/agent/context.ts`); the Ask slot can set
  it directly through `agentRef.current.setAgentContext(ctx)`. The dialog and card
  use only shared CSS tokens (`src/scan/approval.css`) so the direction-B kit
  restyles them by remapping tokens.
- **Verification v2:** `contract_source(pc)` needs a stored deployed source map;
  wire `sourceMap` in `contractTools.ts` `liveDeps()` to the v2 store's
  `deployedSourceMap` when that lands.
- The in-chat card was exercised in unit tests and renders from real tool output, but
  was not runtime-proven with a live inference model in this lane.

Screenshots (local dev against rpc.citrate.ai, no wallet, nothing signed):
`docs/screenshots/agent/{approval,ask}-{light,dark}-{375,1440}.png`.
