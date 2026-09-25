/**
 * PBA-L3c-016: what an error may say to an API caller.
 *
 * Upstream errors (viem, fetch, Postgres) embed internals: viem's messages carry
 * the full RPC URL, including the server-only CITRATE_RPC_FALLBACK node, plus
 * the request body. Those must stay in server logs. Only errors we raise on
 * purpose to explain a caller's own mistake are {@link PublicError}s, and only
 * their text is returned.
 */
import { log } from "./log";

/** An error whose message is written for the caller and is safe to return. */
export class PublicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicError";
  }
}

/**
 * The caller-safe message for `err`. A {@link PublicError}'s own text is
 * returned; anything else is logged server-side under `event` and replaced by
 * `fallback`.
 */
export function publicMessage(err: unknown, event: string, fallback = "upstream error; please retry"): string {
  if (err instanceof PublicError) return err.message;
  log.error(event, { error: err instanceof Error ? err.message : String(err) });
  return fallback;
}
