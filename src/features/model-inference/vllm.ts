import {
  createOpenAiCompatibleAdapter,
  type OpenAiCompatibleAdapterOptions,
} from "./openai-compatible.js";
import { InferenceError, type ProviderAdapter } from "./contracts.js";

export function createVllmAdapter(
  options: OpenAiCompatibleAdapterOptions,
): ProviderAdapter {
  if (options.configuration.type !== "vllm") {
    throw new InferenceError(
      "invalid_configuration",
      "The vLLM adapter requires a vLLM provider.",
    );
  }
  return createOpenAiCompatibleAdapter(options);
}
