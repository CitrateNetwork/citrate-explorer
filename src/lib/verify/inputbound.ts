/**
 * Untrusted-input bounding for the contract-verify compiler (FWA-C12-03).
 *
 * The verify route compiles attacker-supplied Solidity standard-JSON IN-PROCESS
 * (solc-js WASM in the Node serverless runtime). Until that compile moves into a
 * microVM (Vercel Sandbox — the deeper WS-2b hardening, tracked separately), the
 * realistic in-repo defense is to BOUND the input before it reaches solc so a
 * compile-bomb can't spike CPU/memory or hang the function:
 *
 *  - cap the NUMBER of source files (fan-out / import explosion),
 *  - cap the TOTAL source content bytes (megabyte blowups),
 *  - reject `urls`-based sources (would make solc fetch external files — an SSRF /
 *    outbound-fetch sink) and require inline `content`,
 *  - reject absurd optimizer `runs` (a pathological optimizer blowup),
 *  - require `language === "Solidity"` and a non-empty sources map.
 *
 * All bounds are env-overridable with fail-closed parsing (a malformed value
 * falls back to the conservative default — never to "unlimited").
 *
 * Pure + deterministic — unit-tested without solc.
 */

export class InputTooLarge extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputTooLarge";
  }
}

/** Fail-closed positive-int env parse (mirrors the relay limiter convention). */
function intEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return n;
}

export interface InputBounds {
  maxSources: number;
  maxContentBytes: number;
  maxOptimizerRuns: number;
}

export function inputBounds(): InputBounds {
  return {
    maxSources: intEnv(process.env.CITRATE_VERIFY_MAX_SOURCES, 64),
    maxContentBytes: intEnv(process.env.CITRATE_VERIFY_MAX_SOURCE, 2 * 1024 * 1024),
    // EVM optimizer runs is realistically in the hundreds–low-thousands; cap hard.
    maxOptimizerRuns: intEnv(process.env.CITRATE_VERIFY_MAX_OPT_RUNS, 1_000_000),
  };
}

interface StandardInput {
  language?: unknown;
  sources?: Record<string, { content?: unknown; urls?: unknown }>;
  settings?: { optimizer?: { runs?: unknown } };
}

/**
 * Validate + bound a Solidity standard-JSON input. Throws {@link InputTooLarge}
 * on any violation so the caller can return a 4xx WITHOUT invoking solc. Returns
 * the input unchanged on success (it is not mutated here).
 */
export function boundStandardInput(input: unknown): object {
  const b = inputBounds();
  const inp = input as StandardInput;

  if (!inp || typeof inp !== "object") {
    throw new InputTooLarge("input is not an object");
  }
  if (inp.language !== "Solidity") {
    throw new InputTooLarge(`unsupported language "${String(inp.language)}" (only Solidity is compiled)`);
  }
  const sources = inp.sources;
  if (!sources || typeof sources !== "object") {
    throw new InputTooLarge("input has no sources");
  }
  const names = Object.keys(sources);
  if (names.length === 0) {
    throw new InputTooLarge("input has an empty sources map");
  }
  if (names.length > b.maxSources) {
    throw new InputTooLarge(`too many source files (${names.length} > ${b.maxSources})`);
  }

  let totalBytes = 0;
  for (const name of names) {
    const src = sources[name];
    if (!src || typeof src !== "object") {
      throw new InputTooLarge(`source "${name}" is malformed`);
    }
    // Reject out-of-band fetch sources — only inline content is compiled.
    if ("urls" in src && src.urls != null) {
      throw new InputTooLarge(`source "${name}" uses urls (out-of-band fetch); inline content only`);
    }
    if (typeof src.content !== "string") {
      throw new InputTooLarge(`source "${name}" has no inline string content`);
    }
    totalBytes += Buffer.byteLength(src.content, "utf8");
    if (totalBytes > b.maxContentBytes) {
      throw new InputTooLarge(`total source content exceeds ${b.maxContentBytes} bytes`);
    }
  }

  const runs = inp.settings?.optimizer?.runs;
  if (runs != null) {
    if (typeof runs !== "number" || !Number.isFinite(runs) || runs < 0 || runs > b.maxOptimizerRuns) {
      throw new InputTooLarge(`optimizer runs out of range (0..${b.maxOptimizerRuns})`);
    }
  }

  return inp as object;
}
