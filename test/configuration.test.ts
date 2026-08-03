import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ADMINISTRATIVE_MAXIMA,
  BUILT_IN_LIMITS,
  ConfigurationError,
  FEATURE_GROUPS,
  getConfig,
  getEffectiveConfiguration,
  resolveGlobalPreferencesPath,
  resolveModelForTask,
} from "../src/features/configuration/index.js";

const protectedEnvironment = {
  LMW_LM_STUDIO_BASE_URL: "http://127.0.0.1:1234/v1",
  LMW_LM_STUDIO_BEARER_TOKEN: "super-secret-token",
  LMW_ALLOWED_MODELS: '["qwen/test-model","another/model"]',
};

void test("loads built-in defaults and returns a redacted effective view", async (t) => {
  const fixture = await createFixture(t);
  await fixture.writeGlobal({
    schema_version: 1,
    default_model: "qwen/test-model",
  });

  const snapshot = await getEffectiveConfiguration(fixture.input());
  const view = await getConfig(fixture.input());

  assert.deepEqual(snapshot.limits, BUILT_IN_LIMITS);
  assert.deepEqual(snapshot.enabled_features, FEATURE_GROUPS);
  assert.equal(snapshot.lm_studio.base_url, "http://127.0.0.1:1234/v1");
  assert.deepEqual(snapshot.lm_studio.allowed_models, [
    "another/model",
    "qwen/test-model",
  ]);
  assert.equal(snapshot.origins["lm_studio.default_model"], "global");
  assert.equal(snapshot.origins["limits.max_concurrency"], "built_in");
  assert.equal(view.lm_studio.bearer_token, "[REDACTED]");
  assert.equal(JSON.stringify(snapshot).includes("super-secret-token"), false);
  assert.equal(JSON.stringify(view).includes("super-secret-token"), false);
  assert.match(snapshot.revision, /^sha256:[a-f0-9]{64}$/);
});

void test("loads enabled MCP features from global preferences only", async (t) => {
  const fixture = await createFixture(t);
  await fixture.writeGlobal({
    schema_version: 1,
    default_model: "qwen/test-model",
    enabled_features: ["docs", "tests"],
  });

  const snapshot = await getEffectiveConfiguration(fixture.input());

  assert.deepEqual(snapshot.enabled_features, ["docs", "tests"]);
});

void test("loads protected multi-provider configuration without exposing tokens", async (t) => {
  const fixture = await createFixture(t);
  await fixture.writeGlobal({
    schema_version: 1,
    default_model: "shared/model",
  });
  const providerToken = "provider-secret-fixture";
  const environment = {
    LMW_PROVIDERS: JSON.stringify([
      {
        name: "backup",
        type: "ollama",
        base_url: "http://127.0.0.1:11434",
        allowed_models: ["shared/model"],
        priority: 20,
      },
      {
        name: "primary",
        type: "vllm",
        base_url: "http://127.0.0.1:8000/v1",
        bearer_token: providerToken,
        allowed_models: ["shared/model", "special/model"],
        priority: 10,
      },
    ]),
    LMW_PROVIDER_RECHECK_INTERVAL_MS: "2500",
  };

  const snapshot = await getEffectiveConfiguration({
    ...fixture.input(),
    environment,
  });
  const view = await getConfig({ ...fixture.input(), environment });

  assert.deepEqual(
    snapshot.providers?.map((provider) => [
      provider.name,
      provider.type,
      provider.priority,
      provider.token_configured,
    ]),
    [
      ["primary", "vllm", 10, true],
      ["backup", "ollama", 20, false],
    ],
  );
  assert.deepEqual(snapshot.lm_studio.allowed_models, [
    "shared/model",
    "special/model",
  ]);
  assert.equal(snapshot.provider_routing?.recheck_interval_ms, 2500);
  assert.equal(JSON.stringify(snapshot).includes(providerToken), false);
  assert.equal(JSON.stringify(view).includes(providerToken), false);
});

void test("rejects malformed, duplicate, and unsafe provider configuration", async (t) => {
  const fixture = await createFixture(t);
  await fixture.writeGlobal({
    schema_version: 1,
    default_model: "shared/model",
  });
  const invalidProviders = [
    [],
    [
      {
        name: "duplicate",
        type: "vllm",
        base_url: "http://127.0.0.1:8000/v1",
        allowed_models: ["shared/model"],
        priority: 0,
      },
      {
        name: "duplicate",
        type: "ollama",
        base_url: "http://127.0.0.1:11434",
        allowed_models: ["shared/model"],
        priority: 1,
      },
    ],
    [
      {
        name: "unsafe",
        type: "localai",
        base_url: "http://user:password@127.0.0.1/v1",
        allowed_models: ["shared/model"],
        priority: 0,
      },
    ],
  ];

  for (const providers of invalidProviders) {
    await assert.rejects(
      getEffectiveConfiguration({
        ...fixture.input(),
        environment: { LMW_PROVIDERS: JSON.stringify(providers) },
      }),
      /provider configuration|provider base URL|Protected provider URLs/,
    );
  }
  await assert.rejects(
    getEffectiveConfiguration({
      ...fixture.input(),
      environment: {
        LMW_PROVIDERS: JSON.stringify([
          {
            name: "valid",
            type: "localai",
            base_url: "http://127.0.0.1/v1",
            allowed_models: ["shared/model"],
            priority: 0,
          },
        ]),
        LMW_PROVIDER_RECHECK_INTERVAL_MS: "0",
      },
    }),
    /recheck interval/,
  );
});

void test("rejects enabled MCP features in project preferences", async (t) => {
  const fixture = await createFixture(t);
  await fixture.writeGlobal({
    schema_version: 1,
    default_model: "qwen/test-model",
  });
  await fixture.writeProject({
    schema_version: 1,
    enabled_features: ["docs"],
  });

  await assert.rejects(
    getEffectiveConfiguration(fixture.input(true)),
    /project preferences file is malformed or contains unsupported fields/,
  );
});

void test("supports LM Studio without optional Bearer authentication", async (t) => {
  const fixture = await createFixture(t);
  await fixture.writeGlobal({
    schema_version: 1,
    default_model: "qwen/test-model",
  });
  const environment = {
    ...protectedEnvironment,
    LMW_LM_STUDIO_BEARER_TOKEN: "   ",
  };

  const snapshot = await getEffectiveConfiguration({
    ...fixture.input(),
    environment,
  });
  const view = await getConfig({ ...fixture.input(), environment });

  assert.equal(snapshot.lm_studio.authentication, "none");
  assert.equal(snapshot.lm_studio.token_configured, false);
  assert.equal(view.lm_studio.bearer_token, null);
});

void test("supports missing LMW_ALLOWED_MODELS environment variable with wildcard default", async (t) => {
  const fixture = await createFixture(t);
  await fixture.writeGlobal({
    schema_version: 1,
    default_model: "any/model",
  });
  const environment = {
    LMW_LM_STUDIO_BASE_URL: "http://127.0.0.1:1234/v1",
  };

  const snapshot = await getEffectiveConfiguration({
    ...fixture.input(),
    environment,
  });

  assert.deepEqual(snapshot.lm_studio.allowed_models, ["*"]);
});

void test("applies project over global over built-in precedence with field origins", async (t) => {
  const fixture = await createFixture(t);
  await fixture.writeGlobal({
    schema_version: 1,
    default_model: "another/model",
    limits: {
      max_concurrency: 3,
      queue_timeout_ms: 400_000,
      processing_timeout_ms: 700_000,
      max_exploration_interactions: 20,
      context_budget_bytes: 300_000,
    },
  });
  await fixture.writeProject({
    schema_version: 1,
    default_model: "qwen/test-model",
    limits: { max_concurrency: 4, queue_timeout_ms: 500_000 },
  });

  const snapshot = await getEffectiveConfiguration(fixture.input(true));

  assert.equal(snapshot.lm_studio.default_model, "qwen/test-model");
  assert.equal(snapshot.limits.max_concurrency, 4);
  assert.equal(snapshot.limits.queue_timeout_ms, 500_000);
  assert.equal(snapshot.limits.processing_timeout_ms, 700_000);
  assert.equal(snapshot.origins["lm_studio.default_model"], "project");
  assert.equal(snapshot.origins["limits.max_concurrency"], "project");
  assert.equal(snapshot.origins["limits.processing_timeout_ms"], "global");
  assert.equal(
    snapshot.origins["administrative_maxima.max_concurrency"],
    "protected",
  );
});

void test("allows project preferences to supply the required default model", async (t) => {
  const fixture = await createFixture(t);
  await fixture.writeProject({
    schema_version: 1,
    default_model: "qwen/test-model",
  });

  const snapshot = await getEffectiveConfiguration(fixture.input(true));

  assert.equal(snapshot.lm_studio.default_model, "qwen/test-model");
  assert.equal(snapshot.origins["lm_studio.default_model"], "project");
  assert.deepEqual(snapshot.limits, BUILT_IN_LIMITS);
});

void test("resolves model routing with project over global precedence and default fallback", async (t) => {
  const fixture = await createFixture(t);
  await fixture.writeGlobal({
    schema_version: 1,
    default_model: "qwen/test-model",
    model_routing: {
      exploration: "another/model",
      summarization: "another/model",
      code_graph: "another/model",
    },
  });
  await fixture.writeProject({
    schema_version: 1,
    default_model: "qwen/test-model",
    model_routing: {
      exploration: "qwen/test-model",
      lint_fix: "qwen/test-model",
    },
  });

  const snapshot = await getEffectiveConfiguration(fixture.input(true));

  assert.deepEqual(snapshot.lm_studio.model_routing, {
    exploration: "qwen/test-model",
    summarization: "another/model",
    code_graph: "another/model",
    lint_fix: "qwen/test-model",
  });
  assert.equal(resolveModelForTask(snapshot, "exploration"), "qwen/test-model");
  assert.equal(resolveModelForTask(snapshot, "summarization"), "another/model");
  assert.equal(
    resolveModelForTask(snapshot, "test_proposal"),
    "qwen/test-model",
  );
  assert.equal(resolveModelForTask(snapshot, "embedding"), "qwen/test-model");
  assert.equal(
    snapshot.origins["lm_studio.model_routing.exploration"],
    "project",
  );
  assert.equal(
    snapshot.origins["lm_studio.model_routing.summarization"],
    "global",
  );
  assert.equal(
    snapshot.origins["lm_studio.model_routing.test_proposal"],
    "built_in",
  );
});

void test("folds the legacy embedding model into the embedding routing slot", async (t) => {
  const fixture = await createFixture(t);
  await fixture.writeGlobal({
    schema_version: 1,
    default_model: "qwen/test-model",
    embedding_model: "another/model",
  });

  const snapshot = await getEffectiveConfiguration(fixture.input());

  assert.equal(snapshot.lm_studio.embedding_model, "another/model");
  assert.equal(snapshot.lm_studio.model_routing?.embedding, "another/model");
  assert.equal(resolveModelForTask(snapshot, "embedding"), "another/model");
});

void test("lets an explicit embedding routing entry override the legacy embedding model", async (t) => {
  const fixture = await createFixture(t);
  await fixture.writeGlobal({
    schema_version: 1,
    default_model: "qwen/test-model",
    embedding_model: "another/model",
    model_routing: { embedding: "qwen/test-model" },
  });

  const snapshot = await getEffectiveConfiguration(fixture.input());

  assert.equal(snapshot.lm_studio.model_routing?.embedding, "qwen/test-model");
  assert.equal(resolveModelForTask(snapshot, "embedding"), "qwen/test-model");
});

void test("rejects routing entries that reference unauthorized models", async (t) => {
  const fixture = await createFixture(t);
  await fixture.writeGlobal({
    schema_version: 1,
    default_model: "qwen/test-model",
    model_routing: { exploration: "blocked/model" },
  });

  await assert.rejects(
    getEffectiveConfiguration(fixture.input()),
    isConfigurationError("invalid_configuration"),
  );
});

void test("permits any routed model under a wildcard allowed-model policy", async (t) => {
  const fixture = await createFixture(t);
  await fixture.writeGlobal({
    schema_version: 1,
    default_model: "any/model",
    model_routing: { exploration: "anything/else", lint_fix: "third/one" },
  });
  const environment = {
    LMW_LM_STUDIO_BASE_URL: "http://127.0.0.1:1234/v1",
  };

  const snapshot = await getEffectiveConfiguration({
    ...fixture.input(),
    environment,
  });

  assert.equal(snapshot.lm_studio.model_routing?.exploration, "anything/else");
  assert.equal(snapshot.lm_studio.model_routing?.lint_fix, "third/one");
});

void test("exposes effective model routing in the redacted configuration view", async (t) => {
  const fixture = await createFixture(t);
  await fixture.writeGlobal({
    schema_version: 1,
    default_model: "qwen/test-model",
    model_routing: { exploration: "another/model" },
  });

  const view = await getConfig(fixture.input());

  assert.deepEqual(view.lm_studio.model_routing, {
    exploration: "another/model",
  });
  assert.equal(JSON.stringify(view).includes("mutation-secret-token"), false);
});

void test("rejects unknown, malformed, wrong-type, and out-of-range preferences", async (t) => {
  const invalidPreferences: readonly unknown[] = [
    { schema_version: 1, default_model: "qwen/test-model", unknown: true },
    {
      schema_version: 1,
      default_model: "qwen/test-model",
      lm_studio: { base_url: "http://attacker.invalid" },
    },
    {
      schema_version: 1,
      default_model: "qwen/test-model",
      administrative_maxima: { max_concurrency: 100 },
    },
    { schema_version: 1, default_model: 42 },
    {
      schema_version: 1,
      default_model: "qwen/test-model",
      limits: { max_concurrency: ADMINISTRATIVE_MAXIMA.max_concurrency + 1 },
    },
    {
      schema_version: 1,
      default_model: "qwen/test-model",
      unknown: true,
    },
    {
      schema_version: 1,
      default_model: "qwen/test-model",
      model_routing: { unknown_task: "qwen/test-model" },
    },
  ];

  for (const [index, preferences] of invalidPreferences.entries()) {
    await t.test(`invalid preferences ${index + 1}`, async (nested) => {
      const fixture = await createFixture(nested);
      await fixture.writeGlobal(preferences);
      await assert.rejects(
        getEffectiveConfiguration(fixture.input()),
        isConfigurationError("invalid_configuration"),
      );
    });
  }

  await t.test("invalid JSON", async (nested) => {
    const fixture = await createFixture(nested);
    await fixture.writeRawGlobal("{not-json");
    await assert.rejects(
      getEffectiveConfiguration(fixture.input()),
      isConfigurationError("invalid_configuration"),
    );
  });
});

void test("requires valid protected settings and never repeats their raw values", async (t) => {
  const fixture = await createFixture(t);
  await fixture.writeGlobal({
    schema_version: 1,
    default_model: "qwen/test-model",
  });

  const invalidEnvironments: readonly Record<string, string | undefined>[] = [
    { ...protectedEnvironment, LMW_LM_STUDIO_BASE_URL: undefined },
    { ...protectedEnvironment, LMW_LM_STUDIO_BASE_URL: "file:///tmp/model" },
    { ...protectedEnvironment, LMW_ALLOWED_MODELS: "not-json" },
    {
      ...protectedEnvironment,
      LMW_ALLOWED_MODELS: '["duplicate","duplicate"]',
    },
  ];

  for (const environment of invalidEnvironments) {
    let caught: unknown;
    try {
      await getEffectiveConfiguration({ ...fixture.input(), environment });
    } catch (error: unknown) {
      caught = error;
    }
    assert.ok(caught instanceof ConfigurationError);
    assert.equal(caught.code, "invalid_configuration");
    assert.equal(caught.message.includes("super-secret-token"), false);
  }
});

void test("requires a globally or locally configured allowlisted default model", async (t) => {
  const fixture = await createFixture(t);

  await assert.rejects(
    getEffectiveConfiguration(fixture.input()),
    isConfigurationError("invalid_configuration"),
  );

  await fixture.writeGlobal({
    schema_version: 1,
    default_model: "blocked/model",
  });
  await assert.rejects(
    getEffectiveConfiguration(fixture.input()),
    isConfigurationError("invalid_configuration"),
  );
});

void test("validates the project root and blocks an escaping preferences symlink", async (t) => {
  const fixture = await createFixture(t);
  await fixture.writeGlobal({
    schema_version: 1,
    default_model: "qwen/test-model",
  });

  await assert.rejects(
    getEffectiveConfiguration({
      ...fixture.input(),
      projectRoot: path.join(fixture.root, "missing-project"),
    }),
    isConfigurationError("repository_not_found"),
  );

  const outsidePreferences = path.join(fixture.root, "outside.json");
  await writeFile(
    outsidePreferences,
    JSON.stringify({ schema_version: 1, default_model: "qwen/test-model" }),
  );
  await symlink(
    outsidePreferences,
    path.join(fixture.projectRoot, ".local-model-workers.json"),
  );

  await assert.rejects(
    getEffectiveConfiguration(fixture.input(true)),
    isConfigurationError("repository_access_denied"),
  );
});

void test("produces deterministic secret-independent revisions", async (t) => {
  const fixture = await createFixture(t);
  await fixture.writeGlobal({
    schema_version: 1,
    default_model: "qwen/test-model",
  });

  const first = await getEffectiveConfiguration(fixture.input());
  const second = await getEffectiveConfiguration(fixture.input());
  const rotatedToken = await getEffectiveConfiguration({
    ...fixture.input(),
    environment: {
      ...protectedEnvironment,
      LMW_LM_STUDIO_BEARER_TOKEN: "rotated-secret-token",
    },
  });

  assert.equal(first.revision, second.revision);
  assert.equal(first.revision, rotatedToken.revision);
  const withoutToken = await getEffectiveConfiguration({
    ...fixture.input(),
    environment: {
      ...protectedEnvironment,
      LMW_LM_STUDIO_BEARER_TOKEN: undefined,
    },
  });
  assert.notEqual(first.revision, withoutToken.revision);
  assert.equal(first.revision.includes("super-secret-token"), false);
});

void test("returns a deeply immutable task-ready snapshot", async (t) => {
  const fixture = await createFixture(t);
  await fixture.writeGlobal({
    schema_version: 1,
    default_model: "qwen/test-model",
  });
  const snapshot = await getEffectiveConfiguration(fixture.input());

  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.limits), true);
  assert.equal(Object.isFrozen(snapshot.lm_studio.allowed_models), true);
  assert.throws(() => {
    Object.assign(snapshot.limits, { max_concurrency: 99 });
  }, TypeError);
});

void test("resolves platform-standard global preference paths without real profiles", () => {
  assert.equal(
    resolveGlobalPreferencesPath({
      platform: "darwin",
      homeDirectory: "/Users/tester",
      environment: {},
    }),
    "/Users/tester/Library/Application Support/local-model-workers/preferences.json",
  );
  assert.equal(
    resolveGlobalPreferencesPath({
      platform: "linux",
      homeDirectory: "/home/tester",
      environment: { XDG_CONFIG_HOME: "/custom/config" },
    }),
    "/custom/config/local-model-workers/preferences.json",
  );
  assert.equal(
    resolveGlobalPreferencesPath({
      platform: "win32",
      homeDirectory: "C:\\Users\\tester",
      environment: { APPDATA: "D:\\Profiles\\tester" },
    }),
    "D:\\Profiles\\tester\\local-model-workers\\preferences.json",
  );
});

interface Fixture {
  readonly root: string;
  readonly projectRoot: string;
  input(includeProject?: boolean): {
    environment: typeof protectedEnvironment;
    platform: "darwin";
    homeDirectory: string;
    projectRoot?: string;
  };
  writeGlobal(value: unknown): Promise<void>;
  writeRawGlobal(value: string): Promise<void>;
  writeProject(value: unknown): Promise<void>;
}

async function createFixture(t: test.TestContext): Promise<Fixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lmw-configuration-"));
  const homeDirectory = path.join(root, "home");
  const projectRoot = path.join(root, "project");
  const globalPath = resolveGlobalPreferencesPath({
    platform: "darwin",
    homeDirectory,
    environment: protectedEnvironment,
  });
  const projectPath = path.join(projectRoot, ".local-model-workers.json");
  await mkdir(homeDirectory, { recursive: true });
  await mkdir(projectRoot, { recursive: true });
  t.after(async () => rm(root, { recursive: true, force: true }));

  async function writeRawGlobal(value: string): Promise<void> {
    await mkdir(path.dirname(globalPath), { recursive: true });
    await writeFile(globalPath, value, "utf8");
  }

  return {
    root,
    projectRoot,
    input(includeProject = false) {
      return {
        environment: protectedEnvironment,
        platform: "darwin",
        homeDirectory,
        ...(includeProject ? { projectRoot } : {}),
      };
    },
    async writeGlobal(value: unknown) {
      await writeRawGlobal(JSON.stringify(value));
    },
    writeRawGlobal,
    async writeProject(value: unknown) {
      await writeFile(projectPath, JSON.stringify(value), "utf8");
    },
  };
}

function isConfigurationError(code: string): (error: unknown) => boolean {
  return (error: unknown) =>
    error instanceof ConfigurationError && error.code === code;
}
