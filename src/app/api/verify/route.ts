import { z } from "zod";
import { submitVerification } from "@/lib/verify";
import { clientIp } from "@/lib/api/keys";
import { checkRateLimit } from "@/lib/api/ratelimit";
import { compileGateFromEnv } from "@/lib/verify/concurrency";
import type { Address } from "viem";

// Recompile-and-diff runs inline: loading the exact solc build + compiling can
// take tens of seconds, so give it room (Vercel Fluid).
export const maxDuration = 300;

// FUA-EXPLORER-03 / FWA-C12-03/04: /api/verify is unauthenticated and each call
// fetches an arbitrary solc build and compiles attacker-supplied source inline —
// an unbounded CPU/memory/outbound-fetch sink. Bound it: per-IP rate limit keyed
// on a TRUSTED hop (clientIp, FWA-C12-04), a source-size cap, an input-shape cap
// (engine buildInput, FWA-C12-03), and a GLOBAL concurrent-compile cap enforced
// in the shared store (compileGate, FWA-C12-04). Moving the compile into a Vercel
// Sandbox microVM is the deeper WS-2b hardening, tracked separately (FWA-C12-03).
const MAX_SOURCE_CHARS = Number(process.env.CITRATE_VERIFY_MAX_SOURCE ?? 2 * 1024 * 1024);
const MAX_CONCURRENT_COMPILES = Number(process.env.CITRATE_VERIFY_MAX_CONCURRENT ?? 3);
// FWA-C12-04: the concurrent-compile cap must be GLOBAL, not per-instance. The
// gate counts in the shared store (Upstash) when configured so the cap holds
// across the whole serverless fleet, falling back to a per-instance counter only
// when no store is provisioned (dev / single-instance).
// EX-B-008: /api/verify is the expensive path — a store blip must NOT silently
// drop the global compile cap to per-instance. Fail closed on store errors.
const compileGate = compileGateFromEnv(MAX_CONCURRENT_COMPILES, { failClosed: true });

const schema = z.object({
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  format: z
    .enum(["solidity-standard-json-input", "solidity-single-file", "metadata"])
    .default("solidity-standard-json-input"),
  compilerVersion: z.string(),
  source: z.string().min(1).max(MAX_SOURCE_CHARS),
  constructorArguments: z.string().optional(),
  optimizationRuns: z.number().int().optional(),
  evmVersion: z.string().optional(),
});

/**
 * Verify a contract by recompiling its source and diffing the bytecode against
 * the on-chain code. Runs the engine inline and returns the verdict
 * (pass/fail + full/partial match). The result is persisted; poll
 * GET /api/verify/{guid} or read it on the contract page.
 */
export async function POST(req: Request) {
  // FUA-EXPLORER-03: rate-limit per trusted IP before any expensive work.
  // EX-B-008: fail closed on store errors — this is the expensive path.
  const rl = await checkRateLimit(`verify:${clientIp(req)}`, 0.2, 5, { failClosed: true });
  if (!rl.ok) {
    return Response.json(
      { error: "rate limited — verification is expensive; try again shortly" },
      { status: 429, headers: { "retry-after": String(rl.retryAfter ?? 10) } },
    );
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "invalid request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // FUA-EXPLORER-03 / FWA-C12-04: cap concurrent inline compiles GLOBALLY (shared
  // store when configured) so a burst can't exhaust CPU/memory across the fleet.
  const slot = await compileGate.acquire();
  if (!slot.ok) {
    return Response.json(
      { error: "verifier busy — too many concurrent compiles; retry shortly" },
      { status: 503, headers: { "retry-after": "5" } },
    );
  }
  try {
    const result = await submitVerification({
      ...parsed.data,
      address: parsed.data.address as Address,
    });
    return Response.json(result, { status: result.status === "pass" ? 200 : 422 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  } finally {
    await compileGate.release();
  }
}
