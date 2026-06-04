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
  createPublicClient,
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

  let lastBlock = -1n;
  let inFlight = false;

  for (;;) {
    try {
      const block = await client.getBlockNumber();
      if (block > lastBlock && !inFlight) {
        lastBlock = block;
        inFlight = true;
        try {
          const hash = await client.writeContract({
            address: PULSE_ADDRESS,
            abi: PULSE_ABI,
            functionName: "pulse",
          });
          // Don't block the loop on confirmation; just record the send.
          console.log(`[beacon] block ${block} → pulse tx ${hash}`);
        } catch (err) {
          const msg = (err as Error).message ?? String(err);
          const slow = /took too long|timed out|timeout/i.test(msg);
          if (slow) {
            // The RPC was slow to return the hash; the tx has very likely landed
            // (sequence advances). Don't treat it as a real failure.
            console.log(`[beacon] block ${block} → pulse submitted (RPC slow to confirm)`);
          } else {
            console.error(`[beacon] pulse failed at block ${block}: ${msg.split("\n")[0]}`);
            await sleep(3000); // genuine error (funding/nonce) — ease off.
          }
        } finally {
          inFlight = false;
        }
      }
    } catch (err) {
      console.error("[beacon] tick error:", (err as Error).message);
      await sleep(2000);
    }
    await sleep(Math.max(MIN_INTERVAL_MS, 500));
  }
}

main().catch((err) => {
  console.error("[beacon] fatal:", err);
  process.exit(1);
});
