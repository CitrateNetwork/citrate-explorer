/**
 * CitratePulse keeper bot.
 *
 * Drives the on-chain heartbeat: on every new Citrate block it sends one
 * `pulse()` transaction to the deployed CitratePulse contract, producing steady,
 * realistic, easy-to-debug traffic (a tx + decoded events + an optional native
 * SALT tip back to this keeper). Deploy alongside the indexer (always-on host).
 *
 * Env:
 *   KEEPER_PRIVATE_KEY   0x… the funded keeper EOA (the only allowed caller)
 *   PULSE_ADDRESS        0x… the deployed CitratePulse contract
 *   NEXT_PUBLIC_CITRATE_RPC_URL  (default https://rpc.citrate.ai)
 *   BEACON_MIN_INTERVAL_MS  floor between pulses (default 0 — one per block)
 *
 * Safe by construction: read-only to the chain except the single keeper-only
 * `pulse()` call; never overlaps in-flight txs; backs off on errors (e.g. a
 * funding dip) instead of hot-looping.
 */
import {
  createWalletClient,
  http,
  publicActions,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { citrate } from "@/lib/citrate/chain";

const RPC = process.env.NEXT_PUBLIC_CITRATE_RPC_URL ?? "https://rpc.citrate.ai";
const PULSE_ADDRESS = process.env.PULSE_ADDRESS as `0x${string}` | undefined;
const KEY = process.env.KEEPER_PRIVATE_KEY as Hex | undefined;
const MIN_INTERVAL_MS = Number(process.env.BEACON_MIN_INTERVAL_MS ?? 0);

const PULSE_ABI = [
  { type: "function", name: "pulse", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "sequence", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!KEY) throw new Error("KEEPER_PRIVATE_KEY is required");
  if (!PULSE_ADDRESS) throw new Error("PULSE_ADDRESS is required");

  const account = privateKeyToAccount(KEY);
  // Citrate's RPC can be slow to return the hash on writes even though the tx
  // lands — give it room so we don't false-flag a landed pulse as failed.
  const client = createWalletClient({
    account,
    chain: citrate,
    transport: http(RPC, { timeout: 25_000, retryCount: 1 }),
  }).extend(publicActions);

  console.log(`[beacon] keeper=${account.address} pulse=${PULSE_ADDRESS} rpc=${RPC}`);
  const seq0 = await client.readContract({ address: PULSE_ADDRESS, abi: PULSE_ABI, functionName: "sequence" });
  console.log(`[beacon] starting at sequence ${seq0}`);

  // The RPC is slow to RETURN a write (it often takes >10s to hand back the hash
  // even though the tx lands). Waiting per-tx would throttle us to ~1 pulse per
  // 10-20s — too sparse to see. So we PIPELINE: manage the nonce locally and keep
  // up to MAX_PENDING txs in flight, one per block, never blocking on the response.
  const MAX_PENDING = Number(process.env.BEACON_MAX_PENDING ?? 10);
  let nonce = await client.getTransactionCount({ address: account.address, blockTag: "pending" });
  let pending = 0;
  let lastBlock = -1n;

  const fire = (block: bigint) => {
    const myNonce = nonce++;
    pending++;
    client
      .writeContract({ address: PULSE_ADDRESS, abi: PULSE_ABI, functionName: "pulse", nonce: myNonce })
      .then((hash) => console.log(`[beacon] block ${block} nonce ${myNonce} → ${hash}`))
      .catch((err) => {
        const msg = ((err as Error).message ?? String(err)).split("\n")[0];
        if (/took too long|timed out|timeout/i.test(msg)) {
          // Slow response, but the tx almost certainly landed (nonce consumed).
          console.log(`[beacon] block ${block} nonce ${myNonce} → submitted (slow RPC)`);
        } else {
          console.error(`[beacon] nonce ${myNonce} failed: ${msg}`);
        }
      })
      .finally(() => {
        pending--;
      });
  };

  for (;;) {
    try {
      const block = await client.getBlockNumber();
      if (block > lastBlock && pending < MAX_PENDING) {
        lastBlock = block;
        fire(block);
      }
      // When the pipeline drains, resync the nonce from chain to heal any gap
      // (e.g. a dropped broadcast) so we never get stuck behind a missing nonce.
      if (pending === 0) {
        const onchain = await client.getTransactionCount({ address: account.address, blockTag: "pending" });
        if (onchain > nonce) nonce = onchain;
      }
    } catch (err) {
      console.error("[beacon] tick error:", (err as Error).message);
      await sleep(1500);
    }
    await sleep(Math.max(MIN_INTERVAL_MS, 400));
  }
}

main().catch((err) => {
  console.error("[beacon] fatal:", err);
  process.exit(1);
});
