import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ConfigurationError,
  getEffectiveConfiguration,
  resolveGlobalPreferencesPath,
  updateConfig,
  validateConfig,
  type UpdateConfigurationInput,
} from "../src/features/configuration/index.js";
import { writeConfigurationFileAtomically } from "../src/features/configuration/mutation.js";

const protectedEnvironment = {
  LMW_LM_STUDIO_BASE_URL: "http://127.0.0.1:1234/v1",
  LMW_LM_STUDIO_BEARER_TOKEN: "mutation-secret-token",
  LMW_ALLOWED_MODELS: '["qwen/test-model","another/model"]',
};

void test("validates a proposal without writing and binds approval to it", async (t) => {
  const fixture = await createFixture(t);
  const current = await fixture.snapshot();

  const result = await validateConfig({
    ...fixture.input(),
    expected_revision: current.revision,
    changes: { limits: { max_concurrency: 3 } },
  });

  assert.equal(result.valid, true);
  if (!result.valid) return;
  assert.equal(result.changes.length, 1);
  assert.deepEqual(result.changes[0], {
    field: "limits.max_concurrency",
    old_value: 2,
    new_value: 3,
    old_origin: "built_in",
    new_origin: "project",
  });
  assert.equal(result.proposed_configuration.limits.max_concurrency, 3);
  assert.match(result.proposal_id, /^sha256:[a-f0-9]{64}$/);
  await assert.rejects(
    readFile(fixture.projectPath, "utf8"),
    hasCode("ENOENT"),
  );
});

void test("requires matching explicit confirmation without changing bytes", async (t) => {
  const fixture = await createFixture(t);
  await fixture.writeProject({
    schema_version: 1,
    default_model: "qwen/test-model",
    limits: { max_concurrency: 2 },
  });
  const before = await readFile(fixture.projectPath, "utf8");
  const current = await fixture.snapshot();
  const proposal = await fixture.validate(current.revision, {
    limits: { max_concurrency: 3 },
  });
  assert.equal(proposal.valid, true);
  if (!proposal.valid) return;

  await assert.rejects(
    updateConfig({
      ...fixture.input(),
      expected_revision: current.revision,
      changes: { limits: { max_concurrency: 3 } },
    }),
    isConfigurationError("confirmation_required"),
  );
  await assert.rejects(
    updateConfig({
      ...fixture.input(),
      expected_revision: current.revision,
      changes: { limits: { max_concurrency: 3 } },
      confirmation: {
        approved: true,
        proposal_id: `sha256:${"0".repeat(64)}`,
      },
    }),
    isConfigurationError("confirmation_required"),
  );
  assert.equal(await readFile(fixture.projectPath, "utf8"), before);
});

void test("atomically updates project preferences and preserves old snapshots", async (t) => {
  const fixture = await createFixture(t);
  const activeSnapshot = await fixture.snapshot();
  const proposal = await fixture.validate(activeSnapshot.revision, {
    default_model: "another/model",
    limits: { max_concurrency: 4, context_budget_bytes: 500_000 },
  });
  assert.equal(proposal.valid, true);
  if (!proposal.valid) return;

  const result = await updateConfig({
    ...fixture.input(),
    expected_revision: activeSnapshot.revision,
    changes: {
      default_model: "another/model",
      limits: { max_concurrency: 4, context_budget_bytes: 500_000 },
    },
    confirmation: { approved: true, proposal_id: proposal.proposal_id },
  });

  assert.equal(result.updated, true);
  assert.notEqual(result.new_revision, activeSnapshot.revision);
  assert.equal(result.configuration.lm_studio.default_model, "another/model");
  assert.equal(result.configuration.limits.max_concurrency, 4);
  assert.equal(activeSnapshot.lm_studio.default_model, "qwen/test-model");
  assert.equal(activeSnapshot.limits.max_concurrency, 2);
  assert.equal(activeSnapshot.revision, result.old_revision);
  assert.equal((await stat(fixture.projectPath)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(fixture.projectPath, "utf8")), {
    schema_version: 1,
    default_model: "another/model",
    limits: { max_concurrency: 4, context_budget_bytes: 500_000 },
  });
});

void test("rejects stale revisions and leaves the current file unchanged", async (t) => {
  const fixture = await createFixture(t);
  const original = await fixture.snapshot();
  const firstProposal = await fixture.validate(original.revision, {
    limits: { max_concurrency: 3 },
  });
  assert.equal(firstProposal.valid, true);
  if (!firstProposal.valid) return;

  await updateConfig({
    ...fixture.input(),
    expected_revision: original.revision,
    changes: { limits: { max_concurrency: 3 } },
    confirmation: { approved: true, proposal_id: firstProposal.proposal_id },
  });
  const beforeStaleAttempt = await readFile(fixture.projectPath, "utf8");

  const validation = await fixture.validate(original.revision, {
    limits: { max_concurrency: 4 },
  });
  assert.equal(validation.valid, false);
  if (validation.valid) return;
  assert.equal(validation.errors[0]?.code, "configuration_conflict");

  await assert.rejects(
    updateConfig({
      ...fixture.input(),
      expected_revision: original.revision,
      changes: { limits: { max_concurrency: 3 } },
      confirmation: { approved: true, proposal_id: firstProposal.proposal_id },
    }),
    isConfigurationError("configuration_conflict"),
  );
  assert.equal(await readFile(fixture.projectPath, "utf8"), beforeStaleAttempt);
});

void test("rejects protected, unknown, invalid, empty, and no-op proposals", async (t) => {
  const fixture = await createFixture(t);
  await fixture.writeProject({
    schema_version: 1,
    default_model: "qwen/test-model",
  });
  const before = await readFile(fixture.projectPath, "utf8");
  const current = await fixture.snapshot();
  const proposals: readonly [unknown, string][] = [
    [{ lm_studio: { base_url: "http://attacker.invalid" } }, "protected_field"],
    [{ bearer_token: "stolen" }, "protected_field"],
    [{ allowed_models: ["attacker/model"] }, "protected_field"],
    [{ administrative_maxima: { max_concurrency: 99 } }, "protected_field"],
    [{ unknown: true }, "invalid_proposal"],
    [{ limits: { max_concurrency: 5 } }, "invalid_proposal"],
    [{}, "invalid_proposal"],
    [{ default_model: "qwen/test-model" }, "no_changes"],
  ];

  for (const [changes, expectedCode] of proposals) {
    const result = await fixture.validate(current.revision, changes);
    assert.equal(result.valid, false);
    if (result.valid) continue;
    assert.equal(result.errors[0]?.code, expectedCode);
    assert.equal(
      JSON.stringify(result).includes("mutation-secret-token"),
      false,
    );
  }
  assert.equal(await readFile(fixture.projectPath, "utf8"), before);
});

void test("uses null to remove a project override and fall back globally", async (t) => {
  const fixture = await createFixture(t, {
    schema_version: 1,
    default_model: "qwen/test-model",
    limits: { max_concurrency: 3 },
  });
  await fixture.writeProject({
    schema_version: 1,
    default_model: "another/model",
    limits: { max_concurrency: 4 },
  });
  const current = await fixture.snapshot();
  const proposal = await fixture.validate(current.revision, {
    default_model: null,
    limits: { max_concurrency: null },
  });
  assert.equal(proposal.valid, true);
  if (!proposal.valid) return;

  const result = await updateConfig({
    ...fixture.input(),
    expected_revision: current.revision,
    changes: { default_model: null, limits: { max_concurrency: null } },
    confirmation: { approved: true, proposal_id: proposal.proposal_id },
  });

  assert.equal(result.configuration.lm_studio.default_model, "qwen/test-model");
  assert.equal(result.configuration.limits.max_concurrency, 3);
  assert.equal(
    result.configuration.origins["lm_studio.default_model"],
    "global",
  );
  assert.deepEqual(JSON.parse(await readFile(fixture.projectPath, "utf8")), {
    schema_version: 1,
  });
});

void test("binds confirmation to the exact proposal content", async (t) => {
  const fixture = await createFixture(t);
  const current = await fixture.snapshot();
  const approved = await fixture.validate(current.revision, {
    limits: { max_concurrency: 3 },
  });
  assert.equal(approved.valid, true);
  if (!approved.valid) return;

  await assert.rejects(
    updateConfig({
      ...fixture.input(),
      expected_revision: current.revision,
      changes: { limits: { max_concurrency: 4 } },
      confirmation: { approved: true, proposal_id: approved.proposal_id },
    }),
    isConfigurationError("confirmation_required"),
  );
  await assert.rejects(
    readFile(fixture.projectPath, "utf8"),
    hasCode("ENOENT"),
  );
});

void test("preserves current bytes when the atomic replacement fails", async (t) => {
  const fixture = await createFixture(t);
  await fixture.writeProject({
    schema_version: 1,
    default_model: "qwen/test-model",
  });
  const before = await readFile(fixture.projectPath, "utf8");
  const current = await fixture.snapshot();
  const proposal = await fixture.validate(current.revision, {
    limits: { max_concurrency: 3 },
  });
  assert.equal(proposal.valid, true);
  if (!proposal.valid) return;

  await assert.rejects(
    updateConfig({
      ...fixture.input(),
      expected_revision: current.revision,
      changes: { limits: { max_concurrency: 3 } },
      confirmation: { approved: true, proposal_id: proposal.proposal_id },
      atomicWriter: {
        write: () => Promise.reject(new Error("simulated interruption")),
      },
    }),
    isConfigurationError("invalid_configuration"),
  );
  assert.equal(await readFile(fixture.projectPath, "utf8"), before);
});

void test("cleans an exact temporary file after rename failure", async (t) => {
  const fixture = await createFixture(t);
  await fixture.writeProject({
    schema_version: 1,
    default_model: "qwen/test-model",
  });
  const before = await readFile(fixture.projectPath, "utf8");

  await assert.rejects(
    writeConfigurationFileAtomically(fixture.projectPath, "replacement", {
      open: async (filePath, flags, mode) => open(filePath, flags, mode),
      rename: () => Promise.reject(new Error("simulated rename failure")),
      rm,
    }),
  );

  assert.equal(await readFile(fixture.projectPath, "utf8"), before);
  assert.deepEqual(await readdir(fixture.projectRoot), [
    ".local-model-workers.json",
  ]);
});

void test("serializes concurrent same-revision updates so only one commits", async (t) => {
  const fixture = await createFixture(t);
  const current = await fixture.snapshot();
  const proposalThree = await fixture.validate(current.revision, {
    limits: { max_concurrency: 3 },
  });
  const proposalFour = await fixture.validate(current.revision, {
    limits: { max_concurrency: 4 },
  });
  assert.equal(proposalThree.valid, true);
  assert.equal(proposalFour.valid, true);
  if (!proposalThree.valid || !proposalFour.valid) return;

  const results = await Promise.allSettled([
    updateConfig({
      ...fixture.input(),
      expected_revision: current.revision,
      changes: { limits: { max_concurrency: 3 } },
      confirmation: { approved: true, proposal_id: proposalThree.proposal_id },
    }),
    updateConfig({
      ...fixture.input(),
      expected_revision: current.revision,
      changes: { limits: { max_concurrency: 4 } },
      confirmation: { approved: true, proposal_id: proposalFour.proposal_id },
    }),
  ]);

  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  const rejected = results.find((result) => result.status === "rejected");
  assert.ok(rejected?.status === "rejected");
  assert.ok(rejected.reason instanceof ConfigurationError);
  assert.equal(rejected.reason.code, "configuration_conflict");
});

interface Fixture {
  readonly root: string;
  readonly homeDirectory: string;
  readonly projectRoot: string;
  readonly projectPath: string;
  input(): Omit<UpdateConfigurationInput, "expected_revision" | "changes">;
  snapshot(): ReturnType<typeof getEffectiveConfiguration>;
  validate(
    revision: string,
    changes: unknown,
  ): ReturnType<typeof validateConfig>;
  writeProject(value: unknown): Promise<void>;
}

async function createFixture(
  t: test.TestContext,
  globalPreferences: unknown = {
    schema_version: 1,
    default_model: "qwen/test-model",
  },
): Promise<Fixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lmw-config-mutation-"));
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
  await writeFile(globalPath, JSON.stringify(globalPreferences), "utf8");
  t.after(async () => rm(root, { recursive: true, force: true }));

  const fixture: Fixture = {
    root,
    homeDirectory,
    projectRoot,
    projectPath,
    input() {
      return {
        environment: protectedEnvironment,
        platform: "darwin",
        homeDirectory,
        projectRoot,
      };
    },
    snapshot() {
      return getEffectiveConfiguration(this.input());
    },
    validate(revision, changes) {
      return validateConfig({
        ...this.input(),
        expected_revision: revision,
        changes,
      });
    },
    async writeProject(value) {
      await writeFile(projectPath, JSON.stringify(value), "utf8");
    },
  };
  return fixture;
}

function isConfigurationError(code: string): (error: unknown) => boolean {
  return (error: unknown) =>
    error instanceof ConfigurationError && error.code === code;
}

function hasCode(code: string): (error: unknown) => boolean {
  return (error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code;
}
