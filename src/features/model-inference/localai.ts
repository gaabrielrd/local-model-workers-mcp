import {
  createOpenAiCompatibleAdapter,
  type OpenAiCompatibleAdapterOptions,
} from "./openai-compatible.js";
import { InferenceError, type ProviderAdapter } from "./contracts.js";

export function createLocalAiAdapter(
  options: OpenAiCompatibleAdapterOptions,
): ProviderAdapter {
  if (options.configuration.type !== "localai") {
    throw new InferenceError(
      "invalid_configuration",
      "The LocalAI adapter requires a LocalAI provider.",
    );
  }
  return createOpenAiCompatibleAdapter(options);
}
