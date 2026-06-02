import {
  streamText,
  convertToModelMessages,
  stepCountIs,
  type UIMessage,
} from "ai";
import { getInferenceProvider } from "@/lib/ai/provider";
import { buildSystemPrompt } from "@/lib/ai/system-prompt";
import { citrateTools } from "@/lib/ai/tools";

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
    tools: citrateTools(),
    stopWhen: stepCountIs(8),
    maxOutputTokens,
    temperature: 0.3,
  });

  return result.toUIMessageStreamResponse();
}
