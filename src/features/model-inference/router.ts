import { CircuitBreaker } from "./circuit-breaker.js";
import {
  InferenceError,
  type EmbeddingRequest,
  type EmbeddingResult,
  type ModelCatalog,
  type ProviderAdapter,
  type ProviderRouterPort,
  type ProviderStatus,
  type RequestOptions,
  type StructuredInferenceRequest,
  type StructuredInferenceResult,
} from "./contracts.js";

const DEFAULT_RECHECK_INTERVAL_MS = 60_000;

export interface ProviderRouterOptions {
  readonly adapters: readonly ProviderAdapter[];
  readonly recheckIntervalMs?: number;
  readonly failureThreshold?: number;
  readonly now?: () => number;
}

interface MutableProviderStatus {
  status: "healthy" | "unhealthy" | "unknown";
  models: readonly string[];
  lastCheckedAt: number | null;
  errorCode?: ProviderStatus["error_code"];
}

export function createProviderRouter(
  options: ProviderRouterOptions,
): ProviderRouterPort {
  const adapters = validateAdapters(options.adapters);
  const recheckIntervalMs =
    options.recheckIntervalMs ?? DEFAULT_RECHECK_INTERVAL_MS;
  if (!Number.isInteger(recheckIntervalMs) || recheckIntervalMs < 1) {
    throw new InferenceError(
      "invalid_configuration",
      "The provider recheck interval must be a positive integer.",
    );
  }
  const now = options.now ?? Date.now;
  const status = new Map<string, MutableProviderStatus>(
    adapters.map((adapter) => [
      adapter.provider.name,
      { status: "unknown", models: [], lastCheckedAt: null },
    ]),
  );
  const breakers = new Map<string, CircuitBreaker>(
    adapters.map((adapter) => [
      adapter.provider.name,
      new CircuitBreaker({
        failureThreshold: options.failureThreshold ?? 5,
        cooldownMs: recheckIntervalMs,
        now,
      }),
    ]),
  );

  const refreshOne = async (
    adapter: ProviderAdapter,
    requestOptions: RequestOptions,
  ): Promise<void> => {
    try {
      const catalog = await adapter.listModels(requestOptions);
      breakers.get(adapter.provider.name)?.recordSuccess();
      status.set(adapter.provider.name, {
        status: "healthy",
        models: Object.freeze([...catalog.models]),
        lastCheckedAt: now(),
      });
    } catch (error: unknown) {
      breakers.get(adapter.provider.name)?.recordFailure();
      status.set(adapter.provider.name, {
        status: "unhealthy",
        models: [],
        lastCheckedAt: now(),
        errorCode:
          error instanceof InferenceError ? error.code : "endpoint_unreachable",
      });
    }
  };

  const refreshHealth = async (
    requestOptions: RequestOptions,
  ): Promise<readonly ProviderStatus[]> => {
    await Promise.all(
      adapters.map((adapter) => refreshOne(adapter, requestOptions)),
    );
    return snapshot(adapters, status, breakers);
  };

  const ensureHealth = async (
    requestOptions: RequestOptions,
  ): Promise<void> => {
    const currentTime = now();
    const stale = adapters.filter((adapter) => {
      const current = status.get(adapter.provider.name);
      return (
        current === undefined ||
        current.status === "unknown" ||
        (current.status === "unhealthy" &&
          (current.lastCheckedAt === null ||
            currentTime - current.lastCheckedAt >= recheckIntervalMs))
      );
    });
    await Promise.all(
      stale.map((adapter) => refreshOne(adapter, requestOptions)),
    );
  };

  const candidatesForModel = (model: string): readonly ProviderAdapter[] =>
    adapters.filter((adapter) => {
      const current = status.get(adapter.provider.name);
      const breaker = breakers.get(adapter.provider.name);
      return (
        current?.status === "healthy" &&
        (breaker === undefined || breaker.allowRequest()) &&
        current.models.includes(model) &&
        (adapter.provider.allowed_models.includes("*") ||
          adapter.provider.allowed_models.includes(model))
      );
    });

  const execute = async <Result>(
    model: string,
    requestOptions: RequestOptions,
    operation: (adapter: ProviderAdapter) => Promise<Result>,
  ): Promise<Result> => {
    await ensureHealth(requestOptions);
    const candidates = candidatesForModel(model);
    if (candidates.length === 0) {
      const allowed = adapters.some(
        (adapter) =>
          adapter.provider.allowed_models.includes("*") ||
          adapter.provider.allowed_models.includes(model),
      );
      throw new InferenceError(
        allowed ? "model_unavailable" : "model_unauthorized",
        allowed
          ? "No healthy provider currently offers the requested model."
          : "The requested model is not allowed by any provider.",
      );
    }
    let lastTransient: InferenceError | undefined;
    let providersAttempted = 0;
    for (const adapter of candidates) {
      providersAttempted += 1;
      try {
        const result = await operation(adapter);
        breakers.get(adapter.provider.name)?.recordSuccess();
        return {
          ...result,
          provider: adapter.provider.name,
          retries:
            ((result as { retries?: number }).retries ?? 0) +
            (providersAttempted - 1),
        };
      } catch (error: unknown) {
        if (!(error instanceof InferenceError) || !error.retryable) {
          throw error;
        }
        lastTransient = error;
        lastTransient.provider = adapter.provider.name;
        breakers.get(adapter.provider.name)?.recordFailure();
        status.set(adapter.provider.name, {
          status: "unhealthy",
          models: [],
          lastCheckedAt: now(),
          errorCode: error.code,
        });
      }
    }
    throw (
      lastTransient ??
      new InferenceError(
        "endpoint_unreachable",
        "No provider completed the request.",
        true,
      )
    );
  };

  return {
    refreshHealth,
    getProviderStatus: () => snapshot(adapters, status, breakers),
    routeForModel: (model) => {
      const adapter = candidatesForModel(model)[0];
      return adapter === undefined
        ? null
        : snapshotOne(
            adapter,
            status.get(adapter.provider.name),
            breakers.get(adapter.provider.name),
          );
    },
    listModels: async (requestOptions): Promise<ModelCatalog> => {
      await ensureHealth(requestOptions);
      return {
        models: [
          ...new Set(
            snapshot(adapters, status, breakers)
              .filter((entry) => entry.status === "healthy")
              .flatMap((entry) => entry.models),
          ),
        ].sort(),
      };
    },
    isAuthenticationEnforced: async (requestOptions) => {
      await ensureHealth(requestOptions);
      const authenticated = adapters.filter(
        (adapter) =>
          status.get(adapter.provider.name)?.status === "healthy" &&
          adapter.provider.token_configured,
      );
      if (authenticated.length === 0) return false;
      const results = await Promise.all(
        authenticated.map((adapter) =>
          adapter.isAuthenticationEnforced(requestOptions),
        ),
      );
      return results.every(Boolean);
    },
    inferStructured: <Output>(request: StructuredInferenceRequest<Output>) =>
      execute<StructuredInferenceResult<Output>>(
        request.model,
        request,
        (adapter) => adapter.inferStructured(request),
      ),
    embedText: (request: EmbeddingRequest) =>
      execute<EmbeddingResult>(request.model, request, (adapter) =>
        adapter.embedText(request),
      ),
  };
}

function validateAdapters(
  input: readonly ProviderAdapter[],
): readonly ProviderAdapter[] {
  if (input.length === 0) {
    throw new InferenceError(
      "invalid_configuration",
      "At least one provider adapter is required.",
    );
  }
  const names = input.map((adapter) => adapter.provider.name);
  if (new Set(names).size !== names.length) {
    throw new InferenceError(
      "invalid_configuration",
      "Provider names must be unique.",
    );
  }
  return Object.freeze(
    [...input].sort(
      (left, right) =>
        left.provider.priority - right.provider.priority ||
        left.provider.name.localeCompare(right.provider.name),
    ),
  );
}

function snapshot(
  adapters: readonly ProviderAdapter[],
  status: ReadonlyMap<string, MutableProviderStatus>,
  breakers: ReadonlyMap<string, CircuitBreaker>,
): readonly ProviderStatus[] {
  return Object.freeze(
    adapters.map((adapter) =>
      snapshotOne(
        adapter,
        status.get(adapter.provider.name),
        breakers.get(adapter.provider.name),
      ),
    ),
  );
}

function snapshotOne(
  adapter: ProviderAdapter,
  current: MutableProviderStatus | undefined,
  breaker: CircuitBreaker | undefined,
): ProviderStatus {
  return Object.freeze({
    name: adapter.provider.name,
    type: adapter.provider.type,
    priority: adapter.provider.priority,
    status: current?.status ?? "unknown",
    circuit_state: breaker?.getState() ?? "closed",
    models: Object.freeze([...(current?.models ?? [])]),
    last_checked_at:
      current?.lastCheckedAt === null || current?.lastCheckedAt === undefined
        ? null
        : new Date(current.lastCheckedAt).toISOString(),
    ...(current?.errorCode === undefined
      ? {}
      : { error_code: current.errorCode }),
  });
}
