import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

void test("Dockerfile uses node:24-slim base image", async () => {
  const dockerfilePath = path.join(process.cwd(), "Dockerfile");
  const content = await readFile(dockerfilePath, "utf-8");

  assert.ok(content.includes("FROM node:24-slim"));
  assert.ok(content.includes("WORKDIR /app"));
  assert.ok(content.includes('CMD ["node", "dist/cli/index.js"]'));
});
