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
  const userAddress = auth.walletAddress ?? undefined;

  // Inference is the most expensive surface — bound it per user (or per IP when
  // anonymous in mock dev). 1 req/s sustained, small burst for rapid follow-ups.
  const rl = await checkRateLimit(`chat:${userAddress ?? clientIp(req)}`, 1, 5);
  if (!rl.ok) {
    return Response.json(
      { error: "Too many requests — slow down a moment." },
      { status: 429, headers: { "retry-after": String(rl.retryAfter ?? 1) } },
    );
  }

  const { messages }: { messages: UIMessage[] } = await req.json();

  let provider;
  try {
    provider = getInferenceProvider();
  } catch (err) {
    // Honest failure when inference isn't configured (Rule 11: no fake tokens).
    return Response.json({ error: (err as Error).message }, { status: 503 });
  }

  const historyTurns = Number(process.env.CITRATE_HISTORY_TURNS ?? 30);
  const maxOutputTokens = Number(process.env.CITRATE_MAX_OUTPUT_TOKENS ?? 4096);

  const result = streamText({
    model: provider.languageModel(),
    system: buildSystemPrompt(),
    messages: await convertToModelMessages(messages.slice(-historyTurns)),
    tools: citrateTools({ userAddress }),
    stopWhen: stepCountIs(8),
    maxOutputTokens,
    temperature: 0.3,
  });

  return result.toUIMessageStreamResponse();
}
