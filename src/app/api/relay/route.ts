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
import { clientIp } from "@/lib/api/keys";
import { checkRelayQuota } from "@/lib/relay/rateLimit";
import { requireOwner } from "@/lib/auth/session";
import { checkSponsorPolicy } from "@/lib/relay/policy";
import { publicMessage } from "@/lib/api/errors";
import { checkSameOrigin } from "@/lib/security/sameOrigin";

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
  // PBA-L3c-018: cookie-authenticated mutation → same-origin only.
  const csrf = checkSameOrigin(req);
  if (csrf) return csrf;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "invalid ForwardRequest", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // PBA-L3c-011: the relayer spends real SALT, so sponsorship requires a
  // verified session. The subject (not the self-chosen `request.from`) is the
  // quota key below.
  const subject = await requireOwner(req);
  if (!subject) {
    return Response.json({ error: "sign in to use the gasless relay" }, { status: 401 });
  }

  // CIT-EXP-01 (RM-Q, 2026-09-06): fail-closed sponsorship policy, enforced
  // BEFORE any chain interaction and independently of provisioning. The relay
  // pays gas but must NEVER fund native value (a self-signed request with
  // `value = relayer balance` would otherwise drain the relayer in one call),
  // and may only sponsor calls into allowlisted federation contracts. The
  // on-chain twin `require(req.value == 0)` is HELD for the contract track.
  // PBA-L3c-011: the policy also caps `gas`.
  const policy = checkSponsorPolicy(parsed.data.request);
  if (!policy.ok) {
    return Response.json({ error: policy.error }, { status: 400 });
  }

  // SECREM-01 WEB-2 + PBA-L3c-011: hourly caps per verified subject, per `from`
  // and per client IP, BEFORE any chain interaction; shared across instances
  // (fail closed) when the store is configured. See src/lib/relay/rateLimit.ts.
  const rl = await checkRelayQuota(subject, parsed.data.request.from, clientIp(req));
  if (!rl.ok) {
    return Response.json(
      { error: `relay rate limit exceeded (per-${rl.scope ?? "client"} hourly cap)` },
      { status: 429, headers: { "retry-after": String(rl.retryAfter ?? 60) } },
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
    return Response.json({ error: publicMessage(err, "api.relay", "relay submission failed; please retry") }, { status: 502 });
  }
}
