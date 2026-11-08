import {
  streamText,
  convertToModelMessages,
  stepCountIs,
  type UIMessage,
} from "ai";
import { getInferenceProvider } from "@/lib/ai/provider";
import { buildSystemPrompt } from "@/lib/ai/system-prompt";
import { citrateTools } from "@/lib/ai/tools";
import { verifySession } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/api/ratelimit";
import { clientIp } from "@/lib/api/keys";
import { createThread, createThreadWithId, ownsThread, appendMessage } from "@/lib/db/conversations";
import { checkSameOrigin } from "@/lib/security/sameOrigin";
import { writeGate, GATED_WRITE_TOOLS } from "@/lib/agent/writeIntent";
import { CITRATE_WRITE_CHAIN_ID, type AgentContext } from "@/lib/contracts/types";
import { z } from "zod";

/**
 * The page the user is on (EXP-REDESIGN's persistent "Ask" slot sends it).
 * Client input: validated, and only ever used to (a) tell the model what the
 * user is looking at and (b) name an address the write gate accepts as a target.
 */
const contextSchema = z
  .object({
    kind: z.enum(["home", "block", "tx", "address", "contract", "token", "agent", "dag", "verify", "other"]),
    id: z
      .string()
      .max(80)
      .regex(/^[0-9A-Za-z:_-]*$/)
      .optional(),
    network: z.object({ chainId: z.number().int(), name: z.string().max(40).optional() }),
  })
  .nullish();

function contextLine(ctx: AgentContext | null | undefined): string {
  if (!ctx || ctx.network.chainId !== CITRATE_WRITE_CHAIN_ID) return "";
  return `\n\nPage context: the user is viewing ${ctx.kind}${ctx.id ? ` ${ctx.id}` : ""} on Citrate (chain ${ctx.network.chainId}).`;
}

/** Plain text from an AI SDK UIMessage (concatenated text parts). */
function uiText(m: UIMessage | undefined): string {
  if (!m) return "";
  const parts = (m as { parts?: Array<{ type?: string; text?: string }> }).parts ?? [];
  return parts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("").trim();
}

// Long streamed responses (Vercel Fluid Compute). First/uncached inference on a
// CPU llama-server can be slow; multi-step tool loops add round-trips.
export const maxDuration = 300;

/**
 * "Ask CitrateScan" — the agentic chat endpoint. The model answers from on-chain
 * ground truth: it calls the read-only tools (src/lib/ai/tools.ts), then explains.
 * `stepCountIs(8)` lets it chain a few tool calls (e.g. resolve → fetch → explain)
 * before composing the final answer. No tool signs or sends: `prepare_write`
 * proposes a call, gated on the user's own request, and only the user executes
 * it by approving in the dialog and signing in their wallet (docs/AGENT.md).
 */
export async function POST(req: Request) {
  // PBA-L3c-018: cookie-authenticated mutation → same-origin only.
  const csrf = checkSameOrigin(req);
  if (csrf) return csrf;
  // Auth gate via the auth seam (OIDC RP). When an authority is configured the
  // session is required + JWKS-verified; in local/mock dev the gate is open and
  // the mock identity scopes the audit log. No provider-specific code here.
  const auth = await verifySession(req);
  if (auth.required && !auth.authenticated) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const owner = auth.sub ?? undefined;

  // Inference is the most expensive surface — bound it per user (or per IP when
  // anonymous in mock dev). 1 req/s sustained, small burst for rapid follow-ups.
  const rl = await checkRateLimit(`chat:${owner ?? clientIp(req)}`, 1, 5);
  if (!rl.ok) {
    return Response.json(
      { error: "Too many requests — slow down a moment." },
      { status: 429, headers: { "retry-after": String(rl.retryAfter ?? 1) } },
    );
  }

  const body: { messages: UIMessage[]; threadId?: string; context?: unknown } = await req.json();
  const { messages } = body;
  const ctxParsed = contextSchema.safeParse(body.context);
  const context: AgentContext | null = ctxParsed.success ? (ctxParsed.data ?? null) : null;

  let provider;
  try {
    provider = getInferenceProvider();
  } catch (err) {
    // FUA-EXPLORER-05: log the full reason server-side, but return a generic
    // message — the raw error can carry internal config (env names, gateway
    // URLs) we must not reflect to an unauthenticated caller.
    console.error("[api/chat] inference provider unavailable:", err);
    return Response.json({ error: "Inference is not available right now." }, { status: 503 });
  }

  // Per-user persistence (WS-4): when signed in + a DB is provisioned, keep the
  // conversation. Ensure/own a thread, then save the incoming user message; the
  // assistant's reply is saved on stream finish. Never blocks the chat on a DB
  // hiccup (best-effort).
  let threadId: string | null = null;
  const lastUser = uiText(messages[messages.length - 1]);
  if (owner) {
    const title = lastUser ? lastUser.slice(0, 80) : "New chat";
    try {
      if (body.threadId && (await ownsThread(owner, body.threadId))) {
        threadId = body.threadId; // already ours — continue it
      } else if (body.threadId) {
        // The SPA generated a stable id for this conversation — claim it (or fall
        // back to a server id if it's somehow taken by another user).
        threadId = (await createThreadWithId(owner, body.threadId, title)) ?? (await createThread(owner, title));
      } else {
        threadId = await createThread(owner, title);
      }
      if (threadId && lastUser) await appendMessage(owner, threadId, "user", lastUser);
    } catch {
      threadId = null; // persistence is best-effort; the chat still works
    }
  }

  // Context budget (RA-6). The gateway serves a SMALL-context model; the fixed
  // overhead (system prompt + tool schemas) plus history + tool results must leave
  // room to actually generate an answer. The old defaults (30 turns, 4096 output)
  // blew past ~4k and the model returned empty/errored. Keep these lean — and
  // env-tunable so a larger served context can relax them.
  const historyTurns = Number(process.env.CITRATE_HISTORY_TURNS ?? 6);
  const maxOutputTokens = Number(process.env.CITRATE_MAX_OUTPUT_TOKENS ?? 896);
  const maxSteps = Number(process.env.CITRATE_MAX_STEPS ?? 6);

  // EXP-AGENT write-intent gate: prepare_write is offered only when the USER'S
  // latest message asks for a write, for a target they named or are viewing.
  // Decided from user input alone, never from tool output (prompt injection).
  const gate = writeGate(lastUser, context);
  const tools = citrateTools({
    subject: owner,
    threadId,
    surface: "chat",
    gate,
    from: (auth.walletAddress as `0x${string}` | undefined) ?? null,
    rateKey: owner ?? `ip:${clientIp(req)}`,
  });
  const activeTools = (Object.keys(tools) as Array<keyof typeof tools>).filter(
    (n) => gate.allowed || !(GATED_WRITE_TOOLS as readonly string[]).includes(n),
  );

  const result = streamText({
    model: provider.languageModel(),
    system: buildSystemPrompt() + contextLine(context),
    messages: await convertToModelMessages(messages.slice(-historyTurns)),
    tools,
    activeTools,
    stopWhen: stepCountIs(maxSteps),
    maxOutputTokens,
    temperature: 0.3,
    onFinish: async ({ text }) => {
      if (owner && threadId && text) {
        try {
          await appendMessage(owner, threadId, "assistant", text);
        } catch {
          /* best-effort */
        }
      }
    },
  });

  // Surface the thread id so the client can track + resume the conversation.
  // onError (FUA-EXPLORER-05): log the FULL stream/upstream error server-side for
  // debugging, but return a generic, secret-free message to the client. Raw
  // upstream text (gateway errors, tool exceptions, URLs) must never be reflected
  // — the detail lives in the server logs.
  return result.toUIMessageStreamResponse({
    headers: threadId ? { "x-thread-id": threadId } : undefined,
    onError: (error) => {
      console.error("[api/chat] stream error:", error);
      return "The agent hit an error while processing this request. Please try again.";
    },
  });
}
