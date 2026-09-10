---
created: 2026-06-02T00:00:00Z
branch: main
author: Saul Loveman + Claude Opus 4.8 (1M context)
sprint: S-4
status: planned
---

# Sprint S-4: Contract verification

## Sprint Metadata

| Field | Value |
|-------|-------|
| **Sprint ID** | `S-4` |
| **Sprint Name** | Contract verification |
| **Goal** | A user submits Solidity source and CitrateScan proves it matches the deployed bytecode via sandboxed recompile-and-diff — proxy-aware, with an Etherscan-compatible verify API. |
| **Branch** | `main` (feature branches per WP) |
| **Start Date** | 2026-07-15 (target) |
| **End Date (target)** | 2026-07-31 |
| **Status** | `IN PROGRESS` placeholder → set at kickoff |
| **Planset** | `../PLANSET.md` |
| **Predecessors** | S-1 (contracts table), S-2 (contract page) |

## Why this sprint

Verified source is the trust primitive an explorer exists to provide: it lets a
user read the code behind an address and lets every later feature (decoded logs
in S-2, the Write Contract form in S-5, the dev API in S-6) render against a real
ABI. Verification must precede S-5 because the typed write form needs a verified
ABI as its data source. The hard part is doing it honestly — a byte-exact
recompile-and-diff, not a "looks plausible" check — which means running untrusted
solc compiles in an isolated **Vercel Sandbox** microVM (the third runtime).

## Deliverables

- `sandbox/verify/` — Vercel Sandbox microVM image with a multi-version solc farm
- `lib/verify/recompile.ts` — recompile-and-diff engine (constructor args, CBOR auxdata, immutables, library linking)
- `lib/verify/proxy.ts` — proxy detection (EIP-1967 / EIP-1822 UUPS / Beacon)
- `app/api/verify/route.ts` (`POST`) + `app/api/verify/[guid]/route.ts` (`GET`)
- Etherscan-compatible verify actions: `verifysourcecode`, `checkverifystatus`, `verifyproxycontract` (under `/api/v1`, wired in S-6, contract here)
- `app/contract/[addr]/verify/` UI verify tab
- Populates `contract_verifications` in Neon
- (Stretch) Sourcify-compatible match metadata

## Test Baseline (start of sprint)

| Metric | Count | Captured | Canonical command |
|--------|-------|----------|-------------------|
| **Tests** | (S-3 close count) | at kickoff | `npx vitest run --reporter=json \| jq '.numTotalTests'` |
| **Formal specs** | (S-3 close count) | at kickoff | `find specs/tla -name '*.tla' \| wc -l` |
| **CI tripwires** | (S-3 close count) | at kickoff | `find .github/scripts/tripwires -type f \| wc -l` |
| **Frontmatter coverage** | (S-3 close fraction) | at kickoff | see `coverage/GATES.md` |

## Method

Per WP: BDD/Gherkin → failing test + tripwire → code → refactor → adversarial →
journal. The adversarial step here is load-bearing: every WP must reject a
tampered/near-miss source, not just accept a true one. Sandbox cutover runs as a
CEREMONY.

## Work Packages

### WP-4.1: Vercel Sandbox solc farm

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Estimated effort** | L |

**Scope:** `sandbox/verify/` — a Vercel Sandbox microVM that can fetch and run
any solc ≤ 0.8.26 (EVM target Cancun), compile submitted standard-JSON input, and
return artifacts. Bounded CPU/time; solc version allowlist; no network egress
beyond solc binary fetch. Does NOT do the diff (WP-4.2).

**Acceptance Criteria** *(Rule 11)*

- [ ] The sandbox compiles a known contract with a pinned solc version and returns deployed bytecode + metadata; output is byte-reproducible across two runs (data source = sandbox compile output).
- [ ] solc version + optimizer runs + evmVersion (Cancun) are taken from the submitted settings; an unsupported/blocklisted version is rejected with a clear error (data source = solc version manifest).
- [ ] Compilation is isolated: untrusted source cannot read host env/secrets or reach arbitrary network (data source = sandbox egress/fs policy test).
- [ ] A compile exceeding the time/CPU bound is killed and reported, not hung (data source = sandbox resource limits).

**Tests added:** `sandbox.compile.repro.test.ts`, `sandbox.version.allowlist.test.ts`, `sandbox.isolation.test.ts`, `sandbox.timeout.test.ts`.

---

### WP-4.2: Recompile-and-diff engine

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Estimated effort** | XL |

**Scope:** `lib/verify/recompile.ts` — compare sandbox-compiled deployed bytecode
against on-chain `eth_getCode`, accounting for: trailing constructor args,
**CBOR auxdata/metadata hash** tail, **immutables** (zeroed regions), and
**library linking** placeholders. Classify match as exact / match-modulo-metadata
/ no-match. Persist to `contract_verifications`. Does NOT handle proxies (WP-4.3).

**Acceptance Criteria** *(Rule 11)*

- [ ] A correct source for a real deployed contract on 40204 produces an exact (or modulo-metadata) match against `eth_getCode` (data source = live `eth_getCode` vs sandbox compile).
- [ ] A tampered source (one changed constant) produces **no-match** (data source = diff result) — adversarial: false source rejected.
- [ ] Immutable regions are masked before comparison; a contract with immutables verifies despite differing immutable bytes (data source = compiled immutable refs + on-chain code).
- [ ] Library-linked contracts verify after substituting the on-chain library addresses for placeholders (data source = link references + on-chain code).
- [ ] Constructor args are recovered/validated from the creation tx input tail (data source = creation tx from `transactions`/live RPC).
- [ ] A successful verification writes ABI + source + match level to `contract_verifications`, and the S-2 contract page then shows decoded everything (data source = `contract_verifications`).

**Tests added:** `verify.exact.live.test.ts`, `verify.tampered.reject.test.ts`, `verify.immutables.test.ts`, `verify.libs.test.ts`, `verify.ctorargs.live.test.ts`.

---

### WP-4.3: Proxy detection

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Estimated effort** | M |

**Scope:** `lib/verify/proxy.ts` — detect EIP-1967 (logic/admin/beacon slots),
EIP-1822 UUPS, and Beacon proxies by reading the well-known storage slots via
`eth_getStorageAt`; resolve the implementation address; link proxy↔implementation
in `contract_verifications`. Does NOT verify the implementation (that reuses
WP-4.2).

**Acceptance Criteria** *(Rule 11)*

- [ ] For an EIP-1967 proxy on 40204, the implementation address is read from slot `0x360894...bbc` via `eth_getStorageAt` and matches the actual logic contract (data source = live `eth_getStorageAt`).
- [ ] UUPS (EIP-1822) and Beacon proxies are each detected and their implementation resolved (data source = live storage slots).
- [ ] A non-proxy contract is correctly classified as non-proxy (data source = absence of proxy slots) — adversarial: no false proxy.
- [ ] The S-2 contract page shows "Proxy → Implementation" with the implementation's verified ABI used for read/decode (data source = `contract_verifications` link).

**Tests added:** `proxy.eip1967.live.test.ts`, `proxy.uups.live.test.ts`, `proxy.beacon.live.test.ts`, `proxy.nonproxy.test.ts`.

---

### WP-4.4: Etherscan-compatible verify API + UI tab

| Field | Value |
|-------|-------|
| **Status** | `[ ] NOT STARTED` |
| **Estimated effort** | M |

**Scope:** `POST /api/verify` + `GET /api/verify/[guid]` and the Etherscan-shaped
actions `verifysourcecode` / `checkverifystatus` / `verifyproxycontract` (response
shapes match Etherscan so existing tooling like hardhat-verify works); the
`/contract/[addr]/verify` UI tab (single-file, multi-part, standard-JSON input).
Async: submit returns a guid, poll for status. Does NOT include API-key gating
(S-6) — open submission for now, rate-limited.

**Acceptance Criteria** *(Rule 11)*

- [ ] `verifysourcecode` returns a guid; `checkverifystatus(guid)` polls to `Pass - Verified` for a correct source and `Fail` for a tampered one (data source = `contract_verifications` + sandbox result).
- [ ] Response JSON shape matches Etherscan's (`{ status, message, result }`) so `hardhat-verify` pointed at CitrateScan completes a verification end-to-end (data source = live integration against a real deploy).
- [ ] `verifyproxycontract` links a proxy to its implementation using WP-4.3 (data source = `contract_verifications`).
- [ ] UI verify tab submits all three input modes and surfaces the live status; on success the page flips to verified and shows source + ABI (data source = `/api/verify/[guid]`).
- [ ] Submission is rate-limited per IP; a flood is throttled (data source = rate-limiter state).

**Tests added:** `verify.api.guid.test.ts`, `verify.hardhat.live.test.ts`, `verify.proxy.api.test.ts`, `verify.ratelimit.test.ts`.

---

## Dependencies

| Dependency | Status | Impact if blocked |
|------------|--------|-------------------|
| D-Sandbox (Vercel Sandbox) | Provision in WP-4.1 | No isolated compile environment |
| S-1 `contracts` + creation tx data | Required | Constructor-arg + code source |
| S-2 contract page | Required | UI verify tab attaches to it |
| solc binaries ≤ 0.8.26 | Fetch in sandbox | Recompile impossible without them |

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Metadata/CBOR auxdata mismatch causes false no-match | High | Med | Match-modulo-metadata classification; strip/compare auxdata tail explicitly (WP-4.2) |
| Untrusted source abuses the sandbox | Med | Med | Vercel Sandbox isolation + version allowlist + resource bounds + rate limit (WP-4.1/4.4) |
| Immutables/libraries cause spurious diffs | High | Med | Mask immutables, substitute library addresses before diff (WP-4.2 AC) |
| Sandbox cost under load | Med | Med | Rate limit + S-6 per-key quotas; cache results in `contract_verifications` |

## Notes

The honesty bar: a verification that accepts a near-miss source is worse than no
verification. Every WP carries an adversarial reject criterion. Sandbox
provisioning + first production verify run as a CEREMONY
(`.agentile/ceremonies/`). Consider emitting Sourcify-compatible match metadata
so CitrateScan verifications interoperate.

## Definition of Done

- A user verifies a real 40204 contract by recompile-and-diff in the Vercel Sandbox; tampered source is rejected; immutables + libraries + constructor args handled (Rule 11, 0 mocks).
- Proxy detection resolves EIP-1967 / UUPS / Beacon implementations from live storage; non-proxies not misclassified.
- Etherscan-compatible verify API works end-to-end with `hardhat-verify`; results persist to `contract_verifications` and light up the S-2 contract page's decoded views.
- Submission is rate-limited; sandbox isolation verified.
- Four ratchets non-decreasing; sandbox cutover ceremony recorded; `RETRO.md` + journal committed; S-5 kicked off.
