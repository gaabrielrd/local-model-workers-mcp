import assert from "node:assert/strict";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import { resolveGlobalPreferencesPath } from "../../src/features/configuration/index.js";
import {
  createMcpApplicationRuntime,
  FEATURE_TOOL_NAMES,
  TOOL_NAMES,
} from "../../src/features/mcp-server/index.js";

const MODEL = "qwen/fixture-model";
const TOKEN = "mcp-fixture-token";
const builtCli = path.resolve("dist/cli/index.js");

void test("creates an MCP runtime without the optional Bearer token", async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), "mcp-no-auth-"));
  t.after(async () => rm(home, { recursive: true, force: true }));
  const environment = stringEnvironment({
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    LMW_LM_STUDIO_BASE_URL: "http://127.0.0.1:1234/v1",
    LMW_ALLOWED_MODELS: JSON.stringify([MODEL]),
  });
  const preferencesPath = resolveGlobalPreferencesPath({
    platform: process.platform,
    homeDirectory: home,
    environment,
  });
  await mkdir(path.dirname(preferencesPath), { recursive: true });
  await writeFile(
    preferencesPath,
    `${JSON.stringify({ schema_version: 1, default_model: MODEL })}\n`,
  );

  const runtime = await createMcpApplicationRuntime({
    environment,
    platform: process.platform,
    homeDirectory: home,
    operationalEvents: { record: () => Promise.resolve() },
  });
  assert.equal(runtime.startupConfiguration.lm_studio.authentication, "none");
  assert.equal(runtime.startupConfiguration.lm_studio.token_configured, false);
  assert.equal(runtime.bearerToken, undefined);
});

void test("creates the shared runtime from protected multi-provider settings", async (t) => {
  const baseUrl = await fakeLmStudio(t);
  const home = await mkdtemp(path.join(os.tmpdir(), "mcp-providers-"));
  t.after(async () => rm(home, { recursive: true, force: true }));
  const environment = stringEnvironment({
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    LMW_PROVIDERS: JSON.stringify([
      {
        name: "fallback",
        type: "localai",
        base_url: baseUrl,
        bearer_token: TOKEN,
        allowed_models: [MODEL],
        priority: 20,
      },
      {
        name: "primary",
        type: "vllm",
        base_url: baseUrl,
        bearer_token: TOKEN,
        allowed_models: [MODEL],
        priority: 10,
      },
    ]),
  });
  const preferencesPath = resolveGlobalPreferencesPath({
    platform: process.platform,
    homeDirectory: home,
    environment,
  });
  await mkdir(path.dirname(preferencesPath), { recursive: true });
  await writeFile(
    preferencesPath,
    `${JSON.stringify({ schema_version: 1, default_model: MODEL })}\n`,
  );

  const runtime = await createMcpApplicationRuntime({
    environment,
    platform: process.platform,
    homeDirectory: home,
    operationalEvents: { record: () => Promise.resolve() },
  });

  assert.deepEqual(
    runtime.providers.map((provider) => provider.name),
    ["primary", "fallback"],
  );
  assert.equal(runtime.inference.routeForModel(MODEL)?.name, "primary");
  assert.equal(
    JSON.stringify(runtime.startupConfiguration).includes(TOKEN),
    false,
  );
});

void test("serves all schema-validated tools over protocol-clean stdio", async (t) => {
  const baseUrl = await fakeLmStudio(t);
  const fixture = await applicationFixture(t, baseUrl);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [builtCli],
    cwd: process.cwd(),
    env: fixture.environment,
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const client = new Client(
    { name: "contract-test", version: "1.0.0" },
    { capabilities: {} },
  );
  try {
    await client.connect(transport);
  } catch (error: unknown) {
    throw new Error(`MCP child failed: ${stderr}`, { cause: error });
  }
  t.after(() => client.close());

  const tools = await client.listTools();
  assert.deepEqual(
    tools.tools.map((tool) => tool.name).sort(),
    Object.values(TOOL_NAMES).sort(),
  );
  assert.ok(tools.tools.every((tool) => typeof tool.inputSchema === "object"));
  assert.equal(
    tools.tools.some((tool) =>
      /shell|filesystem|prompt|execute/u.test(tool.name),
    ),
    false,
  );

  const invalidExploration = await client.callTool({
    name: TOOL_NAMES.exploreRepository,
    arguments: { goal: "", repository_root: fixture.repository },
  });
  assert.equal(invalidExploration.isError, true);

  const config = await client.callTool({
    name: TOOL_NAMES.getConfig,
    arguments: {},
  });
  const configOutput = object(config.structuredContent);
  assert.equal(object(configOutput.lm_studio).bearer_token, "[REDACTED]");
  assert.equal(Array.isArray(configOutput.providers), true);
  assert.equal(Array.isArray(configOutput.provider_status), true);
  assert.equal(object(configOutput.active_provider).name, "lm-studio");
  assert.equal(JSON.stringify(configOutput).includes(TOKEN), false);

  const health = await client.callTool({
    name: TOOL_NAMES.checkHealth,
    arguments: {},
  });
  assert.equal(object(health.structuredContent).status, "healthy");

  const progress: string[] = [];
  const exploration = await client.callTool(
    {
      name: TOOL_NAMES.exploreRepository,
      arguments: {
        goal: "Descreva o repositório",
        repository_root: fixture.repository,
        language: "pt-BR",
      },
    },
    {
      onprogress: (event) => {
        if (event.message !== undefined) progress.push(event.message);
      },
    },
  );
  assert.equal(
    exploration.isError,
    undefined,
    JSON.stringify(exploration.content),
  );
  const explorationOutput = object(exploration.structuredContent);
  assert.equal(explorationOutput.status, "completed");
  assert.equal(
    object(object(explorationOutput.result).summary).language,
    "pt-BR",
  );
  assert.ok(progress.includes("queued"));
  assert.ok(progress.includes("consulting_model"));

  const noProgress = await client.callTool({
    name: TOOL_NAMES.exploreRepository,
    arguments: {
      goal: "Descreva novamente",
      repository_root: fixture.repository,
      language: "pt-BR",
    },
  });
  assert.equal(
    object(noProgress.structuredContent).status,
    explorationOutput.status,
  );

  const proposal = await client.callTool({
    name: TOOL_NAMES.proposeTests,
    arguments: {
      goal: "Proponha testes",
      repository_root: fixture.repository,
      language: "pt-BR",
    },
  });
  const proposalOutput = object(proposal.structuredContent);
  assert.equal(proposalOutput.status, "blocked");
  assert.equal("result" in proposalOutput, false);

  const revision = configOutput.revision;
  assert.equal(typeof revision, "string");
  const validation = await client.callTool({
    name: TOOL_NAMES.validateConfig,
    arguments: {
      project_root: fixture.repository,
      expected_revision: revision,
      changes: { default_model: MODEL },
    },
  });
  assert.equal(object(validation.structuredContent).valid, true);

  const unconfirmed = await client.callTool({
    name: TOOL_NAMES.updateConfig,
    arguments: {
      project_root: fixture.repository,
      expected_revision: revision,
      changes: { limits: { max_concurrency: 1 } },
    },
  });
  assert.equal(unconfirmed.isError, true);

  const concurrent = await Promise.all([
    client.callTool({ name: TOOL_NAMES.getConfig, arguments: {} }),
    client.callTool({ name: TOOL_NAMES.checkHealth, arguments: {} }),
  ]);
  assert.equal(object(concurrent[0]?.structuredContent).schema_version, 1);
  assert.equal(object(concurrent[1]?.structuredContent).status, "healthy");

  const cancellation = new AbortController();
  const cancelledCall = client.callTool(
    {
      name: TOOL_NAMES.exploreRepository,
      arguments: {
        goal: "CANCEL_MARKER",
        repository_root: fixture.repository,
      },
    },
    { signal: cancellation.signal },
  );
  setTimeout(() => cancellation.abort(), 25);
  await assert.rejects(cancelledCall);
  const afterCancellation = await client.callTool({
    name: TOOL_NAMES.exploreRepository,
    arguments: {
      goal: "Capacity was released",
      repository_root: fixture.repository,
    },
  });
  assert.equal(object(afterCancellation.structuredContent).status, "completed");
  assert.equal(stderr, "");
});

void test("advertises only selected feature tools plus administrative tools", async (t) => {
  const baseUrl = await fakeLmStudio(t);
  const fixture = await applicationFixture(t, baseUrl, ["docs"]);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [builtCli],
    cwd: process.cwd(),
    env: fixture.environment,
    stderr: "pipe",
  });
  const client = new Client(
    { name: "feature-selection-test", version: "1.0.0" },
    { capabilities: {} },
  );
  await client.connect(transport);
  t.after(() => client.close());

  const tools = await client.listTools();
  assert.deepEqual(
    tools.tools.map((tool) => tool.name).sort(),
    [
      ...FEATURE_TOOL_NAMES.docs,
      TOOL_NAMES.checkHealth,
      TOOL_NAMES.getConfig,
      TOOL_NAMES.getOffloadStats,
      TOOL_NAMES.updateConfig,
      TOOL_NAMES.validateConfig,
    ].sort(),
  );
});

async function applicationFixture(
  t: test.TestContext,
  baseUrl: string,
  enabledFeatures?: readonly string[],
) {
  const home = await mkdtemp(path.join(os.tmpdir(), "mcp-app-"));
  const repository = path.join(home, "repository");
  await mkdir(repository);
  t.after(() => rm(home, { recursive: true, force: true }));
  const environment = stringEnvironment({
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, "config"),
    XDG_STATE_HOME: path.join(home, "state"),
    APPDATA: path.win32.join(home, "AppData", "Roaming"),
    LOCALAPPDATA: path.win32.join(home, "AppData", "Local"),
    LMW_LM_STUDIO_BASE_URL: baseUrl,
    LMW_LM_STUDIO_BEARER_TOKEN: TOKEN,
    LMW_ALLOWED_MODELS: JSON.stringify([MODEL]),
  });
  const preferencesPath = resolveGlobalPreferencesPath({
    platform: process.platform,
    homeDirectory: home,
    environment,
  });
  await mkdir(path.dirname(preferencesPath), { recursive: true });
  await writeFile(
    preferencesPath,
    `${JSON.stringify({
      schema_version: 1,
      default_model: MODEL,
      ...(enabledFeatures === undefined
        ? {}
        : { enabled_features: enabledFeatures }),
    })}\n`,
  );
  return { environment, repository };
}

async function fakeLmStudio(t: test.TestContext): Promise<string> {
  const server = createServer((request, response) => {
    void handleLmRequest(request, response).catch(() => response.destroy());
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        );
      }),
  );
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  return `http://127.0.0.1:${address.port}/v1`;
}

async function handleLmRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.headers.authorization !== `Bearer ${TOKEN}`) {
    json(response, 401, { error: { message: "unauthorized" } });
    return;
  }
  if (request.url === "/v1/models") {
    json(response, 200, { data: [{ id: MODEL }] });
    return;
  }
  const chunks: Buffer[] = [];
  for await (const untrustedChunk of request) {
    const chunk: unknown = untrustedChunk;
    if (typeof chunk !== "string" && !Buffer.isBuffer(chunk)) {
      throw new TypeError("Unexpected request body chunk.");
    }
    chunks.push(Buffer.from(chunk));
  }
  const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
    response_format?: { json_schema?: { name?: string } };
  };
  const outputName = payload.response_format?.json_schema?.name;
  if (outputName !== "repository_exploration_step") {
    json(response, 400, { error: { message: "unexpected schema" } });
    return;
  }
  if (Buffer.concat(chunks).includes("CANCEL_MARKER")) {
    await new Promise<void>((resolve) => {
      request.once("aborted", resolve);
      setTimeout(resolve, 1_000);
    });
    if (response.destroyed) return;
  }
  json(response, 200, {
    model: MODEL,
    choices: [
      {
        finish_reason: "stop",
        message: {
          content: JSON.stringify({
            action: "finalize",
            summary: "Análise concluída localmente.",
            relevant_files: [],
            evidence: [],
            risks: [],
            next_steps: [],
          }),
        },
      },
    ],
    usage: {
      prompt_tokens: 5,
      completion_tokens: 3,
      total_tokens: 8,
      completion_tokens_details: { reasoning_tokens: 0 },
    },
  });
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

function stringEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}
