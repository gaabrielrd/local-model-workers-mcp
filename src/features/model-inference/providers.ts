import { type LmStudioClientOptions } from "./lm-studio.js";
import { createLocalAiAdapter } from "./localai.js";
import { createOllamaAdapter } from "./ollama.js";
import { createOpenAiCompatibleAdapter } from "./openai-compatible.js";
import { createVllmAdapter } from "./vllm.js";
import {
  InferenceError,
  type ProviderAdapter,
  type ProviderConfig,
} from "./contracts.js";

export function createProviderAdapter(
  configuration: ProviderConfig,
  options: Pick<
    LmStudioClientOptions,
    "fetch" | "retryCount" | "maxResponseBytes"
  > = {},
): ProviderAdapter {
  if (configuration.type === "ollama") {
    return createOllamaAdapter({
      configuration,
      ...options,
    });
  }
  if (configuration.type === "vllm") {
    return createVllmAdapter({ configuration, ...options });
  }
  if (configuration.type === "localai") {
    return createLocalAiAdapter({ configuration, ...options });
  }
  if (configuration.type === "lm-studio") {
    return createOpenAiCompatibleAdapter({ configuration, ...options });
  }
  throw new InferenceError(
    "invalid_configuration",
    "The provider type is unsupported.",
  );
}
