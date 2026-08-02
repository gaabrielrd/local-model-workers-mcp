import type { EffectiveConfiguration } from "../configuration/index.js";
import {
  createLmStudioClient,
  InferenceError,
  type LmStudioClientOptions,
  type ModelInferencePort,
} from "../model-inference/index.js";

export type HealthCheckStatus = "healthy" | "unhealthy" | "not_checked";

export type HealthDiagnosticCode =
  | "ok"
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
}

export interface HealthRuntimeConfiguration {
  readonly effective: EffectiveConfiguration;
  readonly bearer_token: string;
}

export interface CheckHealthInput {
  readonly loadConfiguration: () => Promise<HealthRuntimeConfiguration>;
  readonly timeout_ms?: number;
  readonly signal?: AbortSignal;
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

  const clientFactory = input.clientFactory ?? createLmStudioClient;
  let client: ModelInferencePort;
  try {
    client = clientFactory({
      baseUrl: runtime.effective.lm_studio.base_url,
      bearerToken: runtime.bearer_token,
      allowedModels: runtime.effective.lm_studio.allowed_models,
      retryCount: runtime.effective.fixed_limits.inference_retry_count,
    });
  } catch {
    return configurationFailure();
  }

  const requestOptions = {
    timeout_ms: input.timeout_ms ?? HEALTH_TIMEOUT_MS,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  };

  let models: readonly string[];
  try {
    models = (await client.listModels(requestOptions)).models;
  } catch (error: unknown) {
    return catalogFailure(error, runtime.effective);
  }

  let authentication: HealthCheck;
  try {
    authentication = (await client.isAuthenticationEnforced(requestOptions))
      ? HEALTHY
      : { status: "unhealthy", code: "authentication_not_enforced" };
  } catch (error: unknown) {
    authentication = authenticationFailure(error);
  }

  const availableModels = new Set(models);
  const defaultModel = runtime.effective.lm_studio.default_model;
  const defaultModelCheck: ModelHealthCheck = availableModels.has(defaultModel)
    ? { ...HEALTHY, model: defaultModel }
    : {
        status: "unhealthy",
        code: "default_model_unavailable",
        model: defaultModel,
      };
  const allowedModelChecks = runtime.effective.lm_studio.allowed_models.map(
    (model): ModelHealthCheck =>
      availableModels.has(model)
        ? { ...HEALTHY, model }
        : {
            status: "unhealthy",
            code: "allowed_model_unavailable",
            model,
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
  };
}

function catalogFailure(
  error: unknown,
  configuration: EffectiveConfiguration,
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
