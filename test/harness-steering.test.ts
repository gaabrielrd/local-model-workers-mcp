import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  getEffectiveConfiguration,
  resolveGlobalPreferencesPath,
  updateConfig,
  validateConfig,
} from "../src/features/configuration/index.js";
import {
  STEERING_MARKER_END,
  STEERING_MARKER_START,
  applyGlobalPreferences,
  applyHarnessConfiguration,
  buildSteeringInstructions,
  proposeGlobalPreferences,
  proposeHarnessConfigurations,
  runInstallationCommand,
  type Harness,
  type InstallationCommandIo,
} from "../src/features/installation/index.js";

const protectedEnvironment = {
  LMW_LM_STUDIO_BASE_URL: "http://127.0.0.1:1234/v1",
  LMW_LM_STUDIO_BEARER_TOKEN: "steering-secret-token",
  LMW_ALLOWED_MODELS: '["qwen/qwen3.5-9b","qwen/test-model","another/model"]',
};

const TOOL_DIRECTIVES = [
  "explore_repository",
  "search_semantic",
  "query_code_graph",
  "summarize_module",
  "propose_tests",
];

const PLATFORM = "linux" as const;

void test("proposes prompt steering instructions for every supported harness", async (t) => {
  const fixture = await createHarnessFixture(t);
  const proposals = await proposeHarnessConfigurations({
    selection: "all",
    projectRoot: fixture.project,
    homeDirectory: fixture.home,
  });
  assert.equal(proposals.length, 7);
  for (const proposal of proposals) {
    assert.equal(proposal.steering.state, "fresh");
    assert.equal(proposal.steering.applicable, true);
    assert.equal(proposal.requires_confirmation, true);
    const preview = [...proposal.preview, ...proposal.steering.preview].join(
      "\n",
    );
    for (const directive of TOOL_DIRECTIVES) {
      assert.match(preview, new RegExp(directive));
    }
    assert.match(preview, /managed block between managed markers/);
  }
  await assert.rejects(access(path.join(fixture.project, "AGENTS.md")));
  await assert.rejects(
    access(path.join(fixture.home, ".codex", "instructions.md")),
  );
  await assert.rejects(
    access(path.join(fixture.home, ".gemini", "instructions.md")),
  );
});

void test("dry-run previews prompt steering changes without writing files", async (t) => {
  const fixture = await createHarnessFixture(t);
  const output: string[] = [];
  const exitCode = await runInstallationCommand(
    ["configure-harness", "--target", "all", "--dry-run"],
    buildIo(fixture, output),
  );
  assert.equal(exitCode, 0);
  const text = output.join("");
  assert.match(text, /explore_repository/);
  assert.match(text, /managed markers/);
  await assert.rejects(access(path.join(fixture.project, "AGENTS.md")));
  await assert.rejects(
    access(path.join(fixture.home, ".codex", "instructions.md")),
  );
  await assert.rejects(
    access(path.join(fixture.home, ".gemini", "instructions.md")),
  );
  await assert.rejects(access(path.join(fixture.project, ".mcp.json")));
  await assert.rejects(
    access(path.join(fixture.home, ".codex", "config.toml")),
  );
});

void test("applying a proposal writes steering instruction files atomically", async (t) => {
  const fixture = await createHarnessFixture(t);
  const proposals = await proposeHarnessConfigurations({
    selection: "all",
    projectRoot: fixture.project,
    homeDirectory: fixture.home,
  });
  for (const proposal of proposals) {
    const result = await applyHarnessConfiguration({
      proposal,
      confirmation: { approved: true, proposal_id: proposal.proposal_id },
    });
    assert.equal(result.outcome, "written");
  }

  const claude = await readFile(
    path.join(fixture.home, ".claude", "CLAUDE.md"),
    "utf8",
  );
  const codex = await readFile(
    path.join(fixture.home, ".codex", "instructions.md"),
    "utf8",
  );
  const gemini = await readFile(
    path.join(fixture.home, ".gemini", "instructions.md"),
    "utf8",
  );
  for (const contents of [claude, codex, gemini]) {
    assert.ok(contents.startsWith(STEERING_MARKER_START));
    assert.match(contents, /## Offload repository work to local MCP tools/);
    assert.ok(contents.trimEnd().endsWith(STEERING_MARKER_END));
    for (const directive of TOOL_DIRECTIVES) {
      assert.match(contents, new RegExp(directive));
    }
  }

  const again = await proposeHarnessConfigurations({
    selection: "all",
    projectRoot: fixture.project,
    homeDirectory: fixture.home,
  });
  assert.deepEqual(
    again.map((proposal) => proposal.state),
    [
      "identical",
      "identical",
      "identical",
      "identical",
      "identical",
      "identical",
      "identical",
    ],
  );
  assert.deepEqual(
    again.map((proposal) => proposal.steering.state),
    [
      "identical",
      "identical",
      "identical",
      "identical",
      "identical",
      "identical",
      "identical",
    ],
  );
  for (const proposal of again) {
    const result = await applyHarnessConfiguration({ proposal });
    assert.equal(result.outcome, "unchanged");
  }
});

void test("preserves user instructions outside the managed markers", async (t) => {
  const fixture = await createHarnessFixture(t);
  const agentPath = path.join(fixture.project, "AGENTS.md");
  await writeFile(
    agentPath,
    "# Project instructions\n\nRun the project-specific build steps here.\n",
    "utf8",
  );
  const [proposal] = await proposeHarnessConfigurations({
    selection: "claude-code-project",
    projectRoot: fixture.project,
    homeDirectory: fixture.home,
  });
  assert.ok(proposal);
  assert.equal(proposal.steering.state, "compatible");
  await applyHarnessConfiguration({
    proposal,
    confirmation: { approved: true, proposal_id: proposal.proposal_id },
  });

  const contents = await readFile(agentPath, "utf8");
  assert.match(contents, /# Project instructions/);
  assert.match(contents, /Run the project-specific build steps here\./);
  assert.ok(
    contents.indexOf("# Project instructions") <
      contents.indexOf(STEERING_MARKER_START),
  );
  assert.ok(
    contents.indexOf(STEERING_MARKER_START) <
      contents.indexOf(STEERING_MARKER_END),
  );

  const [again] = await proposeHarnessConfigurations({
    selection: "claude-code-project",
    projectRoot: fixture.project,
    homeDirectory: fixture.home,
  });
  assert.equal(again?.steering.state, "identical");
});

void test("replaces a stale managed block and keeps surrounding user text", async (t) => {
  const fixture = await createHarnessFixture(t);
  const agentPath = path.join(fixture.project, "AGENTS.md");
  const stale =
    "# local-model-workers-mcp:start\n# obsolete managed text\n# local-model-workers-mcp:end\n";
  await writeFile(
    agentPath,
    `# My notes\n\n${stale}\n\n# More notes\n`,
    "utf8",
  );
  const [proposal] = await proposeHarnessConfigurations({
    selection: "claude-code-project",
    projectRoot: fixture.project,
    homeDirectory: fixture.home,
  });
  assert.ok(proposal);
  assert.equal(proposal.steering.state, "conflicting");
  await applyHarnessConfiguration({
    proposal,
    confirmation: { approved: true, proposal_id: proposal.proposal_id },
  });

  const contents = await readFile(agentPath, "utf8");
  assert.match(contents, /# My notes/);
  assert.match(contents, /# More notes/);
  assert.match(contents, /explore_repository/);
  assert.ok(!contents.includes("# obsolete managed text"));
});

void test("flags unbalanced steering markers as malformed and refuses to write", async (t) => {
  const fixture = await createHarnessFixture(t);
  const agentPath = path.join(fixture.project, "AGENTS.md");
  await writeFile(
    agentPath,
    "# local-model-workers-mcp:start\nmissing end marker\n",
    "utf8",
  );
  const [proposal] = await proposeHarnessConfigurations({
    selection: "claude-code-project",
    projectRoot: fixture.project,
    homeDirectory: fixture.home,
  });
  assert.ok(proposal);
  assert.equal(proposal.steering.state, "malformed");
  assert.equal(proposal.applicable, false);
  await assert.rejects(
    applyHarnessConfiguration({
      proposal,
      confirmation: { approved: true, proposal_id: proposal.proposal_id },
    }),
    /cannot be updated safely/,
  );
});

void test("merges a custom steering_prompt from global preferences", async (t) => {
  const fixture = await createHarnessFixture(t);
  const globalPath = resolveGlobalPreferencesPath({
    platform: PLATFORM,
    homeDirectory: fixture.home,
    environment: protectedEnvironment,
  });
  await mkdir(path.dirname(globalPath), { recursive: true });
  await writeFile(
    globalPath,
    JSON.stringify({
      schema_version: 1,
      default_model: "qwen/qwen3.5-9b",
      steering_prompt: "Prefer vector search when the query is descriptive.",
    }),
    "utf8",
  );

  const output: string[] = [];
  const exitCode = await runInstallationCommand(
    ["configure-harness", "--target", "codex", "--yes"],
    buildIo(fixture, output),
  );
  assert.equal(exitCode, 0);

  const instructions = await readFile(
    path.join(fixture.home, ".codex", "instructions.md"),
    "utf8",
  );
  assert.match(
    instructions,
    /Prefer vector search when the query is descriptive\./,
  );
  for (const directive of TOOL_DIRECTIVES) {
    assert.match(instructions, new RegExp(directive));
  }
  const codex = await readFile(
    path.join(fixture.home, ".codex", "config.toml"),
    "utf8",
  );
  assert.match(codex, /\[mcp_servers\.local-model-workers\]/);
});

void test("preserves steering_prompt and default_model when merging global preferences", async (t) => {
  const fixture = await createHarnessFixture(t);
  const globalPath = resolveGlobalPreferencesPath({
    platform: PLATFORM,
    homeDirectory: fixture.home,
    environment: protectedEnvironment,
  });
  await mkdir(path.dirname(globalPath), { recursive: true });
  await writeFile(
    globalPath,
    JSON.stringify({
      schema_version: 1,
      default_model: "qwen/qwen3.5-9b",
      steering_prompt: "Keep this directive.",
    }),
    "utf8",
  );

  const proposal = await proposeGlobalPreferences({
    preferences: { schema_version: 1, limits: { max_concurrency: 4 } },
    environment: protectedEnvironment,
    platform: PLATFORM,
    homeDirectory: fixture.home,
  });
  assert.equal(proposal.preferences.steering_prompt, "Keep this directive.");
  assert.equal(proposal.preferences.default_model, "qwen/qwen3.5-9b");
  assert.equal(proposal.preferences.limits?.max_concurrency, 4);
  assert.match(proposal.preview.join("\n"), /Keep this directive\./);

  const result = await applyGlobalPreferences({
    proposal,
    confirmation: { approved: true, proposal_id: proposal.proposal_id },
    environment: protectedEnvironment,
    platform: PLATFORM,
    homeDirectory: fixture.home,
  });
  assert.equal(result.outcome, "written");
  const written = JSON.parse(await readFile(globalPath, "utf8")) as {
    steering_prompt?: string;
  };
  assert.equal(written.steering_prompt, "Keep this directive.");
});

void test("resolves steering paths portably across platforms", async (t) => {
  const fixture = await createHarnessFixture(t);
  const proposals = await proposeHarnessConfigurations({
    selection: "all",
    projectRoot: fixture.project,
    homeDirectory: fixture.home,
  });
  assert.equal(proposals.length, 7);
  const expected: Record<Harness, string> = {
    "claude-code": path.join(fixture.home, ".claude", "CLAUDE.md"),
    "claude-code-project": path.join(fixture.project, "AGENTS.md"),
    codex: path.join(fixture.home, ".codex", "instructions.md"),
    antigravity: path.join(fixture.home, ".gemini", "instructions.md"),
    cursor: path.join(fixture.home, ".cursor", "rules", "mcp.md"),
    vscode: path.join(fixture.home, ".vscode", "instructions.md"),
    neovim: path.join(fixture.home, ".config", "nvim", "instructions.md"),
    jetbrains: path.join(
      fixture.project,
      ".aiassistant",
      "rules",
      "local-model-workers.md",
    ),
  };
  for (const proposal of proposals) {
    assert.equal(proposal.steering.target_path, expected[proposal.harness]);
    assert.equal(path.isAbsolute(proposal.steering.target_path), true);
  }
});

void test("builds deterministic steering blocks and sanitizes marker lines", () => {
  const plain = buildSteeringInstructions();
  assert.ok(plain.block.startsWith(STEERING_MARKER_START));
  assert.ok(plain.block.trimEnd().endsWith(STEERING_MARKER_END));
  assert.deepEqual(plain.preview, [
    "managed block between managed markers",
    "directives: explore_repository, search_semantic, query_code_graph, summarize_module, propose_tests",
  ]);

  const custom = buildSteeringInstructions({
    custom_directives:
      "# local-model-workers-mcp:start\nAlways verify with propose_tests.\n",
  });
  assert.equal(custom.block.split(STEERING_MARKER_START).length - 1, 1);
  assert.equal(custom.block.split(STEERING_MARKER_END).length - 1, 1);
  assert.match(custom.block, /Always verify with propose_tests\./);
});

void test("builds steering instructions customized to enabled feature groups", () => {
  const explorationOnly = buildSteeringInstructions({
    enabled_features: ["exploration"],
  });
  assert.match(explorationOnly.block, /explore_repository/);
  assert.doesNotMatch(explorationOnly.block, /propose_tests/);
  assert.doesNotMatch(explorationOnly.block, /fix_lint_violations/);

  const lintOnly = buildSteeringInstructions({
    enabled_features: ["lint"],
  });
  assert.match(lintOnly.block, /fix_lint_violations/);
  assert.match(lintOnly.block, /fix_type_errors/);
  assert.doesNotMatch(lintOnly.block, /explore_repository/);
});

void test("includes context-efficiency directives in steering instructions", () => {
  const plain = buildSteeringInstructions();
  assert.match(
    plain.block,
    /Do not echo large tool results verbatim into the conversation/,
  );

  const exploration = buildSteeringInstructions({
    enabled_features: ["exploration"],
  });
  assert.match(
    exploration.block,
    /Prefer targeted `query_code_graph`, `search_semantic`, and `summarize_module` calls/,
  );

  const tests = buildSteeringInstructions({
    enabled_features: ["tests"],
  });
  assert.match(
    tests.block,
    /Do not echo `auto_validate_tests` iteration output/,
  );
});

void test("resolves steering_prompt from global and project preferences", async (t) => {
  const fixture = await createConfigurationFixture(t);
  await fixture.writeGlobal({
    schema_version: 1,
    default_model: "qwen/test-model",
    steering_prompt: "Global steering guidance.",
  });
  const fromGlobal = await getEffectiveConfiguration(fixture.input());
  assert.equal(fromGlobal.steering_prompt, "Global steering guidance.");
  assert.equal(fromGlobal.origins["steering_prompt"], "global");

  await fixture.writeProject({
    schema_version: 1,
    default_model: "qwen/test-model",
    steering_prompt: "Project steering guidance.",
  });
  const fromProject = await getEffectiveConfiguration(fixture.input(true));
  assert.equal(fromProject.steering_prompt, "Project steering guidance.");
  assert.equal(fromProject.origins["steering_prompt"], "project");
});

void test("updates steering_prompt in project preferences and preserves it", async (t) => {
  const fixture = await createMutationFixture(t);
  const current = await fixture.snapshot();
  const proposal = await fixture.validate(current.revision, {
    steering_prompt: "Use vector search.",
  });
  assert.equal(proposal.valid, true);
  if (!proposal.valid) return;
  assert.deepEqual(proposal.changes[0], {
    field: "steering_prompt",
    old_value: undefined,
    new_value: "Use vector search.",
    old_origin: "built_in",
    new_origin: "project",
  });

  const first = await updateConfig({
    ...fixture.input(),
    expected_revision: current.revision,
    changes: { steering_prompt: "Use vector search." },
    confirmation: {
      approved: true as const,
      proposal_id: proposal.proposal_id,
    },
  });
  assert.equal(first.updated, true);
  assert.equal(first.configuration.steering_prompt, "Use vector search.");
  assert.equal(first.configuration.origins["steering_prompt"], "project");

  const second = await fixture.snapshot();
  const defaultProposal = await fixture.validate(second.revision, {
    default_model: "another/model",
  });
  assert.equal(defaultProposal.valid, true);
  if (!defaultProposal.valid) return;
  await updateConfig({
    ...fixture.input(),
    expected_revision: second.revision,
    changes: { default_model: "another/model" },
    confirmation: {
      approved: true as const,
      proposal_id: defaultProposal.proposal_id,
    },
  });
  const preserved = await fixture.snapshot();
  assert.equal(preserved.steering_prompt, "Use vector search.");
  assert.equal(preserved.lm_studio.default_model, "another/model");

  const third = await fixture.snapshot();
  const clearProposal = await fixture.validate(third.revision, {
    steering_prompt: null,
  });
  assert.equal(clearProposal.valid, true);
  if (!clearProposal.valid) return;
  await updateConfig({
    ...fixture.input(),
    expected_revision: third.revision,
    changes: { steering_prompt: null },
    confirmation: {
      approved: true as const,
      proposal_id: clearProposal.proposal_id,
    },
  });
  const cleared = await fixture.snapshot();
  assert.equal(cleared.steering_prompt, undefined);
  assert.equal(cleared.origins["steering_prompt"], "built_in");
});

void test("configure-global writes a custom steering prompt", async (t) => {
  const fixture = await createHarnessFixture(t);
  const output: string[] = [];
  const exitCode = await runInstallationCommand(
    [
      "configure-global",
      "--default-model",
      "qwen/qwen3.5-9b",
      "--steering-prompt",
      "Always prefer semantic search.",
      "--yes",
    ],
    buildIo(fixture, output),
  );
  assert.equal(exitCode, 0);
  const globalPath = resolveGlobalPreferencesPath({
    platform: PLATFORM,
    homeDirectory: fixture.home,
    environment: protectedEnvironment,
  });
  const written = JSON.parse(await readFile(globalPath, "utf8")) as {
    steering_prompt: string;
  };
  assert.equal(written.steering_prompt, "Always prefer semantic search.");
  assert.match(output.join(""), /Always prefer semantic search\./);
});

void test("configure-global writes result verbosity preferences", async (t) => {
  const fixture = await createHarnessFixture(t);
  const output: string[] = [];
  const exitCode = await runInstallationCommand(
    ["configure-global", "--result-verbosity", "terse", "--yes"],
    buildIo(fixture, output),
  );
  assert.equal(exitCode, 0);
  const globalPath = resolveGlobalPreferencesPath({
    platform: PLATFORM,
    homeDirectory: fixture.home,
    environment: protectedEnvironment,
  });
  const written = JSON.parse(await readFile(globalPath, "utf8")) as {
    result_verbosity: string;
  };
  assert.equal(written.result_verbosity, "terse");
});

void test("configure-global rejects an invalid result verbosity", async (t) => {
  const fixture = await createHarnessFixture(t);
  const output: string[] = [];
  const exitCode = await runInstallationCommand(
    ["configure-global", "--result-verbosity", "chatty", "--yes"],
    buildIo(fixture, output),
  );
  assert.equal(exitCode, 65);
  assert.match(output.join(""), /must be one of: terse, standard, verbose/);
});

interface HarnessFixture {
  readonly home: string;
  readonly project: string;
}

async function createHarnessFixture(
  t: test.TestContext,
): Promise<HarnessFixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lmw-steering-"));
  const home = path.join(root, "home");
  const project = path.join(root, "project");
  await mkdir(home, { recursive: true });
  await mkdir(project, { recursive: true });
  t.after(async () => rm(root, { recursive: true, force: true }));
  return { home, project };
}

function buildIo(
  fixture: HarnessFixture,
  output: string[],
): InstallationCommandIo {
  return {
    write: (message: string): void => {
      output.push(message);
    },
    environment: protectedEnvironment,
    cwd: fixture.project,
    homeDirectory: fixture.home,
    platform: PLATFORM,
  };
}

interface ConfigurationFixture {
  readonly root: string;
  readonly projectRoot: string;
  input(includeProject?: boolean): {
    environment: typeof protectedEnvironment;
    platform: "darwin";
    homeDirectory: string;
    projectRoot?: string;
  };
  writeGlobal(value: unknown): Promise<void>;
  writeProject(value: unknown): Promise<void>;
}

async function createConfigurationFixture(
  t: test.TestContext,
): Promise<ConfigurationFixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lmw-steering-config-"));
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
      await mkdir(path.dirname(globalPath), { recursive: true });
      await writeFile(globalPath, JSON.stringify(value), "utf8");
    },
    async writeProject(value: unknown) {
      await writeFile(projectPath, JSON.stringify(value), "utf8");
    },
  };
}

interface MutationFixture {
  readonly homeDirectory: string;
  readonly projectRoot: string;
  input(): Omit<
    Parameters<typeof validateConfig>[0],
    "expected_revision" | "changes"
  >;
  snapshot(): ReturnType<typeof getEffectiveConfiguration>;
  validate(
    revision: string,
    changes: unknown,
  ): ReturnType<typeof validateConfig>;
}

async function createMutationFixture(
  t: test.TestContext,
): Promise<MutationFixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lmw-steering-mutation-"));
  const homeDirectory = path.join(root, "home");
  const projectRoot = path.join(root, "project");
  const globalPath = resolveGlobalPreferencesPath({
    platform: "darwin",
    homeDirectory,
    environment: protectedEnvironment,
  });
  await mkdir(path.dirname(globalPath), { recursive: true });
  await mkdir(projectRoot, { recursive: true });
  await writeFile(
    globalPath,
    JSON.stringify({
      schema_version: 1,
      default_model: "qwen/test-model",
    }),
    "utf8",
  );
  t.after(async () => rm(root, { recursive: true, force: true }));

  const fixture: MutationFixture = {
    homeDirectory,
    projectRoot,
    input() {
      return {
        environment: protectedEnvironment,
        platform: "darwin",
        homeDirectory,
        projectRoot,
      };
    },
    snapshot() {
      return getEffectiveConfiguration({
        environment: protectedEnvironment,
        platform: "darwin",
        homeDirectory,
        projectRoot,
      });
    },
    validate(revision, changes) {
      return validateConfig({
        environment: protectedEnvironment,
        platform: "darwin",
        homeDirectory,
        projectRoot,
        expected_revision: revision,
        changes,
      });
    },
  };
  return fixture;
}
