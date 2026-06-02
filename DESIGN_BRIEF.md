---
created: 2026-06-02T00:00:00Z
branch: main
author: Saul Loveman + Claude Opus 4.8 (1M context)
status: active
---

# CitrateScan — Frontend Design Brief

> **For:** the Claude design team building the CitrateScan prototype async.
> **Purpose:** a single document that (a) proposes the layouts, screens, and
> features for an AI-native block explorer, and (b) maps every interface surface
> to the backend it wires into — so the design covers *all* the functionality,
> nothing orphaned.
> **Status:** working contract to build from. The functional contract (the
> wiring map in §9) is the part to honor exactly; the visual direction
> (§§4–12) is a strong proposal, not a constraint on your craft.

---

## 1. What we're building (north star)

**CitrateScan** (`citrate-explorer`) is the block explorer for the **Citrate
Network** — a GHOSTDAG BlockDAG, chain **40204**. It is the canonical public
window onto the chain: blocks, transactions, addresses, contracts, tokens, the
DAG itself. It must do everything Etherscan does (the table-stakes), and then
do the thing Etherscan never figured out: **make on-chain reality legible to a
human in five seconds.**

We are building *against* Etherscan's documented UX failures, not cloning them:

- **"Everything is a hash" overload** — a wall of 66-char hex with no meaning.
- The one genuinely useful line ("Transaction Action") is **buried** below the
  raw fields.
- **Jargon-heavy, unhelpful errors** — `Fail with Custom Error
  'V2TooLittleReceived()'` tells a human nothing.
- **"0 ETH" transactions** that are actually token transfers — the headline lies.
- **Beginner-hostile** — assumes you already know what a nonce is.
- **Stuck / pending transactions with no guidance** — you stare and refresh.
- **Centralization, ads, paywalls** creeping over the free public good.

**Design north star:** **"Web3 power, Web2 calm."** Every page leads with a
plain-English **"what happened / what this is"** summary *above* the hash soup.
The raw data is always one tap away — never gone, never the front door. The hash
soup is for the power user who scrolls; the human gets the sentence.

The second pillar is that CitrateScan is **agentic**. A persistent **Ask
CitrateScan** assistant lives on every page. It is not a bolted-on chatbot — it
is woven into every entity (every tx, address, contract, block has an inline
**Explain** / **Ask about this** affordance) and it answers by *calling real
on-chain tools* and citing the data it read, with clickable entities in its
answer.

**Tone:** confident, calm, a little futuristic. Linear/Vercel restraint with a
warm Citrate-green identity. Dark-first. Fast.

---

## 2. Primary users & their 5-second job

| User | 5-second job-to-be-done |
|---|---|
| **Curious visitor** (non-technical) | "What *is* this address / tx?" — must get a plain-English answer at the top of the page, before any hex, before any jargon. One sentence, then the option to go deeper. |
| **Developer / builder** | Read & write contracts, verify source, grab an **API key**, hit the REST (`/api/v1`, Etherscan-compat) or **MCP** endpoint. Wants the explorer to be a backend for their app, not just a website. |
| **Crypto-native power user** | Internal txns, event logs, **state diffs**, gas, and the real **DAG topology** — multiple tips, blue/red blocks, blue_score ordering. Wants the raw truth fast and dense, no hand-holding. |
| **Auditor / analyst** | Trace funds across hops, see top holders, scan address activity, **label/annotate** entities, and **ask the agent** to do the tracing narrative for them. Exports CSV. |

The design must serve the **curious visitor** without ever requiring crypto
literacy, while giving the **power user** and **auditor** the full raw payload
and the agent's analytical leverage if they look.

---

## 3. Information architecture

CitrateScan is a genuine multi-page explorer (deep-linkable URLs are
table-stakes — every entity has a permanent, shareable address). Layered over
**every** page is the persistent **Ask CitrateScan** agent (a drawer on the
right, collapsible; on mobile a bottom sheet).

```
App
├─ /                              ← Home: live DAG strip, latest blocks/txns, omni-search, gas
├─ /search?q=…                   ← omni-search resolver (redirects to the right entity)
├─ /block/[id]                   ← block detail (height + blue_score + parents + finality)
├─ /blocks                       ← paginated block list (by blue_score order)
├─ /tx/[hash]                    ← TRANSACTION detail — the marquee "Explain this tx" page
├─ /address/[addr]               ← address overview (plain-English summary first)
│   ├─ ?tab=txns | internal | tokens | logs | analytics
├─ /contract/[addr]              ← contract: verified source, Read, Write (wallet OR gasless)
│   ├─ ?tab=code | read | write | events | analytics
├─ /token/[addr]                 ← token: holders, transfers, supply, plain-English "what is this"
├─ /dag                          ← Live DAG view (realtime GHOSTDAG visualization)
├─ /verify                       ← contract verification flow (paste source → status)
├─ /gas                          ← gas tracker (informational; Citrate is gasless via relayer)
├─ /apis                         ← developer hub: REST/MCP docs + "Get an API key"
├─ /account                      ← user account: API keys, saved labels, data export/delete
│
├─ Ask CitrateScan (drawer)      ← PERSISTENT on every route — agent panel, tool-calling
├─ Inline "Explain" / "Ask about this"  ← affordance on every entity (tx, addr, contract, block)
├─ Auth (modal, via Privy)       ← wallet login overlay, not a route
└─ Command palette (⌘K)          ← omni-search + jump-to + agent prompt, available everywhere
```

**Resist orphan routes.** Drawers, popovers, and the command palette keep the
user anchored to the entity they're looking at. The agent drawer in particular
must never make the user lose the page they're on.

---

## 4. Layout — desktop (≥1024px)

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  ◆ CitrateScan   ⌕ Search address / tx / block / token / model…   ● 40204 · #281,728  [Log in] │  ← header (64px)
├───────────────────────────────────────────────────────────────────┬────────────────────┤
│                                                                    │  ✦ Ask CitrateScan │  ← agent drawer
│  PAGE BODY (max ~1080px content measure, centered)                 │  ───────────────── │     (380px, collapsible)
│                                                                    │  “Ask about this   │
│  ┌─ PLAIN-ENGLISH SUMMARY (always first, full-width card) ──────┐  │   transaction…”    │
│  │  ✦ What happened                                             │  │                    │
│  │  Alice sent 1,250 SALT to a Uniswap-style router, which      │  │  ┌─ assistant ──┐  │
│  │  swapped it for 0.42 cWETH. Gas was paid by the Foundation.  │  │  │ This tx…     │  │
│  │  Finalized · blue · blue_score 281,701.        [Ask agent →] │  │  │ → 3 internal │  │
│  └──────────────────────────────────────────────────────────────┘  │  │   transfers… │  │
│                                                                    │  └──────────────┘  │
│  ┌─ Tabs: Overview · Internal · Logs · State diff · Raw ────────┐  │                    │
│  │  [decoded calldata / token transfers / event logs …]         │  │  [ Ask…      ][↑]  │
│  └──────────────────────────────────────────────────────────────┘  │                    │
│                                                                    │                    │
└────────────────────────────────────────────────────────────────────┴────────────────────┘
```

- **Header (sticky, 64px):** brand mark → omni-search (the spine of the app,
  always present) → live **ChainBadge** (status dot, chain `40204`, live
  blue-score/height tick) → `AuthButton`. The search box is large and central;
  it is the primary navigation.
- **Page body:** centered, ~1080px measure. **The plain-English summary card is
  always the first thing in the body**, full width, visually distinct (accent
  left-border + ✦ mark). Below it, the entity's data lives in **tabs** —
  decoded/human view first, raw last.
- **Agent drawer (right, 380px, collapsible):** the persistent Ask CitrateScan
  panel. When collapsed it's a thin rail with a ✦ button + unread pulse.
  Context-aware: opening it from a tx page pre-seeds "Ask about this
  transaction." It can be popped to full-screen on smaller windows.
- **Inline affordances:** every entity reference (hash, address, block) renders
  as an `EntityChip` with a hover menu: **Open**, **Copy**, **Explain**, **Ask
  about this**. This is how the agent is woven in everywhere (§8).

### Home (`/`) specifics

```
┌──────────────────────────────────────────────────────────────────────────┐
│            CitrateScan — the AI-native explorer for Citrate                │
│       ⌕  Search any address, tx, block, token, or ask a question…          │  ← big omni-search hero
│       [ Explain a tx ] [ What's the latest block? ] [ Top holders of … ]   │  ← agent prompt chips
├───────────────────────────────┬──────────────────────────────────────────┤
│  ◇ LIVE DAG (mini, animated)   │  Latest blocks (by blue_score)            │
│   tips: 281,728 · 281,727      │   #281,728 blue  · 7 txns · sel-parent…   │
│   [click → /dag]               │   #281,727 blue  · 2 txns                 │
│                                │  Latest transactions                       │
│  ◇ Chain stats                 │   0x9f…42  ✦ swap · 1,250 SALT            │
│   blue_score 281,728           │   0x3a…0c  ✦ transfer · 12 cWETH          │
│   finality depth 100           │                                            │
│   gas: gasless (relayer)       │                                            │
└───────────────────────────────┴──────────────────────────────────────────┘
```

The omni-search hero accepts **both** structured queries (a hash, an address, a
block number) **and** natural language ("who holds the most SALT?") — the latter
routes into the agent. Latest-txn rows lead with the **decoded action** chip
(✦ swap / transfer / mint), never "0 SALT".

## 4b. Layout — mobile (<768px)

```
┌─────────────────────────────┐
│ ◆ CitrateScan          [≡]  │  ← header collapses; search becomes full-screen on tap
├─────────────────────────────┤
│ ⌕ Search or ask…            │
├─────────────────────────────┤
│ ┌─ ✦ What this is ────────┐ │  ← plain-English summary FIRST, full-bleed
│ │ Alice swapped 1,250     │ │
│ │ SALT → 0.42 cWETH.      │ │
│ │ Finalized · blue.       │ │
│ │            [Ask agent ↓]│ │
│ └─────────────────────────┘ │
│ [Overview][Internal][Logs]… │  ← horizontally scrollable tabs
│ ┌─────────────────────────┐ │
│ │ decoded fields…         │ │
│ └─────────────────────────┘ │
├─────────────────────────────┤
│  ✦ Ask CitrateScan      [↑] │  ← agent as a bottom sheet (drag up)
└─────────────────────────────┘
```

- Search expands to full-screen on tap. Tabs scroll horizontally. The agent is a
  **bottom sheet** that drags up over the content, pinned above the keyboard
  (use `dvh` + safe-area insets). Entity chips remain tappable; the hover menu
  becomes a tap menu. Tables collapse to stacked key/value cards.

---

## 5. Component inventory

| Component | Notes |
|---|---|
| `AppShell` | header + body + collapsible agent drawer; responsive (drawer → bottom sheet) |
| `OmniSearch` | the central search; routes by input shape OR natural language → agent (§6a) |
| `ChainBadge` | live status dot (green/amber/red), chain `40204`, ticking **blue_score** + height |
| `AuthButton` | Privy login/logout; short address + avatar when authed |
| `CommandPalette` | ⌘K — search, jump-to-entity, and "ask the agent" in one |
| `SummaryCard` | **the signature component** — plain-English "what happened/what this is", first on every entity page; ✦ mark, accent border, `[Ask agent]` CTA |
| `EntityChip` | a hash/address/block reference; mono, de-emphasized, hover/tap menu (Open · Copy · Explain · Ask about this) |
| `DecodedTxView` | decoded calldata → function name + named args; token transfers; "0 SALT but it's a token transfer" handling |
| `InternalTxnTable` | internal (message-call) transfers with from/to/value |
| `LogsView` | decoded event logs (named) with raw toggle |
| `StateDiffView` | before/after storage + balance deltas, plain-language rollup |
| `DagView` | realtime GHOSTDAG canvas — blue/red nodes, multiple tips, selected-parent edges (bold) vs merge-parent edges (thin), click → block detail |
| `DagMiniStrip` | the home-page animated DAG teaser |
| `BlockCard` / `BlockDetail` | height **and** blue_score, parents (1 selected + 0–10 merge), blue/red, **finality** (depth-based, not "confirmations") |
| `FinalityBadge` | "Finalized" / "Finalizing — depth 37/100" (current_blue_score − block.blue_score) |
| `AddressOverview` | balance, summary, tabs (txns/internal/tokens/logs/analytics); label/annotate |
| `TokenHoldersTable` | top holders, %, with `topHolders` agent hook |
| `ContractCode` | verified source tabs (multi-file), ABI, metadata, compiler |
| `ContractRead` / `ContractWrite` | decoded function forms; write via wallet OR **gasless** ("no gas, on us") |
| `GaslessWriteFlow` | EIP-712 ForwardRequest signature → `POST /api/relay` → relayer pays |
| `VerifyFlow` | paste standard-JSON / flattened / metadata → status poll → verified |
| `ApiKeyManager` | issue key, **copy-once** modal, quota meter, revoke |
| `AgentPanel` | the persistent Ask CitrateScan drawer/sheet — tool-calling, citations, clickable entities |
| `AgentToolTrace` | shows which tools the agent called (e.g. `getLogs`, `topHolders`) — transparency |
| `StuckTxCopilot` | for pending/stuck txns: status, guidance, "what to do next" (§6h) |
| `ErrorDiagnosis` | decoded-error panel: turns `V2TooLittleReceived()` into plain English (§6h) |
| `GasTracker` | informational gas widget; "Citrate is gasless" framing |
| `CsvExport` | export button on every table (table-stakes) |
| `Toast`/`Banner` | indexer-catching-up, RPC-reconnecting, inference-warming, DAG-streaming (§7) |
| `LabelAnnotate` | auditor labels on addresses/txns (E2EE, user-private) |

Build on **shadcn/ui** primitives + Tailwind v4 tokens; headless, composable.

---

## 6. Signature flows

### a. Omni-search → resolves to the right entity

1. User types in the header search (or ⌘K palette).
2. **Classify by shape first** (instant, no network):
   - `0x` + 40 hex → **address** → `/address/[addr]`
   - `0x` + 64 hex → **tx hash or model hash** → try tx, fall back to model/block hash
   - all digits → **block height** → `/block/[id]`
   - a token symbol / contract name → **token/contract** (via search index)
   - **anything else / a question** → route to the **agent** (`POST /api/chat`)
3. While resolving, show a typed dropdown of candidates (recent, matches,
   "Ask the agent: '<query>'" as the always-available last row).
4. On resolve, deep-link to the canonical URL. The page opens with its
   `SummaryCard` already populated (plain English first).
5. Ambiguous input (a 64-hex that's both a valid tx and a model hash) shows a
   disambiguation chip set rather than guessing silently.

Data: `GET /api/search?q=` (structured) and `POST /api/chat` (natural language).

### b. Ask the agent — NL query → tool-calls → cited answer

1. User opens the agent drawer (or types a question into omni-search, or clicks
   **Ask about this** on an entity).
2. The question streams to `POST /api/chat`. The agent plans and **calls
   on-chain tools** (`getChainStatus`, `getBlock`, `getLogs`, `topHolders`,
   `addressActivity`, `searchTransactions`, `semanticSearch`, etc. — see §8).
3. `AgentToolTrace` shows, inline and live, which tools ran ("Reading logs for
   0x9f…42 …", "Ranking top holders …") — transparency is the trust mechanic.
4. The answer streams in markdown with **every on-chain reference rendered as a
   clickable `EntityChip`** ("…sent to **0x3a…0c** ↗"). Clicking navigates;
   the agent drawer stays open.
5. The answer ends with a **"sources"** footer: the exact reads it made (block,
   tx, contract) so the analyst can verify. No unsourced claims.
6. Context priming: when opened from a tx/address/contract page, the agent
   already knows the entity ("Ask about this transaction" pre-fills context).

### c. Explain this transaction — the marquee feature

This is the page that proves the thesis. Route: `/tx/[hash]`.

1. Page loads `GET /api/tx/[hash]`: receipt, decoded calldata, internal txns,
   event logs, and (when available) a **state diff**.
2. **`SummaryCard` renders first**, above everything: a plain-English narrative
   synthesized via `explainTransaction` —
   > *"Alice (0xf78…915) swapped 1,250 SALT for 0.42 cWETH through a
   > Uniswap-style router. Three internal transfers moved the tokens. Gas was
   > paid by the Citrate Foundation. Finalized — blue, blue_score 281,701."*
   - It **never** says "0 SALT" for a token transfer — it names the real
     movement (fixes Etherscan's "0 ETH" lie).
   - If the tx **failed**, the summary leads with the **decoded error in plain
     English** (see §6h), not the raw custom-error selector.
3. Below the summary, **tabs** for the power user, decoded view first:
   **Overview** (decoded action + token transfers) → **Internal** (message
   calls) → **Logs** (decoded events) → **State diff** (storage/balance deltas)
   → **Raw** (the hex/hash payload — present, but last).
4. Every address/contract/block in the decoded view is an `EntityChip`.
5. A persistent **[Ask about this transaction]** CTA opens the agent pre-seeded.

### d. Live DAG view — realtime GHOSTDAG

Route: `/dag` (mini strip on home).

1. Streams from `/api/dag` (SSE/WS over `wss://rpc.citrate.ai`). New blocks
   animate in at the frontier.
2. **DAG-native truths the visualization MUST encode** (do not draw it as a
   chain):
   - **Multiple tips at once** — render the frontier as several live tip nodes,
     not one head.
   - **blue_score ≠ height** — show both on each node; order/layout by
     **blue_score** (the consensus order), label height separately.
   - **Selected parent vs merge parents** — each block has exactly **1 selected
     parent** (bold edge) and **0–10 merge parents** (thin edges).
   - **Blue vs red blocks** — GHOSTDAG coloring; red = arrived in parallel,
     outside the blue set. Legend always visible.
   - **Finality by depth** — finalized when `current_blue_score −
     block.blue_score ≥ 100`. Finalized nodes are solid; finalizing nodes show
     a depth meter. **Never say "12 confirmations."**
3. Click a node → block detail (`/block/[id]`): parents (selected + merge),
   blue_score, height, finality, mergeset, txns.
4. A `DAG-streaming` state (§7) shows when the stream is live vs paused vs
   reconnecting. The view degrades gracefully to a periodic-poll snapshot if the
   socket drops.

### e. Verify a contract

Route: `/verify`.

1. User pastes/uploads source as **standard-JSON input**, **flattened source**,
   or **metadata** + picks compiler version (Solidity ≤ 0.8.26) and
   optimization settings.
2. `POST /api/verify` → returns a `guid`. UI shows a **status** state
   ("Compiling… Matching bytecode…") and polls `GET /api/verify/[guid]`.
3. On success → the contract page flips to **Verified**: source tabs
   (multi-file), ABI, constructor args, compiler metadata, and the **Read/Write**
   tabs unlock (§6f).
4. On failure → a **calm, specific** error ("Bytecode didn't match — check the
   optimizer runs (we expected 200)"), never a raw compiler dump. Offer "Ask the
   agent why this didn't match."

### f. Read / Write a contract — incl. gasless

Routes: `/contract/[addr]?tab=read` and `?tab=write`.

1. **Read:** decoded function forms (from ABI). Each view function renders typed
   inputs + a **Query** button → `readContract` via `eth_call`; result rendered
   with units/decimals resolved (not raw `uint256`).
2. **Write:** decoded forms with typed inputs. **Two paths, clearly offered:**
   - **Wallet write** — sign & send via wagmi/viem (user pays gas if they have
     SALT).
   - **Gasless write — "no gas, on us"** — the default, highlighted path. User
     signs an **EIP-712 ForwardRequest** (no gas) → `POST /api/relay` → the
     **Foundation relayer** submits via **CitrateForwarder** (EIP-2771; Citrate
     has **no native paymaster**). Show a reassuring `GaslessWriteFlow`:
     - Title: "Confirm — no gas, on us."
     - Plain-language summary of the call being authorized.
     - "Gas paid by the Citrate Foundation."
     - Silent/instant with embedded wallets; 150ms inline confirm, not a blocking
       spinner.
3. After submit, the resulting tx surfaces as an `EntityChip` → links to its
   `/tx/[hash]` page (which leads with the plain-English summary).

### g. Get an API key

Route: `/apis` (and `/account`).

1. Authed user clicks **Create API key** → `POST /api/keys`.
2. The raw key is shown **once** in a **copy-once** modal ("Copy it now — we
   only store a hash"). Our keys are **hashed at rest**; we can never show it
   again.
3. The key list shows masked keys, created date, and a **quota meter** (calls
   used / limit). Revoke per key.
4. The page documents the **two programmatic surfaces**: the Etherscan-compatible
   REST API (`/api/v1`) and the **MCP** endpoint (`/api/mcp`) for agent
   integrations, with copy-paste examples and the user's key pre-filled.

### h. Stuck-tx copilot + decoded-error diagnosis

1. **Stuck/pending tx** (`/tx/[hash]` where status is pending): the
   `StuckTxCopilot` replaces the empty "pending…" with **guidance** — where it is
   (in mempool / seen by N nodes), why it might be waiting, and what the user can
   do. On a DAG, frame this as "waiting to be merged into the blue set / waiting
   for finality depth," not "waiting for confirmations."
2. **Failed tx with a custom error:** `ErrorDiagnosis` runs `diagnoseFailure`. It
   turns `Fail with Custom Error 'V2TooLittleReceived()'` into:
   > *"The swap reverted: the output was less than the minimum you asked for
   > (slippage). The price moved between quote and execution. Try a higher
   > slippage tolerance or a smaller size."*
   The raw selector + ABI match stays available behind a "show raw" toggle, but
   the human gets the sentence first. Always offer **[Ask the agent]** for a
   deeper trace.

---

## 7. State matrix (design every cell)

| Surface | Loading | Empty | Error | Special |
|---|---|---|---|---|
| SummaryCard | shimmer sentence | (never empty — always synthesizes something) | "Couldn't summarize — showing raw data below" | **inference-warming**: "The summary model is coming online — raw data is ready below" |
| Tx detail | skeleton tabs | "No internal txns / logs" per tab | inline retry | failed-tx → leads with `ErrorDiagnosis`; pending → `StuckTxCopilot` |
| Address overview | skeleton rows | "No activity yet" | toast | high-volume address → virtualized + "indexing more…" |
| DagView | skeleton lattice | — | "DAG stream dropped — showing last snapshot" | **DAG-streaming**: live ● / paused ⏸ / reconnecting ◌ indicator |
| Block detail | skeleton KVs | — | retry | finalizing → `FinalityBadge` depth meter (n/100) |
| ChainBadge | amber dot "connecting" | — | **red dot "RPC reconnecting"** (never blocks UI) | blue_score ticks live |
| ContractRead/Write | spinner per call | "No read/write fns" | decoded revert reason | unverified → "Verify to decode" CTA |
| VerifyFlow | "Compiling… matching…" | — | calm specific mismatch reason | queued behind other jobs |
| AgentPanel | streaming cursor + `AgentToolTrace` | prompt chips | "Agent couldn't reach a tool — retry" | **inference-warming** calm copy |
| ApiKeyManager | spinner | "No keys yet" | toast | copy-once modal (key shown once) |
| Any table | shimmer rows | "Nothing here yet" | retry | **indexer-catching-up** banner (see below) |

**Four states are unique to this app and MUST be designed explicitly:**

- **Indexer catching up** — the explorer's index can lag the chain tip after a
  deploy/reorg. Show a calm banner ("Indexer is ~120 blocks behind the tip —
  newest activity may be a moment late"), keep the page usable, and tick toward
  caught-up.
- **RPC reconnecting** — testnet can blip; the badge goes amber/red but pages
  stay readable from cache.
- **Inference warming** — the AI gateway/model may still be coming online; the
  agent and SummaryCard explain calmly and offer retry, never a raw error. Raw
  on-chain data is always shown even when the *summary* model is warming.
- **DAG streaming** — the live socket has three honest states (live / paused /
  reconnecting); the visualization degrades to a snapshot, never freezes or lies.

---

## 8. The AI agent moment (woven in, not bolted on)

The agent is the product's differentiator. It must feel **native to the
explorer**, present at the level of every entity — not a chatbot in a corner.

- **Inline on every entity.** Every `tx`, `address`, `contract`, `block`, and
  `token` page carries **[Explain]** and **[Ask about this]**. Every
  `EntityChip` (a hash anywhere on any page) has those in its hover/tap menu.
  Clicking pre-seeds the agent with that entity's context.
- **The SummaryCard is the agent, ambient.** The plain-English summary atop each
  page is produced by `explainTransaction` / `explainContract` — the agent's
  voice, always-on, no question required.
- **Tool transparency.** `AgentToolTrace` shows the exact tools called and the
  entities read. Answers cite their sources. This is how an **auditor** trusts
  it: nothing is asserted that isn't backed by a named on-chain read.
- **Clickable answers.** Entities in the agent's prose are live chips — the
  answer is navigable, turning a paragraph into a research trail.
- **The agent's toolbox (reference these in copy/affordances):**
  `getChainStatus`, `getBlock`, `getTransaction`, `getAddress`, `getBalance`,
  `getLogs`, `readContract`, `isContract`, `exploreDag`, `searchTransactions`,
  `addressActivity`, `topHolders`, `tokenTransfers`, `indexAddress`,
  `semanticSearch`, `explainTransaction`, `explainContract`, `diagnoseFailure`.
- **Persistent, context-carrying drawer.** It survives navigation — ask about a
  tx, click an address in the answer, and the agent now has both in context.

---

## 9. Backend ↔ frontend wiring map (the functional contract)

Every interactive surface and the exact backend it binds to. **This table is the
coverage checklist — if the design omits a row, functionality is missing.**
Stack: **Next 16, React 19, viem/wagmi, Privy, Vercel AI SDK v6, Drizzle + Neon,
Tailwind 4**; AI via an OpenAI-compatible gateway. RPC `https://rpc.citrate.ai`
+ `wss://rpc.citrate.ai`.

| UI surface | Hook / client call | API route / data source | Data shape |
|---|---|---|---|
| Agent panel (stream) | `useChat()` (`@ai-sdk/react`) → `POST /api/chat` | `streamText` + tool-calling over the inference gateway; tools hit live RPC/index | UI message stream (SSE) + tool-call events |
| Inline Explain / Ask-about-this | `useChat().sendMessage` w/ entity context → `POST /api/chat` | same; pre-seeded `explainTransaction`/`explainContract` | streamed answer + entity citations |
| Omni-search (structured) | `useSearch(q)` → `GET /api/search?q=` | classifier + index (Neon) + RPC fallbacks | `{ kind, url, candidates[] }` |
| Omni-search (natural language) | `useChat()` → `POST /api/chat` | agent | message stream |
| ChainBadge (live status) | `useChainStatus()` poll → `getChainStatus` tool / RPC | `https://rpc.citrate.ai` `eth_*` | `{ chainId:40204, height, blueScore, gasPrice, up }` |
| Home: latest blocks | `useBlocks()` → `GET /api/blocks` | indexer (Neon) + RPC | `Block[]` (height, blueScore, blue, txCount, tips) |
| Home/Block list pagination | `useBlocks({cursor})` → `GET /api/blocks?cursor=` | indexer | paginated `Block[]` (ordered by blueScore) |
| Block detail | `useBlock(id)` → `GET /api/blocks/[id]` | RPC + indexer | `{ height, blueScore, blue, selectedParent, mergeParents[], finalityDepth, txns[] }` |
| FinalityBadge | derived from block + status | `current_blue_score − block.blue_score ≥ 100` | `{ finalized:boolean, depth, threshold:100 }` |
| Live DAG view | `useDagStream()` → `GET /api/dag` (SSE/WS) | `wss://rpc.citrate.ai` + indexer | streamed `{ tips[], nodes[], edges(selected/merge), blue/red }` |
| Tx detail / Explain-this-tx | `useTransaction(hash)` → `GET /api/tx/[hash]` | RPC (`eth_getTransaction*`) + decoder + indexer | `{ status, blueScore, decodedCall, internalTxns[], logs[], stateDiff?, gasPaidBy:"Foundation" }` |
| Decoded calldata / token transfers | within `useTransaction` | ABI decoder + token registry | `{ fn, args[], transfers[] }` (named, units resolved) |
| State diff tab | within `useTransaction` | trace / state-diff source | `{ storage[], balanceDeltas[] }` |
| Tx narrative (SummaryCard) | `explainTransaction` tool via `POST /api/chat` | agent over the tx payload | plain-English string + entity refs |
| Failed-tx diagnosis | `diagnoseFailure` via `POST /api/chat` | agent + ABI/error registry | `{ plain, rawError, suggestion }` |
| Stuck-tx copilot | `useTransaction` (pending) + agent | mempool/RPC status | `{ pending:true, seenBy, guidance }` |
| Address overview | `useAddress(addr)` → `GET /api/address/[addr]` | RPC + indexer (`addressActivity`) | `{ balance, isContract, label, txns[], internal[], tokens[], logs[] }` |
| Address — token holdings | within `useAddress` / `tokenTransfers` | indexer | `TokenBalance[]` (units resolved) |
| Address analytics | `addressActivity` tool | indexer | activity series, counterparties |
| Label / annotate | `useLabels()` → `/api/account` (E2EE) | client-encrypted, stored at rest | user-private labels |
| Contract code | `useContract(addr)` → `GET /api/contract/[addr]` | verification store + RPC `eth_getCode` | `{ verified, sources[], abi, compiler, metadata }` |
| Contract Read | `useContractRead(fn,args)` → `readContract` | `eth_call` via RPC | typed result (decimals/units resolved) |
| Contract Write (wallet) | wagmi `useWriteContract()` | viem → RPC | `{ txHash }` |
| Contract Write (gasless) | `useGaslessWrite()` → sign EIP-712 → `POST /api/relay` | Foundation relayer pays via **CitrateForwarder** (EIP-2771) | `{ txHash }` |
| Token page | `useToken(addr)` → `GET /api/contract/[addr]` + `topHolders` | indexer + RPC | `{ name, symbol, decimals, supply, holders[], transfers[] }` |
| Top holders | `topHolders` tool | indexer | ranked `{ addr, balance, pct }[]` |
| Verify — submit | `useVerify()` → `POST /api/verify` | compiler/verification service | `{ guid }` |
| Verify — poll | `useVerifyStatus(guid)` → `GET /api/verify/[guid]` | verification service | `{ status, message }` |
| Login / identity | `usePrivy()` (`ready, authenticated, user, login, logout`) | Privy embedded wallet | `user.wallet.address` |
| Session verify (server) | server reads Privy token | `PRIVY_APP_SECRET` | authed user id |
| SALT balance (any address) | wagmi `useBalance({address})` | live RPC | `{ value, decimals:18, symbol:"SALT" }` |
| API keys | `useApiKeys()` → `GET/POST/DELETE /api/keys` | Neon; keys **hashed** at rest, copy-once | `{ id, masked, createdAt, quotaUsed, quotaLimit }` |
| Etherscan-compat REST | external clients → `/api/v1` | indexer/RPC adapters | Etherscan-shaped JSON |
| MCP endpoint | agent clients → `/api/mcp` | the agent toolbox over MCP | MCP tool schema/results |
| Account export | `GET /api/account/export` | E2EE user data (client-decrypted) | export bundle |
| Account delete | `DELETE /api/account` | purge user rows | `{ ok }` |
| Settings / logins (E2EE) | client key from **wallet signature** | encrypted at rest (Neon) | E2EE blob |
| Third-party API keys (for agent) | `useAccount()` → `/api/account` | **encrypted-at-rest** (agent can decrypt to call) | provider keys |
| CSV export (tables) | `useCsvExport(table)` | the table's underlying route | CSV stream |
| Gas tracker | `useChainStatus()` | RPC | `{ gasPrice }` framed "gasless via relayer" |

**Notes for design:**

- **Hybrid privacy model** (surface it as quiet trust, not friction): the user's
  **settings/logins are E2EE** with a client-held key derived from a **wallet
  signature**; **our API keys are hashed** (shown copy-once, never recoverable);
  **third-party keys are encrypted-at-rest** so the agent can decrypt and use
  them on the user's behalf. Copy should reflect this ("we store a hash, not your
  key").
- **Two independent streams** on a tx page: the **on-chain data** (`/api/tx`,
  always available) and the **AI summary** (`explainTransaction`, may be
  "warming"). They resolve independently — never block the raw data on the
  summary.
- **Gasless is the default write path**: there is **no native paymaster** on
  Citrate; gasless = app-layer EIP-2771 forwarder (CitrateForwarder) + the
  Foundation relayer. Frame on-chain writes as "no gas, on us."
- **DAG, not chain**: any list "ordered by block" is ordered by **blue_score**
  (consensus order), and finality is **depth-based** (≥100), never
  "confirmations."

---

## 10. Design system starter

- **Mode:** **dark-first.** `zinc-950` canvas, `zinc-900` panels, `zinc-800`
  borders, `zinc-100` text. Provide a light theme too (the explorer is a public
  utility — many users will want light).
- **Accent — calm, single:** Citrate green (the brand mark green; see
  `public/brand/mark_green.svg`). Use it **sparingly**: status dots, the ✦
  SummaryCard mark/border, the agent affordances, blue DAG nodes, primary CTAs.
  **Red** (`semantic-danger`) is reserved for **red DAG blocks** and **failed
  txns** — don't dilute it.
- **Brand assets:** under `public/brand/` — `mark_green.svg` / `mark_white.svg`
  / `mark_black.svg` (the geometric mark) and `marquee_white.svg` /
  `marquee_black.svg` (the wordmark). Use the mark as the ✦ agent/on-chain motif.
- **Type:** Geist Sans (UI) + **Geist Mono for all hashes, addresses, ABI, and
  code**. Mono is the signal that "this is raw chain data" — and it is always
  **de-emphasized** (smaller, muted) so the plain-English layer reads first.
- **Hash de-emphasis is a system rule, not a one-off:** addresses/hashes render
  as `0xf78…915` truncated chips, muted, copyable — never full-width walls of hex
  in the primary view. Full hex lives in the **Raw** tab and on copy.
- **DAG visual language:** blue node = blue set (accent), red node = red block
  (danger), **bold edge = selected parent**, **thin edge = merge parent**, solid
  fill = finalized, ring/meter = finalizing. This vocabulary is consistent
  everywhere the DAG appears (home strip, `/dag`, block detail).
- **Radius:** 2xl on cards/SummaryCard/forms; full on pills/chips/status dots.
- **Motion:** fast & physical — 120–180ms ease-out for UI; DAG blocks animate in
  at the frontier; agent tokens stream with a live cursor; the blue_score ticks
  with a subtle count-up. Respect `prefers-reduced-motion` (DAG falls back to
  instant placement; ticks jump).
- **Density:** generous whitespace around the SummaryCard and agent; **denser**
  in the power-user tabs (tables, logs, state diff) — the two audiences get two
  densities on the same page.
- **Iconography:** the brand mark / ✦ for on-chain + agent, a `◇`/lattice motif
  for the DAG, a `⛓` reserved for "anchored on-chain."

---

## 11. Accessibility & responsiveness

- **Full keyboard:** `⌘K` opens the command palette (search + jump + ask); `/`
  focuses search; `Enter` submits; arrow keys traverse search candidates; `Esc`
  closes overlays/drawer; `g` then `b/t/a/d` jumps to blocks/txns/address/DAG.
  Visible focus rings everywhere.
- **ARIA live region** on the streaming agent message and on the live ChainBadge
  block tick ("announce politely, not assertively").
- **DAG accessibility:** the canvas has a parallel accessible representation —
  every node is reachable via a keyboard-navigable list with the same data
  (height, blue_score, blue/red, finality); color is **never** the only signal
  (blue/red also carry a label/shape and appear in the legend).
- **Color is never the only signal:** status dots pair with labels; failed/red
  states carry an icon + text.
- **Targets ≥44px on mobile;** agent bottom sheet respects safe-area + keyboard
  insets (`dvh`). Tables collapse to stacked cards; tabs scroll horizontally.
- **Contrast AA minimum;** test the green accent and the red DAG nodes on the
  `zinc-950` canvas and in light mode.

---

## 12. Microcopy principles

- **Plain language first, hash second.** Lead with "Alice swapped 1,250 SALT for
  0.42 cWETH," then offer the hashes. Never headline a token transfer as "0
  SALT."
- **Decoded, calm errors.** `V2TooLittleReceived()` becomes "The swap reverted —
  the output was below your minimum (slippage)." Stack traces and raw selectors
  live behind "show raw," never in the human view.
- **Finality, not confirmations.** Say "Finalized" or "Finalizing — depth
  37/100," never "12 confirmations." Explain blue/red and tips in a tooltip in
  plain words ("this block arrived in parallel; GHOSTDAG ordered it after the
  blue set").
- **Gasless framing.** "No gas, on us" / "Gas paid by the Citrate Foundation" —
  never "meta-transaction," never gwei to end users (the gas tracker is for devs
  and labels itself informational).
- **Addresses are identity, not finance.** Small, mono, copyable, muted; labels
  and ENS-style names preferred when known.
- **Agent honesty.** The agent cites its reads and shows its tool trace; it says
  "I read block #281,728 and the ChatRegistry state" — never asserts the
  unsourced. If a tool fails, it says so plainly.
- **Copy-once keys.** "Copy it now — we store a hash, so we can't show this
  again."

---

## 13. Acceptance checklist (functionality coverage)

The prototype is complete when it expresses **every** row of §9 and **every**
state in §7. Concretely:

- [ ] Omni-search routes by shape (address / tx / block / token / model hash) and
      sends natural-language queries to the agent; ambiguous input disambiguates.
- [ ] **Every entity page leads with a plain-English `SummaryCard`** above the
      raw tabs; token transfers never read as "0 SALT."
- [ ] **Explain-this-tx**: decoded calldata + internal txns + logs + state diff,
      narrative summary first, Raw tab last; failed tx → decoded `ErrorDiagnosis`;
      pending tx → `StuckTxCopilot`.
- [ ] **Live DAG view**: multiple tips, blue/red nodes, **selected vs merge
      parents** (bold/thin edges), **blue_score shown alongside height**,
      **depth-based finality** (≥100), click node → block detail. Streams live and
      degrades to a snapshot.
- [ ] Block detail shows height **and** blue_score, parents (1 selected + 0–10
      merge), blue/red, `FinalityBadge` (n/100) — no "confirmations."
- [ ] Address page: summary + tabs (txns/internal/tokens/logs/analytics), labels,
      CSV export.
- [ ] Contract: verified source tabs, ABI, **Read** (decoded reads) + **Write**
      with both **wallet** and **gasless ("no gas, on us")** paths via EIP-712 →
      `/api/relay`.
- [ ] **Verify** flow: standard-JSON / flattened / metadata → status poll →
      verified, calm failure copy.
- [ ] **Get an API key**: issue → **copy-once** modal → quota meter → revoke;
      `/apis` documents the `/api/v1` (Etherscan-compat) and `/api/mcp` surfaces.
- [ ] **Ask CitrateScan** agent: persistent drawer/sheet on every route, inline
      **Explain / Ask about this** on every entity and `EntityChip`, `AgentToolTrace`
      transparency, cited answers with **clickable entities**, context priming.
- [ ] State cells designed for **indexer-catching-up**, **RPC-reconnecting**,
      **inference-warming**, and **DAG-streaming** — calm, never raw errors; raw
      data never blocked on the AI summary.
- [ ] Live ChainBadge: chain `40204`, ticking blue_score/height, amber/red on RPC
      blip without blocking the page.
- [ ] Hybrid privacy reflected in copy: E2EE settings (wallet-signature key),
      hashed (copy-once) API keys, encrypted-at-rest third-party keys.
- [ ] CSV export on every table; deep-linkable URLs for every entity.
- [ ] Light + dark themes; full keyboard + DAG a11y; mobile drawer/bottom-sheet
      with keyboard-safe agent.

---

## 14. Out of scope (v1)

Multi-chain switching, NFT galleries/media rendering, on-chain governance/voting
UIs, validator/staking dashboards, portfolio P&L and price charts, paid API tiers
& billing UI, advanced graph-visualization fund-tracing canvas (the agent does
tracing in prose for v1), and admin/moderation consoles. Design with headroom for
these but don't build them.

---

### Reference: what already exists

A thin read-only explorer prototype exists in the sibling chatbot repo
(`tutorials/citrate-chatbot/src/components/explorer.tsx` and
`design-ref/explorer.jsx`): omni-search that routes by input shape, a live
status strip (chain / block / gas / gasless), and an honestly-labelled
**illustrative** GHOSTDAG sample (blue/red nodes, tips, selected parent). It also
shows the read-only patterns — every read goes through a sandboxed server
harness, no mocks, the DAG is clearly marked "illustrative until live DAG RPC is
confirmed." CitrateScan is the full product that prototype gestured at. The
design team should redesign the visuals freely — the wiring (§9) and the
"plain-English-first" thesis are the contract to preserve.
