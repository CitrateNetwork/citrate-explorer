---
created: 2026-11-04T06:00:00Z
branch: feat/verification-v2
author: Larry Klosowski (owner) + Claude Opus 5.5 (EXP-VERIFY lane)
sprint: EXP-S2
status: active
---

# Verifying contracts on CitrateScan (chain 40204)

CitrateScan verifies Solidity source by recompiling it with the exact solc release
and comparing the result with the code on chain. Standard tools work unmodified
through two compatible APIs:

| API | Base URL | Used by |
|---|---|---|
| Etherscan-compatible | `https://explorer.citrate.ai/api` | `forge verify-contract --verifier custom`, hardhat-verify |
| Sourcify-compatible v2 | `https://explorer.citrate.ai/` (paths under `/v2/`) | `forge verify-contract --verifier sourcify` |
| Citrate JSON | `POST https://explorer.citrate.ai/api/verify` | Citrate Core post-deploy verify, scripts |

All three feed one queue and one store. Submissions return at once with an id; a
worker compiles in an isolated process and the tools poll for the result.

## Proven tool versions

These exact versions were run against this API, both live (anvil + real binaries,
`VERIFY_E2E_LIVE=1 pnpm vitest run src/lib/verify/tools.live.test.ts`) and as
recorded-request replays in CI (`src/lib/verify/tools.replay.test.ts`):

| Tool | Version | Mode |
|---|---|---|
| Foundry `forge` | 1.5.1-stable (commit b0a9dd9c, 2025-12-22) | `--verifier custom` (Etherscan protocol), `--verifier sourcify` |
| Hardhat | 2.29.1 | with `@nomicfoundation/hardhat-verify` 2.1.3, `etherscan.customChains` |

Re-record the fixtures after a tool upgrade: `pnpm verify:capture-fixtures --hardhat-dir <dir with hardhat + hardhat-verify installed>`.

## Foundry

### Etherscan protocol

```bash
forge verify-contract \
  --chain 40204 \
  --rpc-url https://rpc.citrate.ai \
  --verifier custom \
  --verifier-url https://explorer.citrate.ai/api \
  --verifier-api-key citrate \
  --watch \
  --constructor-args $(cast abi-encode "constructor(uint256,string)" 7 "hello") \
  --libraries src/Lib.sol:MyLib:0xYourLibraryAddress \
  0xYourContractAddress src/MyContract.sol:MyContract
```

- Use `--verifier custom`. With forge 1.5.1, `--verifier etherscan` stops before sending any
  request ("No known Etherscan API URL for chain `40204`"), because forge only knows Etherscan
  URLs for chains in its own list. `custom` speaks the same Etherscan protocol.
- `--verifier-api-key` must be present; any value works. Verification needs no API key.
- `--constructor-args` is optional: the arguments are read from the creation transaction. If you
  pass them and they differ, the transaction's are recorded.

### Sourcify protocol

```bash
forge verify-contract \
  --chain 40204 \
  --rpc-url https://rpc.citrate.ai \
  --verifier sourcify \
  --verifier-url https://explorer.citrate.ai/ \
  --watch \
  0xYourContractAddress src/MyContract.sol:MyContract
```

Keep the trailing slash on `--verifier-url`. forge appends `v2/...` to it.

### At deploy time

```bash
forge create src/MyContract.sol:MyContract --rpc-url https://rpc.citrate.ai --broadcast \
  --verify --verifier custom --verifier-url https://explorer.citrate.ai/api --verifier-api-key citrate \
  --constructor-args 7 "hello"
```

`forge script ... --broadcast --verify` takes the same `--verifier*` flags. (These deploy-time
forms use the same requests as `forge verify-contract` but were not part of the proven runs.)

## Hardhat (hardhat-verify)

```js
// hardhat.config.js
require("@nomicfoundation/hardhat-verify");

module.exports = {
  solidity: { version: "0.8.26", settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" } },
  networks: {
    citrate: { url: "https://rpc.citrate.ai", chainId: 40204 },
  },
  etherscan: {
    // A per-network key object. Any value works; verification needs no key.
    apiKey: { citrate: "citrate" },
    customChains: [
      {
        network: "citrate",
        chainId: 40204,
        urls: { apiURL: "https://explorer.citrate.ai/api", browserURL: "https://explorer.citrate.ai" },
      },
    ],
  },
  sourcify: { enabled: false },
};
```

```bash
npx hardhat verify --network citrate 0xYourContractAddress 7 "hello"
# with libraries:
npx hardhat verify --network citrate --libraries libraries.js 0xYourContractAddress 7 "hello"
```

- Use the per-network `apiKey` object, as above. With hardhat-verify 2.1.3 a single string
  `apiKey` switches it to Etherscan's v2 mode, which ignores `customChains` and sends the request to
  api.etherscan.io instead.
- hardhat-verify prints a warning that per-network keys are deprecated. It applies to
  etherscan.io, not to this API.

## Citrate CLI and scripts

`citrate contract verify` currently calls the node's operator-only method. Switching it to this
API is a separate change in citrate-chain (tracked under EXP-S2, CLI/SDK lane). Until then, use forge or
hardhat, or call the APIs directly:

```bash
# Etherscan protocol: submit, then poll the guid.
GUID=$(curl -s https://explorer.citrate.ai/api \
  --data-urlencode module=contract --data-urlencode action=verifysourcecode \
  --data-urlencode contractaddress=0xYourContractAddress \
  --data-urlencode codeformat=solidity-standard-json-input \
  --data-urlencode contractname=src/MyContract.sol:MyContract \
  --data-urlencode compilerversion=v0.8.26+commit.8a97fa7a \
  --data-urlencode sourceCode@out/standard-input.json | jq -r .result)
curl -s "https://explorer.citrate.ai/api?module=contract&action=checkverifystatus&guid=$GUID"

# Citrate JSON (waits up to ~20 s for the verdict, else answers 202 with the guid).
curl -s https://explorer.citrate.ai/api/verify -H 'content-type: application/json' -d @- <<'JSON'
{ "address": "0xYourContractAddress", "format": "solidity-standard-json-input",
  "compilerVersion": "v0.8.26+commit.8a97fa7a", "contractName": "src/MyContract.sol:MyContract",
  "source": "<the standard JSON input, as a string>" }
JSON
```

Get the standard JSON input forge used with
`forge verify-contract --show-standard-json-input <address> <path:Name>`.

## API reference

### Etherscan-compatible: `GET|POST /api?module=contract&action=…`

Every answer is Etherscan's envelope `{"status": "1"|"0", "message": "OK"|"NOTOK", "result": …}`.
Submissions are form-encoded POSTs. An Etherscan v2 `chainid` parameter is accepted when it is
`40204`. Other modules (`account`, `proxy`, ...) are the existing read API, also served at `/api/v1`.

| action | params | result |
|---|---|---|
| `verifysourcecode` (POST) | `contractaddress`, `sourceCode`, `codeformat` (`solidity-standard-json-input` or `solidity-single-file`), `contractname`, `compilerversion`, `constructorArguements` or `constructorArguments` (optional), single-file only: `optimizationUsed`, `runs`, `evmversion`, `libraryname1..10` / `libraryaddress1..10`; optional `creationtxhash` | the guid |
| `checkverifystatus` | `guid` | `Pending in queue` (status 0), `Pass - Verified` (status 1), `Fail - Unable to verify` (status 0) |
| `getabi` | `address` | the ABI as a JSON string, or `Contract source code not verified` |
| `getsourcecode` | `address` | one entry in Etherscan's shape: `SourceCode` (standard JSON is wrapped in `{{…}}`), `ABI`, `ContractName`, `CompilerVersion`, `OptimizationUsed`, `Runs`, `ConstructorArguments`, `EVMVersion`, `Library`, `LicenseType`, `Proxy`, `Implementation`, `SimilarMatch`, `ContractFileName` |
| `getcontractcreation` | `contractaddresses` (1 to 5, comma-separated) | `contractAddress`, `contractCreator`, `txHash`, `blockNumber`, `timestamp`, `creationBytecode` |
| `verifyproxycontract` (POST) | `address`, optional `expectedimplementation` | the guid |
| `checkproxyverification` | `guid` | `The proxy's (…) implementation contract is found at … and is successfully updated.` or the reason it was not |

Refusals at submission use Etherscan's strings: `Contract source code already verified`,
`Unable to locate ContractCode at 0x…`, `Max rate limit reached`.

### Sourcify-compatible v2

| Method and path | Body / query | Answer |
|---|---|---|
| `POST /v2/verify/40204/{address}` | `{stdJsonInput, compilerVersion, contractIdentifier, creationTransactionHash?}` | `202 {verificationId}` |
| `POST /v2/verify/metadata/40204/{address}` | `{metadata, sources: {path: content}, creationTransactionHash?}` | `202 {verificationId}` |
| `GET /v2/verify/{verificationId}` | | `{isJobCompleted, verificationId, jobStartTime, jobFinishTime?, contract: {match, creationMatch, runtimeMatch, chainId, address, verifiedAt, matchId}, error?}` |
| `GET /v2/contract/40204/{address}` | `?fields=all` or a list of `abi, metadata, sources, compilation, deployment, storageLayout, stdJsonInput, runtimeBytecode, creationBytecode, libraries, proxyResolution` | the match summary plus the fields asked for |

Errors are `{customCode, message, errorId}`: `unsupported_chain`, `invalid_parameter`,
`contract_not_deployed`, `already_verified` (409), `not_found` (404), `job_not_found` (404),
`too_many_requests` (429). `full` maps to `exact_match`, `partial` to `match`.

## What a match means

- **Runtime match.** The compiled runtime is compared with `eth_getCode` after linking libraries
  from the on-chain bytes, masking immutables (solc's `immutableReferences`) and, for a library,
  zeroing its own address in the call-protection prefix.
  - **full**: identical, including the CBOR metadata hash. Only this earns the verified badge.
  - **partial**: identical once the trailing metadata is stripped. Same code, but the metadata
    (which commits to the exact source and settings) differs, so the source shown may differ from
    what was compiled. Labeled "partial match", never "verified".
- **Creation match.** The creation transaction (named in the request, else found by the indexer)
  must be the compiled init code followed by the constructor arguments. The arguments stored are the
  ones read from the transaction. Factory-created contracts have no creation transaction of their
  own in the index yet, so their creation match stays unchecked.
- **Similar match.** When a contract is verified, other indexed contracts whose runtime is identical
  (immutables masked) get a record pointing at it, labeled "similar match".
- **Libraries.** Placeholders are resolved from the chain. Hardhat deploys code compiled without
  `settings.libraries` and links afterwards, but submits the input with them; when that input
  matches only partially, the worker also compiles it without them and keeps a full match.
- **Records are append-only** and keyed by the chain's genesis hash, the address and the runtime
  code hash. A later submission adds a record; it never replaces one. The best record is shown:
  full before partial before similar, creation full before partial before unchecked, earliest first.
  After a reroll or a code change at an address, earlier records no longer apply.

## Limits

- Source: 2 MiB, at most 64 files, inline content only (no `urls`).
- Compile: 120 s and 2048 MB per job, in a separate process (`CITRATE_VERIFY_COMPILE_*`).
- Compiler: official solc releases only, resolved through `list.json` and checked against its
  keccak256 before use.
- Rate: 1 submission per 5 s per IP (burst 5); reads share the public read budget.
- Queue: at most `CITRATE_VERIFY_MAX_PENDING` (200) open jobs.
- Partial matching tolerates only the trailing metadata blob. A contract that embeds another
  contract's creation code (`new X()`) with a different metadata hash matches only fully.
