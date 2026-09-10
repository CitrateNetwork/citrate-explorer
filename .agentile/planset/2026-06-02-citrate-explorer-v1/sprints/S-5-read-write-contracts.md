---
created: 2026-06-02T00:00:00Z
branch: main
author: Saul Loveman + Claude Opus 4.8 (1M context)
sprint: S-5
status: planned
---

# Sprint S-5: Read/Write contracts

## Sprint Metadata

| Field | Value |
|-------|-------|
| **Sprint ID** | `S-5` |
| **Sprint Name** | Read/Write contracts |
| **Goal** | A user reads contract state and submits writes — including **gasless** writes via the CitrateForwarder relayer through a Privy embedded wallet. |
| **Branch** | `main` (feature branches per WP) |
| **Start Date** | 2026-07-31 (target) |
| **End Date (target)** | 2026-08-14 |
| **Status** | `IN PROGRESS` placeholder → set at kickoff |
| **Planset** | `../PLANSET.md` |
| **Predecessors** | S-4 (verified ABI), S-1 (Privy auth) |

## Why this sprint

An agentic explorer shouldn't just show the chain — it should let you act on it.
The Read/Write Contract tabs turn a verified ABI into a typed UI: call any view
function, and submit any state-changing function. The Citrate-specific twist:
**there is no native paymaster** (decision X-6), so gasless writes must route
through **our** EIP-2771 `CitrateForwarder` + a relayer that pays SALT. This is
the chatbot project's hard-won lesson applied to an explorer — a user with 0 SALT
can still interact. This sprint depends on S-4 because the typed write form's data
source is the verified ABI.

## Deliverables

- `contracts/CitrateForwarder.sol` (EIP-2771) + Foundry tests
- `app/contract/[addr]/read/` — Read Contract tab (`eth_call` over verified ABI)
- `app/contract/[addr]/write/` — Write Contract tab (viem/wagmi via Privy embedded wallet)
- `lib/relay/forwarder.ts` + `app/api/relay/route.ts` — EIP-2771 relayer
- `hooks/useSponsoredWrite.ts` — build ForwardRequest → Privy EIP-712 sign → `/api/relay`
- In-repo address book entry for the deployed `CitrateForwarder`

## Test Baseline (start of sprint)

| Metric | Count | Captured | Canonical command |
|--------|-------|----------|-------------------|
| **Tests** | (S-4 close count) | at kickoff | `npx vitest run --reporter=json \| jq '.numTotalTests'` |
| **Formal specs** | (S-4 close count) | at kickoff | `find specs/tla -name '*.tla' \| wc -l` |
| **CI tripwires** | (S-4 close count) | at kickoff | `find .github/scripts/tripwires -type f \| wc -l` |
| **Frontmatter coverage** | (S-4 close fraction) | at kickoff | see `coverage/GATES.md` |

## Method

Per WP: TLA+ (forwarder nonce/replay) → BDD/Gherkin → failing test + tripwire →
code → refactor → adversarial → journal. Contract deploy runs as a CEREMONY;
the forwarder is security-sensitive (Rule 8) and needs review before mainnet use.

## Work Packages

### WP-5.1: Read Contract tab

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Estimated effort** | M |

**Scope:** `/contract/[addr]/read` — render every `view`/`pure` function from the
verified ABI as a typed form; execute via `eth_call`; decode + display results
(dual-unit for SALT-valued returns). For proxies, use the implementation ABI
against the proxy address. Does NOT do writes (WP-5.2).

**Acceptance Criteria** *(Rule 11)*

- [ ] Each view function from `contract_verifications` ABI renders an input form; calling it returns the live decoded result via `eth_call` (data source = live `eth_call` + verified ABI).
- [ ] A SALT-valued return (e.g. `balanceOf`) shows dual-unit SALT + grains (data source = decoded `eth_call`).
- [ ] For an EIP-1967 proxy, view calls use the implementation ABI against the proxy address and return correct state (data source = WP-4.3 proxy link + live `eth_call`).
- [ ] An unverified contract shows a "verify to read" prompt, never a fabricated ABI (data source = `contract_verifications` absence) — Rule 2.

**Tests added:** `read.viewcall.live.test.ts`, `read.dualunit.test.ts`, `read.proxy.live.test.ts`.

---

### WP-5.2: Write Contract tab (Privy embedded wallet)

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Estimated effort** | L |

**Scope:** `/contract/[addr]/write` — render every state-changing function from
the verified ABI; build the call with viem; sign + send via the Privy embedded
wallet (wagmi). Standard (user-pays) path. Surfaces tx hash → links to the S-2 tx
page. Does NOT do gasless (WP-5.4).

**Acceptance Criteria** *(Rule 11)*

- [ ] Each non-view function renders a typed form; submitting builds the correct calldata (viem `encodeFunctionData`) and sends via the Privy embedded wallet (data source = verified ABI + signed tx).
- [ ] A successful write lands on 40204 and the returned hash resolves on the S-2 tx page with matching method + args decoded (data source = live receipt + `/api/tx`).
- [ ] `payable` functions accept a SALT value (dual-unit input); the value is included in the tx (data source = live tx value).
- [ ] A revert surfaces the decoded reason, not a raw hex blob (data source = live revert reason).

**Tests added:** `write.send.live.test.ts`, `write.payable.live.test.ts`, `write.revert.live.test.ts`.

---

### WP-5.3: CitrateForwarder contract + deploy ceremony

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Estimated effort** | L |

**Scope:** `contracts/CitrateForwarder.sol` — EIP-2771 forwarder: EIP-712
`ForwardRequest` verify + per-user nonce + relayer allowlist. Foundry tests.
Deploy to 40204 with a funded relayer wallet; record the address in an in-repo
address book. **Do not reuse `0x1f17…` (InstitutionalVault trap) or any classroom-
gated forwarder — deploy our own (X-5/X-6).** Does NOT include the relayer service
(WP-5.4).

**Acceptance Criteria** *(Rule 11)*

- [ ] `forge test` covers happy path, bad-signature revert, replay (nonce reuse) revert, and non-allowlisted-relayer revert (data source = Foundry on REVM).
- [ ] Deployed `CitrateForwarder` returns non-empty `eth_getCode` on `rpc.citrate.ai`; address recorded in the address book and verified ≠ known trap addresses (data source = live `eth_getCode`, X-5).
- [ ] A TLA+ spec models nonce monotonicity / no-replay and passes TLC (data source = `specs/tla/ForwarderNonce.tla`).
- [ ] The deployed forwarder passes a `building-secure-contracts` review (Rule 8) with findings resolved (data source = dated audit in `audits/`).

**Tests added:** Foundry suite `CitrateForwarder.t.sol` · TLA+ `ForwarderNonce.tla` · `forwarder.getcode.live.test.ts`.

---

### WP-5.4: Gasless write path (`/api/relay` + useSponsoredWrite)

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Estimated effort** | L |

**Scope:** `app/api/relay/route.ts` (validate Privy session → validate
ForwardRequest → submit outer tx signed by the relayer key → return hash; relayer
key from secret, never client-exposed) and `hooks/useSponsoredWrite.ts` (build
ForwardRequest, Privy EIP-712 sign, post to `/api/relay`, surface status). A
"gasless" toggle on the Write tab. Does NOT include quotas/abuse controls beyond
basic rate limit (full quotas in S-6).

**Acceptance Criteria** *(Rule 11)*

- [ ] An integration test signs a ForwardRequest with a test user key and asserts a real tx is mined AND **gas was deducted from the relayer, not the user** (data source = live receipt + relayer/user balance deltas) — the headline P5 metric.
- [ ] A user holding **0 SALT** completes a write end-to-end via the gasless toggle; the on-chain event fires (data source = on-chain event emitted, X-6).
- [ ] The relayer rejects: invalid Privy session (401), bad ForwardRequest signature, and a replayed nonce (data source = `/api/relay` responses + forwarder revert).
- [ ] The relayer key is never sent to the client; only the relayer address is public (data source = client bundle/network inspection).

**Tests added:** `relay.gasless.live.test.ts`, `relay.zerosalt.live.test.ts`, `relay.reject.test.ts`.

---

## Dependencies

| Dependency | Status | Impact if blocked |
|------------|--------|-------------------|
| S-4 verified ABI (`contract_verifications`) | Required | Read/Write forms have no ABI source |
| S-1 Privy auth + embedded wallets | Required | Signing path |
| D-Forwarder (deployed + funded relayer) | Deploy ceremony WP-5.3 | No gasless without it |
| Relayer SALT funding | Provision | Relayer can't pay gas |

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Reusing a trap forwarder address (0x1f17 etc.) | Med | High | Deploy our own; verify `eth_getCode` ≠ traps (X-5); address book |
| Relayer SALT drained by abuse | Med | High | Basic rate limit now; full per-key quotas in S-6 before public write access |
| Privy embedded wallet can't EIP-712 sign on Citrate | Low | Med | Validated in S-1; embedded wallet signs locally, chain-agnostic |
| Forwarder security bug (replay, signature) | Low | High | Foundry adversarial tests + TLA+ nonce spec + Rule 8 audit (WP-5.3) |

## Notes

The Citrate-specific delta a generic explorer plan would miss: **no native
paymaster**, so gasless is app-layer EIP-2771 + a relayer, and the forwarder must
be *ours* (the 0x1f17/classroom-gated addresses are traps). Deploy + first
sponsored write run as a CEREMONY; the forwarder is security-sensitive (Rule 8).

## Definition of Done

- Read Contract tab executes live `eth_call` over verified ABIs (proxy-aware), dual-unit SALT; never fabricates an ABI.
- Write Contract tab sends user-paid writes via Privy embedded wallet; reverts decoded.
- `CitrateForwarder` (ours, ≠ traps) deployed to 40204, `eth_getCode` non-empty, Foundry + TLA+ + Rule 8 audit green.
- Gasless path proven: a 0-SALT user lands a write; gas deducted from relayer, not user; relayer rejects bad/replayed requests; relayer key never client-exposed.
- Four ratchets non-decreasing; deploy ceremony + audit recorded; `RETRO.md` + journal committed; S-6 kicked off.
