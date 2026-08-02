import assert from "node:assert/strict";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import test, { type TestContext } from "node:test";

import { z } from "zod";

import {
  createLmStudioClient,
  InferenceError,
} from "../src/features/model-inference/index.js";

const TOKEN = "fixture-bearer-value";
const MODEL = "qwen/fixture-model";
const OutputSchema = z.object({ ok: z.literal(true) }).strict();

void test("sends authenticated non-streaming JSON Schema requests and validates output", async (t) => {
  const captured: CapturedRequest[] = [];
  const baseUrl = await startFakeServer(t, async (request, response) => {
    captured.push(await capture(request));
    if (request.url === "/v1/models") {
      json(response, 200, { data: [{ id: MODEL }] });
      return;
    }
    json(response, 200, completedResponse());
  });
  const client = configuredClient(baseUrl);

  const result = await client.inferStructured(inferenceRequest());

  assert.deepEqual(result.output, { ok: true });
  assert.equal(result.usage.reasoning_tokens, 0);
  assert.equal(captured.length, 2);
  assert.equal(captured[0]?.authorization, `Bearer ${TOKEN}`);
  assert.equal(captured[1]?.authorization, `Bearer ${TOKEN}`);
  const payload = object(captured[1]?.body);
  assert.equal(payload.stream, false);
  assert.equal(payload.reasoning_effort, "none");
  assert.equal(object(payload.response_format).type, "json_schema");
  assert.equal(JSON.stringify(payload).includes(TOKEN), false);
});

void test("rejects unauthorized and unavailable models without fallback", async (t) => {
  let requestCount = 0;
  const baseUrl = await startFakeServer(t, (request, response) => {
    requestCount += 1;
    assert.equal(request.url, "/v1/models");
    json(response, 200, { data: [{ id: "different/model" }] });
  });
  const client = configuredClient(baseUrl);

  await assert.rejects(
    client.inferStructured({
      ...inferenceRequest(),
      model: "blocked/model",
    }),
    isInferenceError("model_unauthorized"),
  );
  assert.equal(requestCount, 0);

  await assert.rejects(
    client.inferStructured(inferenceRequest()),
    isInferenceError("model_unavailable"),
  );
  assert.equal(requestCount, 1);
});

void test("detects enforced authentication without exposing either token", async (t) => {
  const baseUrl = await startFakeServer(t, (request, response) => {
    if (request.headers.authorization !== `Bearer ${TOKEN}`) {
      json(response, 401, { error: { message: TOKEN } });
      return;
    }
    json(response, 200, { data: [{ id: MODEL }] });
  });
  const client = configuredClient(baseUrl);

  assert.deepEqual(await client.listModels({ timeout_ms: 1_000 }), {
    models: [MODEL],
  });
  assert.equal(
    await client.isAuthenticationEnforced({ timeout_ms: 1_000 }),
    true,
  );

  const rejectedClient = createLmStudioClient({
    baseUrl,
    bearerToken: "wrong-secret-value",
    allowedModels: [MODEL],
  });
  let caught: unknown;
  try {
    await rejectedClient.listModels({ timeout_ms: 1_000 });
  } catch (error: unknown) {
    caught = error;
  }
  assert.ok(caught instanceof InferenceError);
  assert.equal(caught.code, "authentication_failed");
  assert.equal(caught.message.includes(TOKEN), false);
  assert.equal(caught.message.includes("wrong-secret-value"), false);
});

void test("detects when LM Studio accepts a deliberately invalid token", async (t) => {
  const baseUrl = await startFakeServer(t, (_request, response) => {
    json(response, 200, { data: [{ id: MODEL }] });
  });

  assert.equal(
    await configuredClient(baseUrl).isAuthenticationEnforced({
      timeout_ms: 1_000,
    }),
    false,
  );
});

void test("retries one transient inference failure and never retries a permanent failure", async (t) => {
  let chatRequests = 0;
  const baseUrl = await startFakeServer(t, (request, response) => {
    if (request.url === "/v1/models") {
      json(response, 200, { data: [{ id: MODEL }] });
      return;
    }
    chatRequests += 1;
    json(response, chatRequests === 1 ? 503 : 200, completedResponse());
  });
  const client = configuredClient(baseUrl);

  assert.deepEqual((await client.inferStructured(inferenceRequest())).output, {
    ok: true,
  });
  assert.equal(chatRequests, 2);

  chatRequests = 0;
  const permanentBaseUrl = await startFakeServer(t, (request, response) => {
    if (request.url === "/v1/models") {
      json(response, 200, { data: [{ id: MODEL }] });
      return;
    }
    chatRequests += 1;
    json(response, 400, { error: { message: "bad request" } });
  });
  await assert.rejects(
    configuredClient(permanentBaseUrl).inferStructured(inferenceRequest()),
    isInferenceError("inference_failed"),
  );
  assert.equal(chatRequests, 1);
});

void test("returns a structured transient error after the bounded retry", async (t) => {
  let chatRequests = 0;
  const baseUrl = await startFakeServer(t, (request, response) => {
    if (request.url === "/v1/models") {
      json(response, 200, { data: [{ id: MODEL }] });
      return;
    }
    chatRequests += 1;
    json(response, 503, { error: { message: "later" } });
  });

  await assert.rejects(
    configuredClient(baseUrl).inferStructured(inferenceRequest()),
    isInferenceError("transient_failure"),
  );
  assert.equal(chatRequests, 2);
});

void test("cancellation and deadlines abort the HTTP stack without retry", async (t) => {
  let chatRequests = 0;
  const baseUrl = await startFakeServer(t, (request, response) => {
    if (request.url === "/v1/models") {
      json(response, 200, { data: [{ id: MODEL }] });
      return;
    }
    chatRequests += 1;
    response.writeHead(200, { "content-type": "application/json" });
  });

  await assert.rejects(
    configuredClient(baseUrl).inferStructured({
      ...inferenceRequest(),
      timeout_ms: 20,
    }),
    isInferenceError("inference_timeout"),
  );
  assert.equal(chatRequests, 1);

  chatRequests = 0;
  const controller = new AbortController();
  const pending = configuredClient(baseUrl).inferStructured({
    ...inferenceRequest(),
    signal: controller.signal,
  });
  setTimeout(() => {
    controller.abort();
  }, 20);
  await assert.rejects(pending, isInferenceError("inference_cancelled"));
  assert.equal(chatRequests, 1);
});

void test("fails closed on malformed, oversized, and partial responses", async (t) => {
  const cases = [
    {
      name: "malformed",
      reply: (response: ServerResponse) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end("not-json");
      },
      code: "malformed_response",
    },
    {
      name: "oversized",
      reply: (response: ServerResponse) => {
        json(response, 200, completedResponse("x".repeat(2_000)));
      },
      code: "response_too_large",
    },
    {
      name: "partial",
      reply: (response: ServerResponse) => {
        json(response, 200, completedResponse('{"ok":true}', "length"));
      },
      code: "incomplete_response",
    },
    {
      name: "model substitution",
      reply: (response: ServerResponse) => {
        json(response, 200, {
          ...completedResponse(),
          model: "different/model",
        });
      },
      code: "malformed_response",
    },
  ] as const;

  for (const fixture of cases) {
    await t.test(fixture.name, async (nested) => {
      const baseUrl = await startFakeServer(nested, (request, response) => {
        if (request.url === "/v1/models") {
          json(response, 200, { data: [{ id: MODEL }] });
          return;
        }
        fixture.reply(response);
      });
      const client = createLmStudioClient({
        baseUrl,
        bearerToken: TOKEN,
        allowedModels: [MODEL],
        maxResponseBytes: 1_000,
      });

      await assert.rejects(
        client.inferStructured(inferenceRequest()),
        isInferenceError(fixture.code),
      );
    });
  }
});

interface CapturedRequest {
  readonly authorization: string | undefined;
  readonly body: unknown;
}

function configuredClient(baseUrl: string) {
  return createLmStudioClient({
    baseUrl,
    bearerToken: TOKEN,
    allowedModels: [MODEL],
  });
}

function inferenceRequest() {
  return {
    model: MODEL,
    messages: [{ role: "user" as const, content: "Return ok." }],
    output_name: "fixture_output",
    output_schema: OutputSchema,
    max_tokens: 100,
    timeout_ms: 1_000,
  };
}

function completedResponse(content = '{"ok":true}', finishReason = "stop") {
  return {
    model: MODEL,
    choices: [
      {
        finish_reason: finishReason,
        message: { content },
      },
    ],
    usage: {
      prompt_tokens: 5,
      completion_tokens: 3,
      total_tokens: 8,
      completion_tokens_details: { reasoning_tokens: 0 },
    },
  };
}

async function startFakeServer(
  t: TestContext,
  handler: (
    request: IncomingMessage,
    response: ServerResponse,
  ) => void | Promise<void>,
): Promise<string> {
  const server = createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch(() => {
      response.destroy();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) {
            resolve();
          } else {
            reject(error);
          }
        });
        server.closeAllConnections();
      }),
  );
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  return `http://127.0.0.1:${address.port}/v1`;
}

async function capture(request: IncomingMessage): Promise<CapturedRequest> {
  const chunks: Buffer[] = [];
  for await (const untrustedChunk of request) {
    const chunk: unknown = untrustedChunk;
    if (typeof chunk === "string" || Buffer.isBuffer(chunk)) {
      chunks.push(Buffer.from(chunk));
    } else {
      throw new TypeError("Unexpected request body chunk.");
    }
  }
  const body = Buffer.concat(chunks).toString("utf8");
  return {
    authorization: request.headers.authorization,
    body: body.length === 0 ? null : (JSON.parse(body) as unknown),
  };
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function object(value: unknown): Record<string, unknown> {
  assert.ok(
    typeof value === "object" && value !== null && !Array.isArray(value),
  );
  return value as Record<string, unknown>;
}

function isInferenceError(code: InferenceError["code"]) {
  return (error: unknown): boolean =>
    error instanceof InferenceError && error.code === code;
}
