import { z } from "zod";
import { verifySession } from "@/lib/auth/session";
import { checkSameOrigin } from "@/lib/security/sameOrigin";
import { allowWriteEvent } from "@/lib/agent/limits";
import { confirmOnChain, logWriteEvent, writeEventSchema } from "@/lib/agent/writeLog";
import { getTransaction } from "@/lib/harness/ops";

/**
 * POST /api/agent/write-events — record what the user did with a prepared write
 * (approved, rejected, submitted, executed, failed) in their thread history.
 *
 * For an event that carries a tx hash, the outcome is read back from the chain
 * rather than trusted from the client: the receipt status, and whether the
 * transaction's target matches the event's. Data source (Rule 11): `threads` +
 * `messages` (sealed per user), eth_getTransactionByHash + receipt.
 *
 * Gates: same-origin, verified session (401 otherwise), per-owner budget.
 */
const bodySchema = z.object({
  threadId: z.string().max(80).nullish(),
  event: writeEventSchema.refine((e) => e.kind !== "prepared", { message: "prepared events are written by the server" }),
});

export async function POST(req: Request) {
  const csrf = checkSameOrigin(req);
  if (csrf) return csrf;
  const auth = await verifySession(req);
  if (auth.required && !auth.authenticated) return Response.json({ error: "unauthorized" }, { status: 401 });
  const owner = auth.sub ?? null;
  if (!owner) return Response.json({ error: "sign in to keep a transaction history" }, { status: 401 });
  if (!(await allowWriteEvent(owner))) return Response.json({ error: "rate limit exceeded" }, { status: 429, headers: { "retry-after": "1" } });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid write event", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 400 });
  }
  const event = await confirmOnChain(parsed.data.event, { getTransaction: (h) => getTransaction(h) });
  try {
    const threadId = await logWriteEvent(owner, parsed.data.threadId ?? null, event);
    return Response.json({ ok: threadId !== null, threadId, event });
  } catch {
    return Response.json({ error: "could not save to history" }, { status: 503 });
  }
}
