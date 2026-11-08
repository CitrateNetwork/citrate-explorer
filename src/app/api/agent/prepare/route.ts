import { z } from "zod";
import { verifySession } from "@/lib/auth/session";
import { publicMessage } from "@/lib/api/errors";
import { defaultContractModule } from "@/lib/agent/contractModule";
import { explainPreparedWrite } from "@/lib/agent/explain";
import { allowPrepare, requestIdentity } from "@/lib/agent/limits";
import { approvalRequestSchema } from "@/lib/agent/deepLink";
import { logWriteEvent, writeEventFrom } from "@/lib/agent/writeLog";
import type { Address } from "@/lib/contracts/types";
import { checkSameOrigin } from "@/lib/security/sameOrigin";

/**
 * POST /api/agent/prepare — (re)prepare a contract write for the approval dialog.
 *
 * The dialog calls this whenever it opens (from a chat card or an MCP approval
 * link) and after every edit, with the CONNECTED wallet as `from`, so what the
 * user approves was simulated from their own address at the current head. It
 * returns a PreparedWrite (executable: false) and its deterministic
 * explanation. It never signs, sends or relays anything; there is no signer on
 * the server path it uses.
 *
 * Data source (Rule 11): eth_getCode, eth_getStorageAt, eth_call,
 * eth_estimateGas, eth_gasPrice on live RPC (read-only harness client), the
 * verification store, and the relay sponsor policy.
 *
 * Gates: the API-key scheme and per-identity budget shared with the
 * `prepare_write` tool (src/lib/agent/limits.ts). Same-origin only: the
 * optional history line is a cookie-authenticated write, made only for a
 * verified session into a thread it owns.
 */
const bodySchema = approvalRequestSchema.extend({
  v: z.literal(1).default(1),
  from: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .nullish(),
  threadId: z.string().max(80).nullish(),
  /** "edited" when the user changed the call in the dialog (logged to history). */
  reason: z.enum(["open", "edited", "refresh"]).default("open"),
});

export async function POST(req: Request) {
  const csrf = checkSameOrigin(req);
  if (csrf) return csrf;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid request", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 400 });
  }
  const b = parsed.data;

  const auth = await verifySession(req);
  if (auth.required && !auth.authenticated) return Response.json({ error: "unauthorized" }, { status: 401 });
  const subject = auth.sub ?? null;

  const who = await requestIdentity(req, subject);
  if (!who.ok) return Response.json({ error: who.error }, { status: who.status, headers: { "retry-after": String(who.retryAfter ?? 1) } });
  const budget = await allowPrepare(who.key);
  if (!budget.ok) return Response.json({ error: "too many preparations; wait a moment" }, { status: 429, headers: { "retry-after": String(budget.retryAfter ?? 2) } });

  try {
    const m = await defaultContractModule();
    const prepared = await m.prepareWrite({
      address: b.address as Address,
      function: b.function,
      args: b.args,
      value: b.value,
      from: (b.from as Address | null | undefined) ?? null,
      origin: b.origin,
    });
    let threadId: string | null = null;
    if (subject && auth.authenticated && b.reason !== "refresh") {
      try {
        threadId = await logWriteEvent(subject, b.threadId ?? null, writeEventFrom(b.reason === "edited" ? "edited" : "prepared", prepared));
      } catch {
        threadId = null; // history is best-effort
      }
    }
    return Response.json({ prepared, explanation: explainPreparedWrite(prepared), threadId });
  } catch (err) {
    return Response.json({ error: publicMessage(err, "api.agent.prepare", "could not prepare this call; please retry") }, { status: 422 });
  }
}
