import {
  createLmStudioClient,
  type LmStudioClientOptions,
} from "./lm-studio.js";
import {
  InferenceError,
  type ProviderAdapter,
  type ProviderConfig,
} from "./contracts.js";

export interface OpenAiCompatibleAdapterOptions extends Pick<
  LmStudioClientOptions,
  "fetch" | "retryCount" | "maxResponseBytes"
> {
  readonly configuration: ProviderConfig;
}

export function createOpenAiCompatibleAdapter(
  options: OpenAiCompatibleAdapterOptions,
): ProviderAdapter {
  const { configuration } = options;
  if (configuration.type === "ollama") {
    throw new InferenceError(
      "invalid_configuration",
      "The provider is not OpenAI-compatible.",
    );
  }
  const client = createLmStudioClient({
    baseUrl: configuration.base_url,
    ...(configuration.bearer_token === undefined
      ? {}
      : { bearerToken: configuration.bearer_token }),
    allowedModels: configuration.allowed_models,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.retryCount === undefined
      ? {}
      : { retryCount: options.retryCount }),
    ...(options.maxResponseBytes === undefined
      ? {}
      : { maxResponseBytes: options.maxResponseBytes }),
  });
  return {
    provider: Object.freeze({
      name: configuration.name,
      type: configuration.type,
      base_url: configuration.base_url,
      allowed_models: Object.freeze([...configuration.allowed_models]),
      priority: configuration.priority,
      token_configured:
        configuration.bearer_token !== undefined &&
        configuration.bearer_token.trim().length > 0,
    }),
    ...client,
  };
}
