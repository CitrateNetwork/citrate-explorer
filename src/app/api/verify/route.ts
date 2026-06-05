import { z } from "zod";
import { submitVerification } from "@/lib/verify";
import type { Address } from "viem";

// Recompile-and-diff runs inline: loading the exact solc build + compiling can
// take tens of seconds, so give it room (Vercel Fluid).
export const maxDuration = 300;

const schema = z.object({
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  format: z
    .enum(["solidity-standard-json-input", "solidity-single-file", "metadata"])
    .default("solidity-standard-json-input"),
  compilerVersion: z.string(),
  source: z.string().min(1),
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
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "invalid request", issues: parsed.error.issues },
      { status: 400 },
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
  }
}
