import { describe, it, expect } from "vitest";
import { parseUiMessageStream, runChat } from "./chatDriver";

// A representative AI SDK v6 UI message stream: two steps, two tool calls, streamed text.
const SAMPLE_SSE = [
  `data: {"type":"start"}`,
  `data: {"type":"start-step"}`,
  `data: {"type":"tool-input-available","toolCallId":"c1","toolName":"getChainStatus","input":{}}`,
  `data: {"type":"tool-output-available","toolCallId":"c1","output":{"chainId":40204}}`,
  `data: {"type":"finish-step"}`,
  `data: {"type":"start-step"}`,
  `data: {"type":"tool-input-available","toolCallId":"c2","toolName":"getBalance","input":{"address":"0xabc"}}`,
  `data: {"type":"text-start","id":"t1"}`,
  `data: {"type":"text-delta","id":"t1","delta":"The chain is "}`,
  `data: {"type":"text-delta","id":"t1","delta":"Citrate (40204)."}`,
  `data: {"type":"text-end","id":"t1"}`,
  `data: {"type":"finish-step"}`,
  `data: {"type":"finish"}`,
  `data: [DONE]`,
  ``,
].join("\n");

describe("eval/chatDriver — stream parsing", () => {
  it("extracts answer text, tool calls (in order), and step count", () => {
    const r = parseUiMessageStream(SAMPLE_SSE);
    expect(r.answerText).toBe("The chain is Citrate (40204).");
    expect(r.toolCalls.map((t) => t.name)).toEqual(["getChainStatus", "getBalance"]);
    expect(r.toolCalls[1].input).toEqual({ address: "0xabc" });
    expect(r.steps).toBe(2);
  });

  it("captures dynamic-tool calls too", () => {
    const sse = `data: {"type":"dynamic-tool","toolName":"callView","input":{"signature":"x()"}}`;
    const r = parseUiMessageStream(sse);
    expect(r.toolCalls.map((t) => t.name)).toEqual(["callView"]);
  });

  it("ignores keep-alive / unparseable frames", () => {
    const sse = [`: ping`, `data: not-json`, `data: {"type":"text-delta","id":"t","delta":"hi"}`].join("\n");
    expect(parseUiMessageStream(sse).answerText).toBe("hi");
  });
});

describe("eval/chatDriver — runChat", () => {
  it("drives a turn and returns parsed result + latency + 200", async () => {
    const fetchImpl = (async () =>
      new Response(SAMPLE_SSE, { status: 200, headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch;
    const r = await runChat({ baseUrl: "http://test", question: "what chain?", token: "JWT", fetchImpl });
    expect(r.httpStatus).toBe(200);
    expect(r.answerText).toContain("Citrate");
    expect(r.toolCalls.map((t) => t.name)).toEqual(["getChainStatus", "getBalance"]);
    expect(r.steps).toBe(2);
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("returns the status and empty result on a non-2xx (e.g. 401)", async () => {
    const fetchImpl = (async () =>
      new Response("unauthorized", { status: 401 })) as unknown as typeof fetch;
    const r = await runChat({ baseUrl: "http://test", question: "x", fetchImpl });
    expect(r.httpStatus).toBe(401);
    expect(r.answerText).toBe("");
    expect(r.toolCalls).toEqual([]);
  });

  it("attaches the bearer token when provided", async () => {
    let seenAuth: string | null = null;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      seenAuth = (init.headers as Record<string, string>).authorization ?? null;
      return new Response(SAMPLE_SSE, { status: 200 });
    }) as unknown as typeof fetch;
    await runChat({ baseUrl: "http://test", question: "x", token: "JWT123", fetchImpl });
    expect(seenAuth).toBe("Bearer JWT123");
  });
});
