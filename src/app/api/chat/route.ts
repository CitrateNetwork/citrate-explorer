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
 * before composing the final answer. READ-ONLY: there is no write/sign tool.
 */
export async function POST(req: Request) {
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

  const body: { messages: UIMessage[]; threadId?: string } = await req.json();
  const { messages } = body;

  let provider;
  try {
    provider = getInferenceProvider();
  } catch (err) {
    // Honest failure when inference isn't configured (Rule 11: no fake tokens).
    return Response.json({ error: (err as Error).message }, { status: 503 });
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

  const result = streamText({
    model: provider.languageModel(),
    system: buildSystemPrompt(),
    messages: await convertToModelMessages(messages.slice(-historyTurns)),
    tools: citrateTools({ subject: owner }),
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
  // onError: the AI SDK masks stream errors by default ("An error occurred"),
  // which hid the real cause (a failing tool call, gateway hiccup, etc.) behind
  // a generic message. Log the full error server-side and return a concise,
  // secret-free reason to the client so the agent can say WHY it failed.
  return result.toUIMessageStreamResponse({
    headers: threadId ? { "x-thread-id": threadId } : undefined,
    onError: (error) => {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("[api/chat] stream error:", msg, error);
      return msg ? `Agent error: ${msg.slice(0, 400)}` : "Agent error (unknown).";
    },
  });
}
