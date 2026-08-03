import type {
  EffectiveConfiguration,
  ProtectedProviderConfiguration,
} from "../configuration/index.js";
import {
  createLmStudioClient,
  InferenceError,
  type LmStudioClientOptions,
  type ModelInferencePort,
  type ProviderRouterPort,
  type ProviderStatus,
} from "../model-inference/index.js";

export type HealthCheckStatus = "healthy" | "unhealthy" | "not_checked";

export type HealthDiagnosticCode =
  | "ok"
  | "not_configured"
  | "invalid_configuration"
  | "endpoint_unreachable"
  | "authentication_failed"
  | "authentication_not_enforced"
  | "default_model_unavailable"
  | "allowed_model_unavailable"
  | "request_cancelled"
  | "request_timeout"
  | "malformed_response"
  | "not_checked";

export interface HealthCheck {
  readonly status: HealthCheckStatus;
  readonly code: HealthDiagnosticCode;
}

export interface ModelHealthCheck extends HealthCheck {
  readonly model: string;
}

export interface HealthResult {
  readonly status: "healthy" | "unhealthy";
  readonly configuration: HealthCheck;
  readonly reachability: HealthCheck;
  readonly authentication: HealthCheck;
  readonly default_model: ModelHealthCheck | null;
  readonly allowed_models: readonly ModelHealthCheck[];
  readonly providers: readonly ProviderStatus[];
}

export interface HealthRuntimeConfiguration {
  readonly effective: EffectiveConfiguration;
  readonly bearer_token?: string;
  readonly providers?: readonly ProtectedProviderConfiguration[];
}

export interface CheckHealthInput {
  readonly loadConfiguration: () => Promise<HealthRuntimeConfiguration>;
  readonly timeout_ms?: number;
  readonly signal?: AbortSignal;
  readonly providerRouter?: ProviderRouterPort;
  readonly clientFactory?: (
    options: LmStudioClientOptions,
  ) => ModelInferencePort;
}

const HEALTH_TIMEOUT_MS = 5_000;
const HEALTHY = Object.freeze({ status: "healthy", code: "ok" } as const);
const NOT_CHECKED = Object.freeze({
  status: "not_checked",
  code: "not_checked",
} as const);

export async function checkHealth(
  input: CheckHealthInput,
): Promise<HealthResult> {
  let runtime: HealthRuntimeConfiguration;
  try {
    runtime = await input.loadConfiguration();
  } catch {
    return configurationFailure();
  }

  const requestOptions = {
    timeout_ms: input.timeout_ms ?? HEALTH_TIMEOUT_MS,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  };

  const clientFactory = input.clientFactory ?? createLmStudioClient;
  let client: ModelInferencePort;
  let providers: readonly ProviderStatus[] = [];
  if (input.providerRouter !== undefined) {
    client = input.providerRouter;
    providers = await input.providerRouter.refreshHealth(requestOptions);
  } else {
    try {
      client = clientFactory({
        baseUrl: runtime.effective.lm_studio.base_url,
        ...(runtime.bearer_token === undefined
          ? {}
          : { bearerToken: runtime.bearer_token }),
        allowedModels: runtime.effective.lm_studio.allowed_models,
        retryCount: runtime.effective.fixed_limits.inference_retry_count,
      });
    } catch {
      return configurationFailure();
    }
  }

  let models: readonly string[];
  try {
    models = (await client.listModels(requestOptions)).models;
  } catch (error: unknown) {
    return catalogFailure(error, runtime.effective, providers);
  }

  let authentication: HealthCheck;
  if (input.providerRouter !== undefined) {
    const tokenConfigured =
      runtime.providers?.some(
        (provider) =>
          provider.bearer_token !== undefined &&
          provider.bearer_token.length > 0,
      ) === true;
    if (!tokenConfigured) {
      authentication = { status: "healthy", code: "not_configured" };
    } else {
      try {
        authentication = (await client.isAuthenticationEnforced(requestOptions))
          ? HEALTHY
          : { status: "unhealthy", code: "authentication_not_enforced" };
      } catch (error: unknown) {
        authentication = {
          status: "unhealthy",
          code: inferenceHealthCode(error),
        };
      }
    }
  } else if (runtime.effective.lm_studio.authentication === "none") {
    authentication = { status: "healthy", code: "not_configured" };
  } else {
    try {
      authentication = (await client.isAuthenticationEnforced(requestOptions))
        ? HEALTHY
        : { status: "unhealthy", code: "authentication_not_enforced" };
    } catch (error: unknown) {
      authentication = authenticationFailure(error);
    }
  }

  const availableModels = new Set(models);
  const defaultModel = runtime.effective.lm_studio.default_model;
  const isDefaultHealthy =
    defaultModel === "*"
      ? availableModels.size > 0
      : availableModels.has(defaultModel);
  const defaultModelCheck: ModelHealthCheck = isDefaultHealthy
    ? { ...HEALTHY, model: defaultModel }
    : {
        status: "unhealthy",
        code: "default_model_unavailable",
        model: defaultModel,
      };
  const allowedModelChecks = runtime.effective.lm_studio.allowed_models.map(
    (model): ModelHealthCheck => {
      const isHealthy =
        model === "*" ? availableModels.size > 0 : availableModels.has(model);
      return isHealthy
        ? { ...HEALTHY, model }
        : {
            status: "unhealthy",
            code: "allowed_model_unavailable",
            model,
          };
    },
  );

  const healthy =
    authentication.status === "healthy" &&
    defaultModelCheck.status === "healthy" &&
    allowedModelChecks.every((check) => check.status === "healthy");

  return {
    status: healthy ? "healthy" : "unhealthy",
    configuration: HEALTHY,
    reachability: HEALTHY,
    authentication,
    default_model: defaultModelCheck,
    allowed_models: allowedModelChecks,
    providers,
  };
}

function configurationFailure(): HealthResult {
  return {
    status: "unhealthy",
    configuration: {
      status: "unhealthy",
      code: "invalid_configuration",
    },
    reachability: NOT_CHECKED,
    authentication: NOT_CHECKED,
    default_model: null,
    allowed_models: [],
    providers: [],
  };
}

function catalogFailure(
  error: unknown,
  configuration: EffectiveConfiguration,
  providers: readonly ProviderStatus[] = [],
): HealthResult {
  const code = inferenceHealthCode(error);
  const reached =
    error instanceof InferenceError && error.code === "authentication_failed";
  const authentication: HealthCheck =
    error instanceof InferenceError && error.code === "authentication_failed"
      ? { status: "unhealthy", code: "authentication_failed" as const }
      : NOT_CHECKED;

  return {
    status: "unhealthy",
    configuration: HEALTHY,
    reachability: reached ? HEALTHY : { status: "unhealthy", code },
    authentication,
    default_model: {
      ...NOT_CHECKED,
      model: configuration.lm_studio.default_model,
    },
    allowed_models: configuration.lm_studio.allowed_models.map((model) => ({
      ...NOT_CHECKED,
      model,
    })),
    providers,
  };
}

function authenticationFailure(error: unknown): HealthCheck {
  return {
    status: "unhealthy",
    code: inferenceHealthCode(error),
  };
}

function inferenceHealthCode(error: unknown): HealthDiagnosticCode {
  if (!(error instanceof InferenceError)) {
    return "endpoint_unreachable";
  }
  switch (error.code) {
    case "authentication_failed":
      return "authentication_failed";
    case "authentication_not_enforced":
      return "authentication_not_enforced";
    case "inference_cancelled":
      return "request_cancelled";
    case "inference_timeout":
      return "request_timeout";
    case "malformed_response":
    case "response_too_large":
      return "malformed_response";
    default:
      return "endpoint_unreachable";
  }
}
