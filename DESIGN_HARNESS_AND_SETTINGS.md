---
created: 2026-06-02T00:00:00Z
branch: main
author: Saul Loveman + Claude Opus 4.8 (1M context)
status: active
---

# CitrateScan — Design Doc: Read-Only Chain/Indexer Harness & Settings

> **For:** the Claude design team + engineering building the CitrateScan prototype async.
> **Product:** `citrate-explorer` (brand **CitrateScan**) — an AI-native BlockDAG
> explorer for Citrate Network (chain `40204`).
> **Covers two assets:** (1) a **secure, server-side, read-only chain + indexer
> harness** that powers BOTH the human explorer UI and the AI agent's tool-calls, and
> (2) a **comprehensive settings/account** experience for fair, open-source, secure
> software.
> **Sibling gold standard:** this mirrors `citrate-chatbot`'s
> `DESIGN_HARNESS_AND_SETTINGS.md` (and its real `src/lib/harness/*`), extended for an
> explorer's larger read surface (indexer DB, DAG, omni-search, semantic search).
> Same design ethos: dark-first, emerald accent, "Web3 power, Web2 calm."

---

# Part A — Secure read-only chain + indexer harness

## A1. What it is & why

**One server-side service** is the single seam through which *everything* reads the
chain and the indexed database. Both consumers go through it:

1. **The human explorer UI** — address/tx/block/contract pages, the live DAG view,
   omni-search, holder lists, token transfers — all fetch via `/api/*` routes that
   call the harness.
2. **The AI agent** — the model (AI SDK v6 tool-calling, in `/api/chat`) is handed a
   `tools[]` surface whose executors are *the same harness ops*. The agent can explore
   Citrate live, read the indexer DB, trigger on-demand indexing, and synthesize
   explanations.

Why a single harness rather than letting routes and the agent each touch RPC/DB
directly: **one place to enforce the security model**. Every read — human or AI —
passes through the same zod validation, the same deny-by-default allowlist, the same
rate limiter, the same caps, the same audit log. The harness has **no ability to sign,
write, or exfiltrate keys** — by construction, not by policy.

```
src/lib/harness/
  allowlist.ts   ← RPC method allowlist + contract ABI registry (deny-by-default)
  client.ts      ← read-only viem PublicClient (fixed RPC + fallback, caps)
  ops.ts         ← the read-only operations (zod-validated), shared by UI + agent
  indexer.ts     ← indexed-DB reads (drizzle/Neon) — holders, transfers, activity
  dag.ts         ← GHOSTDAG queries (citrate_getDagStats + derivations)
  semantic.ts    ← citrate_semanticSearch / citrate_getTextEmbedding wrappers
  audit.ts       ← append-only audit log (surfaced in Settings → Transparency)
  tools.ts       ← AI SDK tool definitions (wrap ops, expose to the model)
```

## A2. The security model (the heart of this design)

The harness is **read-only by construction**. There is no code path from a harness op
to a state change. Security is layered — every layer is independently sufficient to
stop a write; together they're defense-in-depth.

| Layer | Rule |
|---|---|
| **No keys, ever** | The harness instantiates a viem `PublicClient` with **no account and no signer**. It has no access to any private key, relayer key, or wallet. It is *structurally* incapable of signing or sending a transaction. There is no `WalletClient` anywhere in `src/lib/harness/`. |
| **Deny-by-default RPC allowlist** | A method reaches the node only if it is in `ALLOWED_RPC_METHODS`. Anything not explicitly listed is rejected before transport. Allowed (read-only): `eth_chainId`, `eth_blockNumber`, `eth_gasPrice`, `eth_getBalance`, `eth_getCode`, `eth_getStorageAt`, `eth_getTransactionByHash`, `eth_getTransactionReceipt`, `eth_getBlockByNumber`, `eth_getBlockByHash`, `eth_call`, `eth_estimateGas`, `eth_getLogs`, `eth_getTransactionCount`, and the read-only Citrate methods `citrate_getDagStats`, `citrate_semanticSearch`, `citrate_getTextEmbedding`. |
| **Explicitly forbidden** | `eth_sendRawTransaction`, `eth_sendTransaction`, `eth_sign`, `eth_signTypedData*`, `personal_*`, `eth_accounts`, `wallet_*`. These live in a `FORBIDDEN_RPC_METHODS` set checked **first**, so even an accidental future allowlist entry can't re-enable them. |
| **`eth_call` guardrails** | All calls are pinned to `latest`; `value = 0`; a **gas ceiling** (5M) bounds work; a **response-size cap** rejects oversized returndata; a **timeout** (9s/attempt) and retry/fallback handle blips; results are decoded server-side. The RPC URL/keys are **fixed server-side config and never reach the browser → no SSRF** (user input never selects the host). |
| **Contract allowlist for DECODED reads** | Decoded, human-readable reads (e.g. `ModelRegistry.getModel`, `CitrateForwarder.getNonce`, `ChatRegistry.getReceipts`) are restricted to a curated **ABI registry** of known, verified contracts. Any other address can still be inspected — code present? balance? raw `eth_call` with a user selector — but its output is labeled **"unverified raw"** and never presented as decoded/trusted. Verified-via-`/api/verify` contracts are promoted into the decoded set. |
| **Input validation (zod)** | Every op validates its arguments with a zod schema before any RPC/DB touch: address checksum (`isAddress`), `bytes32` shape (`0x` + 64 hex), block tags/heights, function names, pagination bounds. Malformed input is rejected with a 400; it never reaches the node or DB. |
| **Rate limiting & quotas** | Per-session **and** per-IP token-bucket limits, plus per-API-key quotas (Part B). Caps protect the RPC and the indexer DB from being used as an open proxy or DoS amplifier. Vercel BotID + WAF in front. |
| **Indexer reads are parameterized** | All indexer-DB reads go through drizzle with parameterized queries (no string-built SQL); the agent cannot inject arbitrary SQL — it can only call typed ops with validated args. |
| **Audit log** | Every harness call — op name, args hash, caller (session/key), backing method(s), latency, cache hit, decoded-vs-raw — is appended to an audit store and surfaced in **Settings → Transparency**. This is what makes "the agent can only do X" *verifiable* by the user. |

**Threat model handled:** open-proxy / RPC DoS abuse; key exfiltration (no keys
present); **prompt-injection coercing a write** (impossible — no write path exists, so
a malicious page/contract description cannot make the agent sign anything); oversized
or slow responses; SQL injection through the agent (parameterized only); SSRF (fixed
host); and "explore a hostile contract" (reads can't change state; decoded reads are
allowlisted, everything else is labeled unverified raw).

## A3. The AI tool surface (read-only)

These are exposed to the model via AI SDK v6 `tools` in `/api/chat`; their executors
are the harness ops, so the agent and the UI share one validated, audited path. Each
returns structured JSON the model summarizes and cites. The **Backing** column marks
each as **RPC** (pure node read), **DB** (indexer/Neon read), **RPC+DB** (joins live
state with the index), or **synthesis** (the agent composes other tools + LLM
reasoning — no new privilege).

| Tool | Args | Backing | What it does / output shape |
|---|---|---|---|
| `getChainStatus` | — | RPC | `eth_chainId`,`eth_blockNumber`,`eth_gasPrice` → `{chainId, blockNumber, gasPriceGwei, gasless:true}` |
| `getBlock` | `number\|hash\|"latest"` | RPC | `eth_getBlockBy*` → block header + tx hashes; includes DAG fields if present (parents, blueScore) |
| `getTransaction` | `txHash` | RPC | `eth_getTransactionByHash` + `eth_getTransactionReceipt` → `{found,status,from,to,blockNumber,gasUsed,logs}` |
| `getAddress` | `address` | RPC+DB | one-shot summary: code? balance? known-contract label? + indexed first/last-seen, tx count |
| `getBalance` | `address` | RPC | `eth_getBalance` → `{address, grains, salt}` (wei="grains", 18 decimals) |
| `getLogs` | `address?, topics?, fromBlock?, toBlock?` | RPC | bounded `eth_getLogs` (range-capped) → decoded for known ABIs, else raw |
| `readContract` | `address, functionName, args?` | RPC | decoded `eth_call` for **allowlisted** contracts only; unknown → reject + steer to `isContract` |
| `isContract` | `address` | RPC | `eth_getCode ≠ 0x` → `{isContract, known:name\|null}` (raw inspection seam) |
| `exploreDag` | `tip?, depth?` | RPC+DB | GHOSTDAG view: tips, selected parent, merge parents, blue/red, blue_score, merge set, anticone, finality (see A4) |
| `searchTransactions` | `{address?, from?, to?, method?, fromBlock?, toBlock?, limit?}` | DB | indexer query over decoded txs → paginated list |
| `addressActivity` | `address, window?` | DB | indexed activity series: tx counts, counterparties, first/last seen, in/out volume |
| `topHolders` | `token?, limit?` | DB | indexer holder table → ranked `[{address, balance, share}]` (native SALT or an indexed token) |
| `tokenTransfers` | `{token?, address?, fromBlock?, toBlock?, limit?}` | DB | indexed Transfer events → paginated transfers |
| `indexAddress` | `address` | RPC→DB write* | **on-demand indexing** the agent can trigger: backfill an address's history into the index. *Writes only to the **indexer DB**, never the chain.* Rate-limited + quota'd; queued, idempotent. |
| `semanticSearch` | `{query, kind?, limit?}` | RPC/DB | `citrate_semanticSearch` (+ local embedding via `citrate_getTextEmbedding`) → ranked semantic hits across indexed entities |
| `explainTransaction` | `txHash` | synthesis | composes `getTransaction`+`getLogs`+decode → plain-English narrative of what a tx did |
| `explainContract` | `address` | synthesis | composes `isContract`+verified ABI (or bytecode heuristics) → what the contract is/does; honest "unverified" if no ABI |
| `diagnoseFailure` | `txHash` | synthesis | re-`eth_call` at the tx's block + decode revert reason + gas analysis → why a tx reverted |

> `indexAddress` is the **only** tool that mutates anything, and it mutates **only the
> indexer DB** (our own cache/index of public chain data) — never the chain. It is
> still gated by rate limit, quota, zod validation, and the audit log, and it's
> idempotent (re-indexing is a no-op refresh). It is called out explicitly so a
> reviewer can confirm the chain remains untouched.

The system prompt instructs the model to use these tools for any live/factual claim
(never guess), to prefer the indexer for ranked/aggregate questions and RPC for
authoritative single reads, and to **cite the block height it observed**.

## A4. DAG exploration spec (`exploreDag` + the live DAG view)

Citrate is a **BlockDAG with GHOSTDAG** consensus — not a single chain — so CitrateScan
must show DAG structure honestly. The seam is `exploreDag`, backed by
`citrate_getDagStats` plus per-block header fields.

**`citrate_getDagStats` returns (canonical):**
```jsonc
{
  "tipsCount": <int>,
  "maxBlueScore": <int>,
  "currentTips": ["0x…", "0x…"],
  "ghostdagParams": { "k": 18, "maxParents": 10, "finalityDepth": 100, /* … */ }
}
```

**What the DAG view / `exploreDag` exposes:**
- **Tips** — `currentTips[]`: the current DAG frontier (blocks with no children yet).
- **Selected parent vs merge parents** — each block has ≤ `maxParents` (10) parents;
  one is the **selected parent** (the heaviest-blue chain link), the rest are **merge
  parents** the block merges into its history. The view distinguishes them visually.
- **Blue/red classification** — GHOSTDAG's k-cluster (`k = 18`) coloring: **blue**
  blocks are in the well-connected cluster of the selected-parent chain; **red** blocks
  are outside it (still valid, lower ordering weight). Edges/nodes are colored
  accordingly.
- **`blue_score`** — a block's position in the blue ordering (monotone along the
  selected chain). `maxBlueScore` is the current tip-side maximum.
- **Merge set** — the set of blocks a given block newly merges (its ancestors not
  already in the selected parent's past). Shown per block.
- **Anticone** — blocks neither in a block's past nor its future (concurrent blocks);
  surfaced for the selected block to make concurrency legible.
- **Finality by depth** — a block is **final** when
  `current_blue_score − block.blue_score ≥ 100` (`finalityDepth`). The view shows a
  **finalized / finalizing** badge derived from this, never a fabricated "confirmed."

**Linear fallback for casual users.** A toggle collapses the DAG into the
selected-parent chain rendered as a familiar block list (height, hash, tx count, age),
so non-expert users get an Etherscan-like view while power users get the true DAG.

**Honesty rule (Rule 11).** If `citrate_getDagStats` is unavailable or a header lacks
DAG fields, the view shows an explicit **"DAG data unavailable — chain busy"** state
and falls back to linear-by-height. It **never fabricates** tips, blue scores, or merge
sets. The `exploreDag` op returns `{ degraded: true }` so the agent narrates the
limitation rather than inventing structure.

## A5. Architecture & wiring (ASCII)

```
  Browser (CitrateScan explorer UI)              Model (AI agent, tool-call)
   block/tx/address/contract pages,               tools[] in /api/chat
   live DAG view, omni-search                              │
            │  /api/* (search, blocks, tx,                 │
            │   address, contract, dag, v1)                │
            ▼                                              ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │                 HARNESS  (server-side, READ-ONLY)                  │
   │                                                                    │
   │   zod validate ─▶ method/contract ALLOWLIST (deny-by-default)      │
   │        │                    │                                      │
   │        ▼                    ▼                                      │
   │   rate limit / quota ─▶ read-only viem PublicClient                │
   │   (per-session+IP+key)      (fixed RPC + fallback; gas/size/time   │
   │        │                     caps; NO signer, NO keys)             │
   │        │                    │                                      │
   │        │                    ├─▶ indexer DB reads (drizzle/Neon)    │
   │        │                    ├─▶ ABI registry (decode known)        │
   │        │                    ├─▶ short-TTL cache (hot reads)        │
   │        ▼                    ▼                                      │
   │                      audit log (every call)                        │
   └──────────────────────────────────────────────────────────────────┘
            │                                  │
            ▼                                  ▼
   Citrate RPC  https://rpc.citrate.ai     Neon (indexed DB)
   wss://rpc.citrate.ai  (read methods only)
```

- The UI calls `/api/*`; the agent calls the same ops via `tools[]` in `/api/chat`.
  **There is exactly one read engine.**
- Read-only viem `PublicClient` uses a `fallback([primary, rawNode])` transport with
  per-attempt retries and timeouts so a Cloudflare-edge blip doesn't fail a read —
  while the RPC host stays fixed server-side config (no SSRF, never sent to browser).
- Short-TTL cache (e.g. 4s for chain status, longer for immutable historical blocks)
  keeps the live status strip steady through deploy-window blips and shields the RPC.
- Reuse `src/lib/citrate/{chain,addresses,model-registry,abi}.ts` for chain constants
  and ABIs, exactly as the chatbot harness does.

## A6. Omni-search spec

A single input box resolves the user's intent by **input shape**, routing to the right
page; anything it can't classify falls through to the AI agent.

| Input heuristic | Classified as | Resolved route |
|---|---|---|
| `0x` + **40** hex chars | EOA or contract **address** | `/api/address/[addr]` → if `eth_getCode ≠ 0x`, show as contract (`/api/contract/[addr]`) |
| `0x` + **64** hex chars | **tx hash** *or* **block hash** | try `eth_getTransactionByHash`; if null, try `eth_getBlockByHash`; route to whichever resolves (tx wins) |
| pure **integer** | **block height** | `/api/blocks/[id]` (`eth_getBlockByNumber`) |
| **ENS-like / name / label** | label search | indexer label/name lookup → matching address(es) |
| `0x…` **+ function** (e.g. `0xabc… balanceOf(0x…)`) | **contract read** | `/api/contract/[addr]` with a decoded `readContract` call (allowlisted) or raw+labeled |
| **bytes32 model hash** | model lookup | `ModelRegistry.getModel` decoded read |
| **anything else** (natural language) | **agent fallthrough** | hand the raw query to `/api/chat`; the agent uses `semanticSearch` + tools to answer |

- Ambiguity (a 64-hex that is *both* a tx and a block hash, or a 40-hex that is both
  EOA and contract) is resolved by probing the chain and showing the strongest match,
  with a "this is also a …" cross-link.
- The natural-language fallthrough is what makes CitrateScan AI-native: "show me the
  top SALT holders this week" or "why did this tx fail" routes straight to the agent,
  which calls `topHolders` / `diagnoseFailure`.

## A7. Acceptance criteria (harness)

- [ ] **No write/sign method is reachable** — `FORBIDDEN_RPC_METHODS` is checked first;
      no `WalletClient`/signer exists in the harness; attempting a write is rejected
      server-side.
- [ ] **Every tool validates input (zod)** and respects the **method + contract
      allowlist**; malformed args never reach RPC/DB.
- [ ] **`eth_call` is capped** — latest block, value=0, gas ceiling, response-size cap,
      timeout — and the RPC URL **never reaches the client** (no SSRF).
- [ ] **Rate-limited + quota'd** per session/IP/key; BotID/WAF in front.
- [ ] **Decoded reads only for verified contracts**; everything else is labeled
      **"unverified raw."**
- [ ] **DAG state is honest** — real tips/blue-score/merge-set from `citrate_getDagStats`,
      finality via `blue_score ≥ 100` depth, OR an explicit degraded/linear fallback —
      **never fabricated.**
- [ ] **`indexAddress` mutates only the indexer DB**, never the chain; idempotent;
      audited.
- [ ] **Audit log** of every harness call is recorded and **visible in
      Settings → Transparency.**

---

# Part B — Settings & account

Fair, open-source, secure software gives users **control, transparency, and exit**.
Settings is where that promise is kept. A left-rail layout; **every control wires to a
real backend** — no dead toggles.

## B1. Layout

```
Settings
┌──────────────────┬────────────────────────────────────────┐
│ Account          │   [ section content ]                   │
│ API Keys         │                                         │
│ Privacy & Data   │                                         │
│ Watchlist&Alerts │                                         │
│ Appearance       │                                         │
│ Security         │                                         │
│ Transparency     │                                         │
│ Developer        │                                         │
│ About            │                                         │
└──────────────────┴────────────────────────────────────────┘
```

## B2. The hybrid privacy model (state this precisely to users)

CitrateScan stores three classes of secret with **three different protections**. The
settings UI must explain the tradeoff plainly — this is the "Encryption status" panel.

| Class of data | Protection | Who can read it | Why |
|---|---|---|---|
| **Settings & logins** (preferences, watchlist, account metadata) | **E2EE** — an AES key derived **client-side** from a wallet signature → **HKDF** → AES-256-GCM. The server stores **only ciphertext it cannot read.** | **Only the user** (their wallet reproduces the key). | Maximum privacy for things only the user needs; the server is a blind store. |
| **Our issued API keys** | **Hashed** — salted **SHA-256 + server pepper**. **Shown once at creation; never recoverable.** We store only the hash. | **No one** — not even us. We compare hashes on use. | A leaked DB can't yield working keys; copy-once is the honest UX consequence. |
| **Third-party provider keys** (e.g. an inference/model-provider key the agent must use server-side) | **AES-256-GCM at rest**, per-user key = **HKDF(server master, wallet)**. The server **can** decrypt at request time so indexer/agent tools can call the provider. | **The server, at request time** (and the user). | These keys must be *used* server-side, so they can't be E2EE — we minimize exposure with per-user encryption at rest and clear disclosure. |

**Plain-language version (put this in the UI verbatim-ish):**
> Your **settings and logins** are end-to-end encrypted — we store scrambled data only
> your wallet can unlock; we can't read them. The **API keys we issue you** are stored
> only as a one-way hash — we literally can't show them again, which is why you copy
> them once. Any **third-party provider key** you give us so the AI can call an outside
> service is encrypted at rest with a key derived just for you, but because the server
> has to *use* it on your behalf, the server can decrypt it at request time. We tell you
> this plainly so you can decide what to entrust.

## B3. Sections & every control's wiring

### Account
- **Privy address** (copy), **login method**, **linked accounts** — `usePrivy()`.
- **Embedded-wallet key export** — Privy's secure client-side export flow; the user owns
  their key, we never see it.
- **Sign out** / **sign out everywhere** — Privy session revoke (single + all).

### API Keys
- **Issue key** → `POST /api/keys` returns the plaintext **once** (copy-once UI; we
  persist only salted SHA-256 + pepper). After dismiss, it's unrecoverable.
- **Revoke key** → `DELETE /api/keys/[id]` (immediate).
- Per-key **quota + rate-limit** sliders and **usage** meter (calls today / quota),
  wired to the same limiter the harness enforces.
- Helper copy: **"Use this key with the REST API (`/api/v1`) and the MCP server
  (`/api/mcp`)."** with a curl + MCP-config snippet.

### Privacy & Data  *(the open-source/fairness core)*
- **Export my data** → `GET /api/account/export` streams **JSON + Markdown** of the
  user's CitrateScan data (watchlist, queries, settings) — server-decrypts the AES-GCM
  classes for the authed user, returns E2EE classes as ciphertext the client unlocks.
- **Delete history** → `DELETE /api/account` (history scope) purges the user's stored
  queries/activity in Neon.
- **Delete account & all data** → `DELETE /api/account` (full) purges all user rows.
  **Honest copy:** on-chain data the explorer *indexes* is **permanent and public** —
  deleting your account removes *your* CitrateScan records, not anything on the Citrate
  ledger, which no one can delete.
- **"What we store"** — a plaintext table: watchlist (E2EE), settings (E2EE), issued API
  keys (hash only), provider keys (AES-GCM at rest), query history (deletable),
  public chain data we index (permanent, public). No tracking by default.
- **Encryption status** — renders the **B2 hybrid table** with the plain-language
  explanation so users understand exactly which protection applies where.

### Watchlist & alerts
- Add/remove **addresses & contracts to watch** → stored **E2EE** (settings class).
- **Alerts** on watched entities (new tx, balance change, contract event) — toggles +
  delivery target; backed by the indexer + a notification job.
- Reorder/label entries; all client-encrypted before `PUT /api/account`.

### Appearance
- **Theme** (dark/light/system), **density**, **reduced motion**
  (respect `prefers-reduced-motion`), **font scale**. localStorage; no account needed.

### Security
- **Active sessions / revoke** — Privy session list + revoke (single + everywhere).
- **Passkeys / 2FA** — Privy passkey enrollment + management.
- Connected wallet management.
- Statement: **"CitrateScan is read-only and never holds your funds or signs anything."**

### Transparency  *(open-source ethos made visible)*
- **View the AI system prompt — verbatim** — render the exact instructions the agent
  runs under (imported from the system-prompt module). Radical honesty about steering.
- **Harness allowlist** — render the **exact read-only RPC calls** the agent can make
  (from `allowlist.ts`: the allowed set + the forbidden set) so users can verify the
  agent's ceiling.
- **Recent audit log** — the user's recent harness calls (op, backing method, latency,
  decoded/raw, cache) from the audit store.
- **Source / license / commit** — link to the repo, license, and the running
  **version / git commit** (build-time injected, e.g. `NEXT_PUBLIC_GIT_SHA`).
- **Model provenance** — model name + on-chain `modelHash` + IPFS CID; "the AI runs on
  Citrate."

### Developer
- **RPC URL** + chain id (`40204` / `0x9D0C`), **wss** endpoint.
- **"Add Citrate to your wallet"** — `wallet_addEthereumChain` payload (chainId 40204,
  native **SALT**, 18 decimals, rpc `https://rpc.citrate.ai`).
- **SDK / API / MCP docs links** + starter snippets (REST `/api/v1` curl, MCP
  `/api/mcp` config, viem `PublicClient` snippet).
- "Extend CitrateScan" ideas (custom indexers, webhook alerts).

### About
- What CitrateScan is, links, status page, changelog, contact.

## B4. Wiring map (control → route/hook → store)

| Control | Route / hook | Store |
|---|---|---|
| Address / login / linked / key export / sessions / passkeys | `usePrivy()` + Privy export & revoke flows | Privy |
| Issue / revoke / quota / usage API key | `POST`/`DELETE /api/keys[/id]` | Neon (salted SHA-256 + pepper hash) |
| Export my data | `GET /api/account/export` (JSON + Markdown) | Neon (server-decrypt AES-GCM classes) |
| Delete history / account | `DELETE /api/account` | Neon |
| Watchlist & alerts | `PUT /api/account` (E2EE payload) + indexer alert job | Neon (ciphertext) |
| Settings (theme excluded) | `PUT /api/account` (E2EE payload) | Neon (ciphertext) |
| Theme / density / motion / font scale | localStorage | client only |
| System prompt view | import from the system-prompt module | build-time source |
| Harness allowlist view | import from `src/lib/harness/allowlist.ts` | source |
| Audit log | `GET /api/account` (audit scope) | harness audit store |
| Version / commit | build-time env (`NEXT_PUBLIC_GIT_SHA`) | build |
| RPC URL / add-chain / docs | static config | client |
| E2EE key derivation | wallet signature → HKDF (client) | never leaves client |
| Provider-key encryption | HKDF(server master, wallet) → AES-256-GCM | Neon (ciphertext, server-decryptable) |

## B5. Acceptance criteria (settings)

- [ ] **Account**: Privy address, login method, linked accounts, **non-custodial key
      export**, sign out / everywhere.
- [ ] **API Keys**: issue (**copy-once**, hash-only storage), revoke, per-key
      quota/rate-limit/usage; REST + MCP usage snippets shown.
- [ ] **Privacy & Data**: one-click **export (JSON + Markdown)**; delete history; delete
      account, **honest that on-chain data is permanent**; "what we store" plaintext
      table; **encryption status** explains the hybrid model.
- [ ] **Hybrid privacy correct**: settings/logins **E2EE** (client-derived key);
      issued keys **hashed** (salted SHA-256 + pepper, copy-once); provider keys
      **AES-256-GCM at rest** (HKDF per-user, server-decryptable) — and explained.
- [ ] **Watchlist & alerts** persist (E2EE) and drive indexer-backed alerts.
- [ ] **Appearance**: theme/density/reduced-motion/font-scale (localStorage).
- [ ] **Security**: active sessions/revoke, passkeys, "never holds your funds."
- [ ] **Transparency**: **system prompt verbatim**, **harness allowlist**, recent
      **audit log**, source/license/commit, model provenance — all viewable.
- [ ] **Developer**: RPC URL, add-Citrate-to-wallet, SDK/API/MCP links + snippets.
- [ ] **Every control maps to a real backend (B4)** — no dead toggles.

---

## Cross-cutting notes

- **One harness, two consumers** — the UI and the agent share the exact same validated,
  allowlisted, audited read path. Never add a route or tool that bypasses it.
- **Rule 11 everywhere** — no fabricated chain or DAG data; on an RPC blip or missing
  DAG fields, show an honest degraded state and let the agent narrate the limitation.
- **Read-only is structural, not policy** — the win to protect in every PR is: there is
  no signer in `src/lib/harness/`, and `FORBIDDEN_RPC_METHODS` is checked first.
- **Build order suggestion:** read engine + `getChainStatus/getBlock/getTransaction/
  getAddress` → omni-search → indexer ops (`searchTransactions/topHolders/
  tokenTransfers/addressActivity`) → `exploreDag` + DAG view → agent tools + synthesis
  (`explain*`/`diagnoseFailure`) → Settings (Privacy&Data + Transparency first, then
  API Keys, Watchlist, the rest).
