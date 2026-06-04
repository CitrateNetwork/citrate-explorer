import { createPublicClient, http, fallback, type PublicClient } from "viem";
import { citrate } from "@/lib/citrate/chain";

/** Per-attempt read timeout. */
export const HARNESS_TIMEOUT_MS = 9_000;

const PRIMARY =
  process.env.NEXT_PUBLIC_CITRATE_RPC_URL ?? "https://rpc.citrate.ai";
// Optional direct-node fallback — used ONLY server-side (browser can't call http
// from an https page). Helps when the edge blips but the node is up. OPT-IN: set
// CITRATE_RPC_FALLBACK to a node URL to enable. We no longer hardcode a plaintext
// node IP (P-8 WP-8.1) — operators provide one explicitly, ideally over TLS.
const FALLBACK = process.env.CITRATE_RPC_FALLBACK;

const TRANSPORT_OPTS = { retryCount: 2, retryDelay: 700, timeout: HARNESS_TIMEOUT_MS };

/**
 * The harness's read-only client. No account, no signer — structurally incapable
 * of writing. With a configured fallback it tries the fronted domain first, then
 * the raw node. RPC host is fixed server-side config (no SSRF). SERVER-ONLY.
 */
export function harnessClient(): PublicClient {
  const transport = FALLBACK
    ? fallback([http(PRIMARY, TRANSPORT_OPTS), http(FALLBACK, TRANSPORT_OPTS)], {
        retryCount: 1,
        rank: false,
      })
    : http(PRIMARY, TRANSPORT_OPTS);
  return createPublicClient({ chain: citrate, transport });
}
