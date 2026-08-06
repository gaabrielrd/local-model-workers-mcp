import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod";

import { createProviderAdapter } from "../src/features/model-inference/index.js";

const OutputSchema = z.object({ answer: z.string() }).strict();

void test("Ollama uses tags, chat structured format, and embed endpoints", async () => {
  const requests: { url: string; body?: unknown }[] = [];
  const adapter = createProviderAdapter(
    {
      name: "ollama",
      type: "ollama",
      base_url: "http://ollama.invalid",
      tls_verify: false,
      allowed_models: ["qwen"],
      priority: 0,
    },
    {
      retryCount: 0,
      fetch: (input, init) => {
        const url = requestUrl(input);
        requests.push({
          url,
          ...(typeof init?.body === "string"
            ? { body: JSON.parse(init.body) as unknown }
            : {}),
        });
        if (url.endsWith("/api/tags")) {
          return Promise.resolve(json({ models: [{ name: "qwen" }] }));
        }
        if (url.endsWith("/api/chat")) {
          return Promise.resolve(
            json({
              model: "qwen",
              message: { content: '{"answer":"ok"}' },
              done: true,
              done_reason: "stop",
              prompt_eval_count: 3,
              eval_count: 2,
            }),
          );
        }
        return Promise.resolve(
          json({ model: "qwen", embeddings: [[0.1, 0.2]] }),
        );
      },
    },
  );

  assert.deepEqual(await adapter.listModels({ timeout_ms: 100 }), {
    models: ["qwen"],
  });
  const inference = await adapter.inferStructured({
    model: "qwen",
    messages: [{ role: "user", content: "answer" }],
    output_name: "answer",
    output_schema: OutputSchema,
    max_tokens: 50,
    timeout_ms: 100,
  });
  const embedding = await adapter.embedText({
    model: "qwen",
    input: "text",
    timeout_ms: 100,
  });

  assert.deepEqual(inference.output, { answer: "ok" });
  assert.deepEqual(embedding.embeddings, [[0.1, 0.2]]);
  assert.ok(requests.some((request) => request.url.endsWith("/api/chat")));
  assert.ok(requests.some((request) => request.url.endsWith("/api/embed")));
  const chat = requests.find((request) => request.url.endsWith("/api/chat"));
  assert.equal(typeof (chat?.body as { format?: unknown }).format, "object");
});

void test("Ollama verifies that configured Bearer authentication is enforced", async () => {
  const adapter = createProviderAdapter(
    {
      name: "ollama-auth",
      type: "ollama",
      base_url: "http://ollama.invalid",
      tls_verify: false,
      bearer_token: "configured-token",
      allowed_models: ["qwen"],
      priority: 0,
    },
    {
      retryCount: 0,
      fetch: (_input, init) => {
        const authorization = new Headers(init?.headers).get("authorization");
        return Promise.resolve(
          authorization === "Bearer configured-token"
            ? json({ models: [{ name: "qwen" }] })
            : new Response("unauthorized", { status: 401 }),
        );
      },
    },
  );

  assert.equal(
    await adapter.isAuthenticationEnforced({ timeout_ms: 100 }),
    true,
  );
});

for (const type of ["lm-studio", "vllm", "localai"] as const) {
  void test(`${type} uses OpenAI-compatible models and chat endpoints`, async () => {
    const urls: string[] = [];
    const adapter = createProviderAdapter(
      {
        name: type,
        type,
        base_url: `http://${type}.invalid/v1`,
        tls_verify: false,
        allowed_models: ["model"],
        priority: 0,
      },
      {
        retryCount: 0,
        fetch: (input) => {
          const url = requestUrl(input);
          urls.push(url);
          if (url.endsWith("/models")) {
            return Promise.resolve(json({ data: [{ id: "model" }] }));
          }
          return Promise.resolve(
            json({
              model: "model",
              choices: [
                {
                  finish_reason: "stop",
                  message: { content: '{"answer":"ok"}' },
                },
              ],
              usage: {
                prompt_tokens: 1,
                completion_tokens: 1,
                total_tokens: 2,
              },
            }),
          );
        },
      },
    );

    const result = await adapter.inferStructured({
      model: "model",
      messages: [{ role: "user", content: "answer" }],
      output_name: "answer",
      output_schema: OutputSchema,
      max_tokens: 50,
      timeout_ms: 100,
    });

    assert.deepEqual(result.output, { answer: "ok" });
    assert.ok(urls.some((url) => url.endsWith("/models")));
    assert.ok(urls.some((url) => url.endsWith("/chat/completions")));
  });
}

void test("OpenAI-compatible providers honor the protected wildcard policy", async () => {
  const adapter = createProviderAdapter(
    {
      name: "wildcard",
      type: "lm-studio",
      base_url: "http://lm-studio.invalid/v1",
      tls_verify: false,
      allowed_models: ["*"],
      priority: 0,
    },
    {
      retryCount: 0,
      fetch: (input) =>
        Promise.resolve(
          requestUrl(input).endsWith("/models")
            ? json({ data: [{ id: "dynamic-model" }] })
            : json({
                model: "dynamic-model",
                choices: [
                  {
                    finish_reason: "stop",
                    message: { content: '{"answer":"ok"}' },
                  },
                ],
                usage: {
                  prompt_tokens: 1,
                  completion_tokens: 1,
                  total_tokens: 2,
                },
              }),
        ),
    },
  );

  const result = await adapter.inferStructured({
    model: "dynamic-model",
    messages: [{ role: "user", content: "answer" }],
    output_name: "answer",
    output_schema: OutputSchema,
    max_tokens: 50,
    timeout_ms: 100,
  });

  assert.deepEqual(result.output, { answer: "ok" });
});

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function requestUrl(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (input instanceof Request) return input.url;
  throw new TypeError("Unsupported request input.");
}
