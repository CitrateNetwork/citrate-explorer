/**
 * Headless driver for POST /api/chat (RA-1 WP-1.2).
 *
 * Drives the live agent the way the browser does (the AI SDK v6 UI message stream)
 * and extracts what the scorers need: the final answer text, the ordered tool calls,
 * the step count, and latency. The wire parser is factored out as a pure function so
 * it is unit-tested without a network.
 */

export interface ToolCallObserved {
  name: string;
  toolCallId?: string;
  input?: unknown;
}

export interface ChatRunResult {
  answerText: string;
  toolCalls: ToolCallObserved[];
  steps: number;
  latencyMs: number;
  httpStatus: number;
  /** Raw stream kept for debugging a failed scrape; truncated by the caller if large. */
  raw?: string;
}

interface ParsedStream {
  answerText: string;
  toolCalls: ToolCallObserved[];
  steps: number;
}

/**
 * Parse an AI SDK v6 UI message stream (SSE: `data: {chunk}` lines) into the fields
 * the harness scores. Tolerant of `event:`/`id:` lines, blank lines, and `[DONE]`.
 */
export function parseUiMessageStream(sse: string): ParsedStream {
  let answerText = "";
  const toolCalls: ToolCallObserved[] = [];
  let steps = 0;

  for (const rawLine of sse.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    let chunk: Record<string, unknown>;
    try {
      chunk = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      continue; // ignore unparseable keep-alive/comment frames
    }
    switch (chunk.type) {
      case "text-delta":
        if (typeof chunk.delta === "string") answerText += chunk.delta;
        break;
      case "tool-input-available":
        if (typeof chunk.toolName === "string") {
          toolCalls.push({
            name: chunk.toolName,
            toolCallId: typeof chunk.toolCallId === "string" ? chunk.toolCallId : undefined,
            input: chunk.input,
          });
        }
        break;
      case "dynamic-tool":
        if (typeof chunk.toolName === "string") {
          toolCalls.push({ name: chunk.toolName, input: chunk.input });
        }
        break;
      case "start-step":
        steps += 1;
        break;
      default:
        break;
    }
  }
  return { answerText, toolCalls, steps };
}

export interface RunChatOptions {
  baseUrl: string; // e.g. https://explorer.citrate.ai or http://localhost:3000
  question: string;
  token?: string | null; // OIDC id_token; omit to test the unauthenticated path
  threadId?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

let msgSeq = 0;

/** Drive one agent turn end to end and return the scraped result. */
export async function runChat(opts: RunChatOptions): Promise<ChatRunResult> {
  const fetchFn = opts.fetchImpl ?? fetch;
  const msgId = `eval-${msgSeq++}`;
  const body = {
    id: opts.threadId ?? `eval-thread-${msgId}`,
    messages: [{ id: msgId, role: "user", parts: [{ type: "text", text: opts.question }] }],
    ...(opts.threadId ? { threadId: opts.threadId } : {}),
  };
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;

  const started = Date.now();
  const res = await fetchFn(`${opts.baseUrl}/api/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  const raw = await res.text();
  const latencyMs = Date.now() - started;

  if (!res.ok) {
    return { answerText: "", toolCalls: [], steps: 0, latencyMs, httpStatus: res.status, raw };
  }
  const parsed = parseUiMessageStream(raw);
  return { ...parsed, latencyMs, httpStatus: res.status, raw };
}
