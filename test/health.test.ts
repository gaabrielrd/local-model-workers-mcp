import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMINISTRATIVE_MAXIMA,
  BUILT_IN_LIMITS,
  FIXED_LIMITS,
  type EffectiveConfiguration,
} from "../src/features/configuration/index.js";
import { checkHealth } from "../src/features/health/index.js";
import {
  InferenceError,
  type ModelInferencePort,
} from "../src/features/model-inference/index.js";

const DEFAULT_MODEL = "qwen/default";
const SECOND_MODEL = "gemma/allowed";

void test("reports configuration, reachability, authentication, default, and allowed models", async () => {
  const result = await checkHealth({
    loadConfiguration: loadConfiguration(),
    clientFactory: () =>
      fakeClient({ models: [DEFAULT_MODEL, SECOND_MODEL], auth: true }),
  });

  assert.equal(result.status, "healthy");
  assert.deepEqual(result.configuration, { status: "healthy", code: "ok" });
  assert.deepEqual(result.reachability, { status: "healthy", code: "ok" });
  assert.deepEqual(result.authentication, { status: "healthy", code: "ok" });
  assert.deepEqual(result.default_model, {
    status: "healthy",
    code: "ok",
    model: DEFAULT_MODEL,
  });
  assert.deepEqual(result.allowed_models, [
    { status: "healthy", code: "ok", model: DEFAULT_MODEL },
    { status: "healthy", code: "ok", model: SECOND_MODEL },
  ]);
});

void test("fails health when authentication is not enforced", async () => {
  const result = await checkHealth({
    loadConfiguration: loadConfiguration(),
    clientFactory: () =>
      fakeClient({ models: [DEFAULT_MODEL, SECOND_MODEL], auth: false }),
  });

  assert.equal(result.status, "unhealthy");
  assert.deepEqual(result.authentication, {
    status: "unhealthy",
    code: "authentication_not_enforced",
  });
});

void test("treats intentionally unconfigured authentication as healthy", async () => {
  let authenticationProbes = 0;
  const effective = configuration(false);
  const result = await checkHealth({
    loadConfiguration: () => Promise.resolve({ effective }),
    clientFactory: () => ({
      ...fakeClient({ models: [DEFAULT_MODEL, SECOND_MODEL] }),
      isAuthenticationEnforced: () => {
        authenticationProbes += 1;
        return Promise.resolve(false);
      },
    }),
  });

  assert.equal(result.status, "healthy");
  assert.deepEqual(result.authentication, {
    status: "healthy",
    code: "not_configured",
  });
  assert.equal(authenticationProbes, 0);
});

void test("distinguishes invalid configuration without repository access", async () => {
  let repositoryCalls = 0;
  const repository = {
    read: () => {
      repositoryCalls += 1;
    },
  };
  void repository;

  const result = await checkHealth({
    loadConfiguration: () => {
      throw new Error("invalid fixture configuration");
    },
  });

  assert.equal(result.status, "unhealthy");
  assert.deepEqual(result.configuration, {
    status: "unhealthy",
    code: "invalid_configuration",
  });
  assert.equal(result.default_model, null);
  assert.equal(repositoryCalls, 0);
});

void test("distinguishes endpoint, authentication, timeout, and malformed catalog failures", async (t) => {
  const cases = [
    ["endpoint_unreachable", "endpoint_unreachable"],
    ["authentication_failed", "authentication_failed"],
    ["inference_timeout", "request_timeout"],
    ["malformed_response", "malformed_response"],
  ] as const;

  for (const [inferenceCode, healthCode] of cases) {
    await t.test(inferenceCode, async () => {
      const result = await checkHealth({
        loadConfiguration: loadConfiguration(),
        clientFactory: () =>
          fakeClient({
            listError: new InferenceError(inferenceCode, "safe fixture error"),
          }),
      });

      assert.equal(result.status, "unhealthy");
      if (inferenceCode === "authentication_failed") {
        assert.equal(result.reachability.status, "healthy");
        assert.equal(result.authentication.code, healthCode);
      } else {
        assert.equal(result.reachability.code, healthCode);
        assert.equal(result.authentication.status, "not_checked");
      }
      assert.ok(
        result.allowed_models.every((model) => model.status === "not_checked"),
      );
    });
  }
});

void test("reports the missing default and each unavailable allowed model independently", async () => {
  const result = await checkHealth({
    loadConfiguration: loadConfiguration(),
    clientFactory: () => fakeClient({ models: [SECOND_MODEL], auth: true }),
  });

  assert.equal(result.status, "unhealthy");
  assert.deepEqual(result.default_model, {
    status: "unhealthy",
    code: "default_model_unavailable",
    model: DEFAULT_MODEL,
  });
  assert.deepEqual(result.allowed_models, [
    {
      status: "unhealthy",
      code: "allowed_model_unavailable",
      model: DEFAULT_MODEL,
    },
    { status: "healthy", code: "ok", model: SECOND_MODEL },
  ]);
});

function loadConfiguration() {
  return () =>
    Promise.resolve({
      effective: configuration(),
      bearer_token: "fixture-health-token",
    });
}

function configuration(tokenConfigured = true): EffectiveConfiguration {
  return {
    schema_version: 1,
    revision: `sha256:${"a".repeat(64)}`,
    lm_studio: {
      base_url: "http://127.0.0.1:1234/v1",
      authentication: tokenConfigured ? "bearer" : "none",
      token_configured: tokenConfigured,
      allowed_models: [DEFAULT_MODEL, SECOND_MODEL],
      default_model: DEFAULT_MODEL,
    },
    limits: BUILT_IN_LIMITS,
    administrative_maxima: ADMINISTRATIVE_MAXIMA,
    fixed_limits: FIXED_LIMITS,
    origins: {
      "lm_studio.base_url": "protected",
      "lm_studio.authentication": "protected",
      "lm_studio.allowed_models": "protected",
      "lm_studio.default_model": "global",
      "lm_studio.embedding_model": "built_in",
      steering_prompt: "built_in",
      "limits.max_concurrency": "built_in",
      "limits.queue_timeout_ms": "built_in",
      "limits.processing_timeout_ms": "built_in",
      "limits.max_exploration_interactions": "built_in",
      "limits.context_budget_bytes": "built_in",
      "administrative_maxima.max_concurrency": "protected",
      "administrative_maxima.queue_timeout_ms": "protected",
      "administrative_maxima.processing_timeout_ms": "protected",
      "administrative_maxima.max_exploration_interactions": "protected",
      "administrative_maxima.context_budget_bytes": "protected",
      "fixed_limits.patch_max_files": "protected",
      "fixed_limits.patch_max_changed_lines": "protected",
      "fixed_limits.inference_retry_count": "protected",
    },
  };
}

function fakeClient(options: {
  readonly models?: readonly string[];
  readonly auth?: boolean;
  readonly listError?: InferenceError;
}): ModelInferencePort {
  return {
    listModels: () => {
      if (options.listError !== undefined) {
        return Promise.reject(options.listError);
      }
      return Promise.resolve({ models: options.models ?? [] });
    },
    isAuthenticationEnforced: () => Promise.resolve(options.auth ?? true),
    embedText: () => {
      throw new Error("Health must not perform embedding.");
    },
    inferStructured: () => {
      throw new Error("Health must not perform inference.");
    },
  };
}
