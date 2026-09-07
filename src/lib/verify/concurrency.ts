/**
 * Global concurrent-compile gate for /api/verify (FWA-C12-04, second half).
 *
 * The verify route runs an expensive inline solc compile. A bare module-level
 * counter caps each serverless instance independently, so the true ceiling is
 * `cap × instanceCount`, not `cap`. This gate enforces the cap GLOBALLY by
 * counting in a shared store (Upstash Redis) when one is configured, and falls
 * back to a per-instance in-memory counter otherwise.
 *
 * Acquire = INCR; if the result exceeds the cap we immediately DECR and refuse,
 * so the counter is never left inflated by a rejected acquire. The shared key
 * carries a short TTL so a crashed instance that never releases can't wedge the
 * gate permanently.
 *
 * Fail posture: if the shared store is unreachable mid-flight the DEFAULT is to
 * degrade to the in-memory counter rather than 500 the request. EX-B-008 (RM-Q,
 * 2026-09-07): the verify path is expensive, so it constructs the gate with
 * `failClosed: true` — a store error then REFUSES the slot (the caller returns
 * 503) instead of silently dropping the GLOBAL compile cap to `cap × instances`,
 * which an attacker could trigger by griefing Redis to lift the cap fleet-wide.
 */

const ACTIVE_KEY = "verify:active";
const SLOT_TTL_SEC = 600; // self-heal a leaked slot after 10 min (> route maxDuration)

export interface CounterStore {
  incr(key: string): Promise<number>;
  decr(key: string): Promise<number>;
}

export interface AcquireResult {
  ok: boolean;
}

/** Upstash-REST counter store with a TTL self-heal on the active-compiles key. */
function redisStore(url: string, token: string): CounterStore {
  async function pipe(cmds: unknown[][]): Promise<Array<{ result?: number }>> {
    const res = await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(cmds),
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) throw new Error(`upstash ${res.status}`);
    return (await res.json()) as Array<{ result?: number }>;
  }
  return {
    async incr(key) {
      const body = await pipe([
        ["INCR", key],
        ["EXPIRE", key, SLOT_TTL_SEC],
      ]);
      const n = body?.[0]?.result;
      if (typeof n !== "number") throw new Error("upstash malformed incr");
      return n;
    },
    async decr(key) {
      const body = await pipe([["DECR", key]]);
      const n = body?.[0]?.result;
      if (typeof n !== "number") throw new Error("upstash malformed decr");
      return n;
    },
  };
}

export interface CompileGateOptions {
  /**
   * EX-B-008: when the shared store is configured but ERRORS, refuse the slot
   * (fail closed) rather than degrading to the per-instance counter — so a Redis
   * blip can't lift the GLOBAL compile cap to `cap × instances` fleet-wide.
   * Defaults to false to preserve the fail-open behaviour for any non-expensive
   * caller. The verify route sets this.
   */
  failClosed?: boolean;
}

/** Build the gate from env: a Redis store when configured, else per-instance. */
export function compileGateFromEnv(cap: number, opts: CompileGateOptions = {}): CompileGate {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return new CompileGate(cap, url && token ? redisStore(url, token) : null, opts);
}

export class CompileGate {
  private local = 0;
  readonly distributed: boolean;
  private readonly failClosed: boolean;

  constructor(
    private readonly cap: number,
    private readonly store: CounterStore | null,
    opts: CompileGateOptions = {},
  ) {
    this.distributed = Boolean(store);
    this.failClosed = Boolean(opts.failClosed);
  }

  /** Try to take a compile slot. Returns { ok:false } when the GLOBAL cap is hit. */
  async acquire(): Promise<AcquireResult> {
    if (this.store) {
      try {
        const n = await this.store.incr(ACTIVE_KEY);
        if (n > this.cap) {
          // Over the global cap — give the slot back and refuse.
          await this.store.decr(ACTIVE_KEY).catch(() => {});
          return { ok: false };
        }
        return { ok: true };
      } catch {
        // Store configured but unreachable.
        if (this.failClosed) {
          // Expensive path — refuse rather than drop the global cap to per-instance.
          return { ok: false };
        }
        // Degrade to the per-instance counter (never 500).
      }
    }
    if (this.local >= this.cap) return { ok: false };
    this.local += 1;
    return { ok: true };
  }

  /** Release a previously-held slot. Safe to call even if acquire failed/degraded. */
  async release(): Promise<void> {
    if (this.store) {
      try {
        await this.store.decr(ACTIVE_KEY);
        return;
      } catch {
        // fall through to the local counter
      }
    }
    this.local = Math.max(0, this.local - 1);
  }
}
