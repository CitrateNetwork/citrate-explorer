---
created: 2026-11-07T17:20:00Z
branch: feat/contract-pages
author: Claude Opus 5.5 (lane EXP-CONTRACT) for Larry Klosowski (owner)
sprint: r1007 EXP-S3
status: active
---

# Decompiler worker contract (EXP-S3)

The contract page's "Decompiled, not source" panel reads results from an **offline**
worker. Nothing decompiles in the browser or in a Vercel function. Until a worker is
deployed and `NEXT_PUBLIC_DECOMPILER_URL` is set, the panel says the decompiler is not
available. The client is `src/lib/contract/decompiler.ts`.

## Worker (for a later lane)

- Runs on the indexer host (not a producer), next to the verify worker.
- Tool: heimdall-rs (`heimdall decompile`), pinned version, run in a sandbox with a CPU
  and memory cap and a wall-clock timeout per job (suggest 60 s).
- Input: runtime bytecode read from our own follower node with `eth_getCode`. Never
  bytecode supplied by a client.
- Key: `(chainId, address, codeHash)` where `codeHash = keccak256(runtime code)`. A
  result is never served for a different code hash.
- Trigger: the indexer enqueues unverified contracts it sees created, plus on-demand
  requests (rate limited, deduplicated by code hash).
- Storage: append-only, one row per `(chainId, codeHash, decompiler version)`.

## Read endpoint the page calls

`GET {NEXT_PUBLIC_DECOMPILER_URL}/v1/decompiled/{chainId}/{address}?codeHash=0x…`

| Status | Meaning | Panel |
|---|---|---|
| 200 | result below | shows it, labeled "decompiled, not source" |
| 404 | not decompiled yet | "Not decompiled yet" |
| other | error | "Could not load" |

200 body (validated with zod; anything else is shown as an error):

```json
{
  "chainId": 40204,
  "address": "0x…40 hex",
  "codeHash": "0x…64 hex",
  "decompiler": { "name": "heimdall-rs", "version": "x.y.z" },
  "generatedAt": "2026-11-07T00:00:00Z",
  "source": "solidity-like text; names are guesses",
  "abi": []
}
```

The page rejects a result whose `chainId`, `address` or `codeHash` differs from the code
the address runs now. The endpoint origin must be added to the CSP `connect-src`
(`src/lib/security/csp.ts`) when it is configured.
