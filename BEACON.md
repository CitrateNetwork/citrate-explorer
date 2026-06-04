# CitratePulse — the AI-economy heartbeat (synthetic test traffic)

A tiny, **compliant** on-chain beacon that produces steady, realistic, easy-to-debug
traffic on Citrate so we can exercise the explorer (transactions, decoded events,
internal calls, native transfers) against a live, predictable signal.

## What it does
Once per block, the keeper bot calls `pulse()` on the `CitratePulse` contract. Each
pulse:
1. **Reads** the live `ModelRegistry` (`getAllModelHashes()`) — a real snapshot of
   the AI economy's size — best-effort (a miss never reverts the pulse).
2. **Rotates a "primitive spotlight"** across the chain's AI-native capabilities —
   `model → lora → inference → training → x402 → agent` — so every block highlights
   a different primitive, pointing at its real registry address.
3. **Emits** two cleanly-decodable events (`Pulse` + `PrimitiveProbe`) — perfect
   fodder for debugging the explorer's log decoding, tx pages, and address activity.
4. **Optionally tips** the keeper a little native SALT (gas reimbursement), which
   also generates a real value transfer each block.

## Why it's compliant
It is **instrumentation, not a product**: no token, no yield, no user deposits, no
third-party value flow, no financial mechanism. It only **reads public registries
and emits events**. The only value movement is the contract reimbursing *its own
keeper's* gas (standard relayer economics), and the `owner` can `withdraw` the
balance at any time. It's clearly a test/telemetry artifact.

## Pieces
- `contracts/src/CitratePulse.sol` — the contract (9 Foundry tests, all green).
- `contracts/script/DeployPulse.s.sol` — the deploy script.
- `scripts/beacon/run.ts` — the keeper bot (`pnpm beacon`): one `pulse()` per block,
  no overlapping in-flight txs, backs off on errors.

## Deploy + run (operator steps)

The dedicated keeper key lives in `.env.beacon` (gitignored). Its address:

```
KEEPER = 0xacA9CB582b800aeDf1992506C5758539a422ed6b
```

1. **Fund the keeper** with SALT (covers deploy gas + the contract's tip treasury +
   ongoing per-pulse gas). Suggested: 200–1000 SALT for a long run.
2. **Deploy** (seeds the contract's treasury and sets the tip):
   ```bash
   set -a; source .env.beacon; set +a
   PULSE_FUND_WEI=$(cast to-wei 100 ether) \
     forge script contracts/script/DeployPulse.s.sol --rpc-url citrate --broadcast
   # record the printed address:
   echo "PULSE_ADDRESS=0x<deployed>" >> .env.beacon
   ```
3. **Run the bot** (one pulse per block):
   ```bash
   set -a; source .env.beacon; set +a
   pnpm beacon
   ```
4. **Watch it in the explorer:** the keeper address and the contract will show a
   steady stream of `pulse()` txs with decoded `Pulse`/`PrimitiveProbe` events every
   block.

## Production home
The bot is always-on, like the indexer — run it on the **same DigitalOcean droplet**
(`INDEXER_DROPLET_HANDOFF.md`). Add a second container/systemd unit:
`pnpm beacon`, restart=always, with `.env.beacon` mounted as a `chmod 600` secret.

## Knobs
- `PULSE_TIP_WEI` (deploy/`setTip`) — native SALT reimbursed to the keeper per pulse.
- `BEACON_MIN_INTERVAL_MS` — floor between pulses (default: as fast as blocks arrive).
- `withdraw()` (owner) — pull the remaining treasury back any time.
