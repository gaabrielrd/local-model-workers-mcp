import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod";

import {
  createProviderRouter,
  InferenceError,
  type ProviderAdapter,
  type ProviderType,
} from "../src/features/model-inference/index.js";

const OutputSchema = z.object({ value: z.string() }).strict();

void test("routes to the healthy provider with the lowest numeric priority", async () => {
  const calls: string[] = [];
  const router = createProviderRouter({
    adapters: [
      fakeAdapter("secondary", "localai", 20, ["model"], calls),
      fakeAdapter("primary", "vllm", 10, ["model"], calls),
    ],
  });

  await router.refreshHealth({ timeout_ms: 100 });
  const result = await router.inferStructured(request("model"));

  assert.deepEqual(result.output, { value: "primary" });
  assert.equal(router.routeForModel("model")?.name, "primary");
});

void test("fails over after the primary exhausts a transient request", async () => {
  const calls: string[] = [];
  const router = createProviderRouter({
    adapters: [
      fakeAdapter("primary", "lm-studio", 0, ["model"], calls, {
        inferenceError: new InferenceError(
          "transient_failure",
          "safe transient fixture",
          true,
        ),
      }),
      fakeAdapter("secondary", "ollama", 1, ["model"], calls),
    ],
  });

  await router.refreshHealth({ timeout_ms: 100 });
  const result = await router.inferStructured(request("model"));

  assert.deepEqual(result.output, { value: "secondary" });
  assert.deepEqual(calls, ["primary", "secondary"]);
  assert.equal(router.getProviderStatus()[0]?.status, "unhealthy");
});

void test("routes a model only to a provider that advertises and allows it", async () => {
  const calls: string[] = [];
  const router = createProviderRouter({
    adapters: [
      fakeAdapter("a", "vllm", 0, ["model-a"], calls),
      fakeAdapter("b", "localai", 1, ["model-b"], calls),
    ],
  });
  await router.refreshHealth({ timeout_ms: 100 });

  const result = await router.inferStructured(request("model-b"));

  assert.deepEqual(result.output, { value: "b" });
  assert.deepEqual(calls, ["b"]);
});

void test("reports model unavailable when every allowed provider is unhealthy", async () => {
  const router = createProviderRouter({
    adapters: [
      fakeAdapter("offline", "ollama", 0, ["model"], [], {
        listError: new InferenceError(
          "endpoint_unreachable",
          "safe offline fixture",
          true,
        ),
      }),
    ],
  });

  await assert.rejects(
    router.inferStructured(request("model")),
    (error: unknown) =>
      error instanceof InferenceError && error.code === "model_unavailable",
  );
});

void test("rechecks a failed provider after the configured interval", async () => {
  let now = 0;
  let offline = true;
  const calls: string[] = [];
  const primary = fakeAdapter("primary", "vllm", 0, ["model"], calls, {
    listModels: () => {
      if (offline) {
        return Promise.reject(
          new InferenceError("endpoint_unreachable", "offline", true),
        );
      }
      return Promise.resolve({ models: ["model"] });
    },
  });
  const router = createProviderRouter({
    adapters: [
      primary,
      fakeAdapter("secondary", "localai", 1, ["model"], calls),
    ],
    recheckIntervalMs: 60,
    now: () => now,
  });
  await router.refreshHealth({ timeout_ms: 100 });
  assert.equal(router.routeForModel("model")?.name, "secondary");

  offline = false;
  now = 60;
  const result = await router.inferStructured(request("model"));

  assert.deepEqual(result.output, { value: "primary" });
  assert.equal(router.getProviderStatus()[0]?.status, "healthy");
});

function request(model: string) {
  return {
    model,
    messages: [{ role: "user" as const, content: "Return JSON." }],
    output_name: "fixture_output",
    output_schema: OutputSchema,
    max_tokens: 100,
    timeout_ms: 1_000,
  };
}

function fakeAdapter(
  name: string,
  type: ProviderType,
  priority: number,
  models: readonly string[],
  calls: string[],
  behavior: {
    readonly listError?: InferenceError;
    readonly inferenceError?: InferenceError;
    readonly listModels?: ProviderAdapter["listModels"];
  } = {},
): ProviderAdapter {
  return {
    provider: {
      name,
      type,
      base_url: `http://${name}.invalid`,
      allowed_models: models,
      priority,
      token_configured: false,
    },
    listModels:
      behavior.listModels ??
      (() =>
        behavior.listError === undefined
          ? Promise.resolve({ models })
          : Promise.reject(behavior.listError)),
    isAuthenticationEnforced: () => Promise.resolve(false),
    inferStructured: <Output>() => {
      calls.push(name);
      if (behavior.inferenceError !== undefined) {
        return Promise.reject(behavior.inferenceError);
      }
      return Promise.resolve({
        model: models[0] ?? "model",
        output: { value: name } as Output,
        usage: {
          prompt_tokens: 1,
          completion_tokens: 1,
          total_tokens: 2,
          reasoning_tokens: 0,
        },
      });
    },
    embedText: (embeddingRequest) =>
      Promise.resolve({
        model: embeddingRequest.model,
        embeddings: [[1]],
        usage: { prompt_tokens: 1, total_tokens: 1 },
      }),
  };
}
