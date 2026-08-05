import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  BUILT_IN_LIMITS,
  CONFIGURATION_PROFILES,
  PreferencesSchema,
  getEffectiveConfiguration,
  resolveGlobalPreferencesPath,
  updateConfig,
  validateConfig,
  type GetConfigurationInput,
} from "../src/features/configuration/index.js";

const protectedEnvironment = {
  LMW_LM_STUDIO_BASE_URL: "http://127.0.0.1:1234/v1",
  LMW_LM_STUDIO_BEARER_TOKEN: "profile-mutation-secret-token",
  LMW_ALLOWED_MODELS: '["qwen/test-model","another/model"]',
};

void test("CONFIGURATION_PROFILES lists approved profile names", () => {
  assert.deepEqual(CONFIGURATION_PROFILES, ["fast", "thorough", "balanced"]);
});

void test("PreferencesSchema accepts profile property", () => {
  const parsed = PreferencesSchema.parse({
    schema_version: 1,
    profile: "fast",
  });

  assert.equal(parsed.profile, "fast");
});

void test("PreferencesSchema rejects invalid profile property", () => {
  assert.throws(() =>
    PreferencesSchema.parse({
      schema_version: 1,
      profile: "invalid_profile",
    }),
  );
});

void test("profile resolves project over global over the balanced default", async (t) => {
  const fixture = await createProfileFixture(t);

  const absent = await getEffectiveConfiguration(fixture.input());
  assert.equal(absent.profile, "balanced");
  assert.equal(absent.origins.profile, "built_in");

  await fixture.writeGlobal({ schema_version: 1, profile: "fast" });
  const globalOnly = await getEffectiveConfiguration(fixture.input());
  assert.equal(globalOnly.profile, "fast");
  assert.equal(globalOnly.origins.profile, "global");

  await fixture.writeProject({ schema_version: 1, profile: "thorough" });
  const projectWins = await getEffectiveConfiguration(fixture.input());
  assert.equal(projectWins.profile, "thorough");
  assert.equal(projectWins.origins.profile, "project");
});

void test("preset limits apply when the profile is active", async (t) => {
  const fixture = await createProfileFixture(t);
  await fixture.writeGlobal({ schema_version: 1, profile: "fast" });

  const config = await getEffectiveConfiguration(fixture.input());
  assert.equal(config.limits.max_concurrency, 4);
  assert.equal(config.limits.max_exploration_interactions, 6);
  assert.equal(config.limits.context_budget_bytes, 96 * 1_024);
});

void test("explicit limits beat preset values at the same layer", async (t) => {
  const fixture = await createProfileFixture(t);
  await fixture.writeGlobal({
    schema_version: 1,
    profile: "fast",
    limits: { max_concurrency: 2 },
  });

  const config = await getEffectiveConfiguration(fixture.input());
  assert.equal(config.limits.max_concurrency, 2);
  assert.equal(config.origins["limits.max_concurrency"], "global");
  assert.equal(config.limits.max_exploration_interactions, 6);
});

void test("project explicit limits beat project profile presets", async (t) => {
  const fixture = await createProfileFixture(t);
  await fixture.writeProject({
    schema_version: 1,
    profile: "fast",
    limits: { max_concurrency: 1 },
  });

  const config = await getEffectiveConfiguration(fixture.input());
  assert.equal(config.limits.max_concurrency, 1);
  assert.equal(config.origins["limits.max_concurrency"], "project");
  assert.equal(config.limits.max_exploration_interactions, 6);
});

void test("update_config switches profiles at runtime without a restart", async (t) => {
  const fixture = await createProfileFixture(t);
  await fixture.writeGlobal({
    schema_version: 1,
    default_model: "qwen/test-model",
  });
  await fixture.writeProject({ schema_version: 1, profile: "thorough" });

  const before = await getEffectiveConfiguration(fixture.input());
  assert.equal(before.profile, "thorough");
  assert.equal(before.limits.processing_timeout_ms, 20 * 60_000);

  const proposal = await validateConfig({
    ...fixture.input(),
    expected_revision: before.revision,
    changes: { profile: "fast" },
  });
  assert.equal(proposal.valid, true);
  if (!proposal.valid) return;

  const updated = await updateConfig({
    ...fixture.input(),
    expected_revision: before.revision,
    changes: { profile: "fast" },
    confirmation: { approved: true, proposal_id: proposal.proposal_id },
  });

  assert.equal(updated.configuration.profile, "fast");
  assert.equal(updated.configuration.limits.processing_timeout_ms, 2 * 60_000);

  const after = await getEffectiveConfiguration(fixture.input());
  assert.equal(after.profile, "fast");
  assert.equal(after.limits.max_concurrency, 4);
  assert.equal(after.origins.profile, "project");
  assert.notEqual(after.revision, before.revision);
});

void test("removing the profile falls back to the global preset", async (t) => {
  const fixture = await createProfileFixture(t);
  await fixture.writeGlobal({ schema_version: 1, profile: "thorough" });
  await fixture.writeProject({ schema_version: 1, profile: "fast" });

  const current = await getEffectiveConfiguration(fixture.input());
  assert.equal(current.profile, "fast");

  const proposal = await validateConfig({
    ...fixture.input(),
    expected_revision: current.revision,
    changes: { profile: null },
  });
  assert.equal(proposal.valid, true);
  if (!proposal.valid) return;

  const updated = await updateConfig({
    ...fixture.input(),
    expected_revision: current.revision,
    changes: { profile: null },
    confirmation: { approved: true, proposal_id: proposal.proposal_id },
  });

  assert.equal(updated.configuration.profile, "thorough");
  assert.equal(updated.configuration.limits.max_exploration_interactions, 30);
});

async function createProfileFixture(t: test.TestContext): Promise<{
  readonly input: () => GetConfigurationInput & { projectRoot: string };
  writeGlobal(value: unknown): Promise<void>;
  writeProject(value: unknown): Promise<void>;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lmw-profiles-"));
  const homeDirectory = path.join(root, "home");
  const projectRoot = path.join(root, "project");
  const projectPath = path.join(projectRoot, ".local-model-workers.json");
  const globalPath = resolveGlobalPreferencesPath({
    platform: "darwin",
    homeDirectory,
    environment: protectedEnvironment,
  });
  await mkdir(path.dirname(globalPath), { recursive: true });
  await mkdir(projectRoot, { recursive: true });
  await writeFile(
    globalPath,
    `${JSON.stringify({ schema_version: 1, default_model: "qwen/test-model" })}\n`,
    "utf8",
  );
  t.after(() => rm(root, { recursive: true, force: true }));

  return {
    input: () => ({
      environment: protectedEnvironment,
      platform: "darwin" as const,
      homeDirectory,
      projectRoot,
    }),
    writeGlobal: async (value) =>
      writeFile(
        globalPath,
        `${JSON.stringify({
          schema_version: 1,
          default_model: "qwen/test-model",
          ...(value as object),
        })}\n`,
        "utf8",
      ),
    writeProject: async (value) =>
      writeFile(projectPath, `${JSON.stringify(value)}\n`, "utf8"),
  };
}

void test("BUILT_IN_LIMITS remains the fallback when no profile sets a limit", () => {
  assert.equal(BUILT_IN_LIMITS.max_concurrency, 2);
  assert.equal(BUILT_IN_LIMITS.processing_timeout_ms, 600_000);
});
