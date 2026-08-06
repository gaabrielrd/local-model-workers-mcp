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
import { assertTransportSecurity } from "./transport-security.js";

export function createProviderAdapter(
  configuration: ProviderConfig,
  options: Pick<
    LmStudioClientOptions,
    "fetch" | "retryCount" | "maxResponseBytes" | "workspaceLabel"
  > = {},
): ProviderAdapter {
  // Refuse at construction when a provider demands verification it cannot get,
  // so the failure surfaces at startup rather than mid-task.
  assertTransportSecurity({
    baseUrl: configuration.base_url,
    tlsVerify: configuration.tls_verify,
  });
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
