import type { LanguageModel } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/**
 * Inference adapter. One interface, multiple backends selectable by
 * CITRATE_INFERENCE_MODE so the agent's code never changes when the concrete
 * inference source does.
 *   local   — a self-hosted OpenAI-compatible endpoint (your droplet)
 *   gateway — infer.citrate.ai (OpenAI-compatible) when live
 *   onchain — InferenceRouter via sponsored meta-tx (not wired yet)
 */
export type InferenceMode = "local" | "gateway" | "onchain";

export interface InferenceProvider {
  readonly mode: InferenceMode;
  readonly modelId: string;
  languageModel(): LanguageModel;
}

export function resolveMode(): InferenceMode {
  const m = (process.env.CITRATE_INFERENCE_MODE ?? "gateway").toLowerCase();
  if (m === "local" || m === "gateway" || m === "onchain") return m;
  throw new Error(
    `Invalid CITRATE_INFERENCE_MODE="${m}" (expected local | gateway | onchain)`,
  );
}

function openAICompatibleProvider(mode: InferenceMode): InferenceProvider {
  const baseURL =
    mode === "gateway"
      ? (process.env.CITRATE_GATEWAY_URL ?? "https://infer.citrate.ai/v1")
      : (process.env.CITRATE_INFERENCE_URL ?? "http://127.0.0.1:8080/v1");
  const apiKey =
    process.env.CITRATE_GATEWAY_API_KEY ?? process.env.CITRATE_INFERENCE_API_KEY;
  const modelId = process.env.CITRATE_MODEL_NAME ?? "gemma-4-E4B-it-Q4_K_M";
  const client = createOpenAICompatible({
    name: "citrate",
    baseURL,
    apiKey: apiKey ?? "not-needed",
  });
  return { mode, modelId, languageModel: () => client(modelId) };
}

/**
 * Factory: returns the configured inference provider. `onchain` streaming is not
 * wired — selecting it fails loudly rather than returning fake tokens (Rule 11).
 */
export function getInferenceProvider(): InferenceProvider {
  const mode = resolveMode();
  if (mode === "onchain") {
    throw new Error(
      "CITRATE_INFERENCE_MODE=onchain is not wired yet. Use 'gateway' or 'local'.",
    );
  }
  return openAICompatibleProvider(mode);
}
