import assert from "node:assert/strict";
import test from "node:test";

import { parseSseStream } from "../src/features/model-inference/index.js";

void test("parseSseStream processes data chunks and ignores [DONE]", async () => {
  const chunks: string[] = [];
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"token":"hello"}\n\n'));
      controller.enqueue(encoder.encode('data: {"token":" world"}\n\n'));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  await parseSseStream(stream, (chunk) => chunks.push(chunk));

  assert.deepEqual(chunks, ['{"token":"hello"}', '{"token":" world"}']);
});

void test("parseSseStream handles partial buffers across stream chunks", async () => {
  const chunks: string[] = [];
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"part":'));
      controller.enqueue(encoder.encode('1}\n\ndata: {"part":2}\n\n'));
      controller.close();
    },
  });

  await parseSseStream(stream, (chunk) => chunks.push(chunk));

  assert.deepEqual(chunks, ['{"part":1}', '{"part":2}']);
});
