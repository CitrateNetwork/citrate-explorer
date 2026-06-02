import { createPublicClient, http, fallback, type PublicClient } from "viem";
import { citrate } from "@/lib/citrate/chain";

/** Per-attempt read timeout. */
export const HARNESS_TIMEOUT_MS = 9_000;

const PRIMARY =
  process.env.NEXT_PUBLIC_CITRATE_RPC_URL ?? "https://rpc.citrate.ai";
// Direct node address — used ONLY server-side (browser can't call http from an
// https page). Helps when the edge blips but the node is up, or vice versa.
const FALLBACK = process.env.CITRATE_RPC_FALLBACK ?? "http://142.93.58.145:8545";

/**
 * The harness's read-only client. No account, no signer — structurally incapable
 * of writing. A `fallback` transport tries the fronted domain first, then the
 * raw node. RPC host is fixed server-side config (no SSRF). SERVER-ONLY.
 */
export function harnessClient(): PublicClient {
  return createPublicClient({
    chain: citrate,
    transport: fallback(
      [
        http(PRIMARY, { retryCount: 2, retryDelay: 700, timeout: HARNESS_TIMEOUT_MS }),
        http(FALLBACK, { retryCount: 2, retryDelay: 700, timeout: HARNESS_TIMEOUT_MS }),
      ],
      { retryCount: 1, rank: false },
    ),
  });
}
