import { z } from "zod";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { citrate } from "@/lib/citrate/chain";
import { PROJECT_ADDRESSES } from "@/lib/citrate/addresses";
import { forwarderAbi } from "@/lib/citrate/abi";

/**
 * Gasless write relay (EIP-2771). The user signs an EIP-712 ForwardRequest in the
 * browser (no gas); this route verifies it against the deployed CitrateForwarder
 * and submits it via the Foundation relayer, which pays gas. Server-only — the
 * relayer key never leaves here.
 *
 * Returns 503 until the forwarder is deployed (NEXT_PUBLIC_FORWARDER_ADDRESS) and
 * the relayer is funded (RELAYER_PRIVATE_KEY) — see the P-4 deploy ceremony.
 *
 * Data source (Rule 11): on-chain `verify` then `execute` on the forwarder.
 */
const schema = z.object({
  request: z.object({
    from: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    to: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    value: z.string().regex(/^\d+$/),
    gas: z.string().regex(/^\d+$/),
    nonce: z.string().regex(/^\d+$/),
    deadline: z.number().int().nonnegative(),
    data: z.string().regex(/^0x[0-9a-fA-F]*$/),
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

  const forwarder = PROJECT_ADDRESSES.forwarder;
  const relayerKey = process.env.RELAYER_PRIVATE_KEY;
  if (!forwarder || !relayerKey) {
    return Response.json(
      {
        error: "gasless relay not provisioned",
        note: "Deploy CitrateForwarder (set NEXT_PUBLIC_FORWARDER_ADDRESS) and fund RELAYER_PRIVATE_KEY.",
      },
      { status: 503 },
    );
  }

  const { request, signature } = parsed.data;
  const reqTuple = {
    from: request.from as Address,
    to: request.to as Address,
    value: BigInt(request.value),
    gas: BigInt(request.gas),
    nonce: BigInt(request.nonce),
    deadline: request.deadline,
    data: request.data as Hex,
  };

  try {
    const publicClient = createPublicClient({ chain: citrate, transport: http() });

    // Pre-verify on-chain so we never spend relayer gas on an invalid/expired req.
    const ok = await publicClient.readContract({
      address: forwarder,
      abi: forwarderAbi,
      functionName: "verify",
      args: [reqTuple, signature as Hex],
    });
    if (!ok) {
      return Response.json(
        { error: "request failed on-chain verification (bad signature, nonce, or expired)" },
        { status: 400 },
      );
    }

    const account = privateKeyToAccount(relayerKey as Hex);
    const walletClient = createWalletClient({ account, chain: citrate, transport: http() });
    const txHash = await walletClient.writeContract({
      address: forwarder,
      abi: forwarderAbi,
      functionName: "execute",
      args: [reqTuple, signature as Hex],
      value: reqTuple.value,
    });

    return Response.json({ txHash, sponsored: true, forwarder });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
