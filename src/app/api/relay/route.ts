import { z } from "zod";
import { PROJECT_ADDRESSES } from "@/lib/citrate/addresses";

/**
 * Gasless write relay (EIP-2771). The user signs an EIP-712 ForwardRequest in
 * the browser (no gas); this route submits it via the Foundation relayer, which
 * pays gas through the CitrateForwarder. Full implementation lands in S-5 (needs
 * a deployed forwarder + funded relayer). We validate the request shape now and
 * fail loudly until the rail is provisioned (Rule 11: no silent fake success).
 */
const schema = z.object({
  request: z.object({
    from: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    to: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    value: z.string(),
    gas: z.string(),
    nonce: z.string(),
    data: z.string(),
  }),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "invalid ForwardRequest", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  if (!PROJECT_ADDRESSES.forwarder || !process.env.RELAYER_PRIVATE_KEY) {
    return Response.json(
      {
        error: "gasless relay not provisioned",
        note: "Set NEXT_PUBLIC_FORWARDER_ADDRESS + RELAYER_PRIVATE_KEY. Submission lands in S-5.",
      },
      { status: 503 },
    );
  }
  // S-5: verify signature, check forwarder nonce, submit via relayer wallet.
  return Response.json(
    { error: "relay submission lands in S-5", forwarder: PROJECT_ADDRESSES.forwarder },
    { status: 501 },
  );
}
