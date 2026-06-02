import { z } from "zod";
import { submitVerification } from "@/lib/verify";
import type { Address } from "viem";

const schema = z.object({
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  format: z
    .enum(["solidity-standard-json-input", "solidity-single-file", "metadata"])
    .default("solidity-standard-json-input"),
  compilerVersion: z.string(),
  source: z.string().min(1),
  constructorArguments: z.string().optional(),
  optimizationRuns: z.number().int().optional(),
});

/** Submit a contract for verification. Returns a guid to poll (engine in S-4). */
export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "invalid request", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const result = await submitVerification({
    ...parsed.data,
    address: parsed.data.address as Address,
  });
  return Response.json(result, { status: 202 });
}
