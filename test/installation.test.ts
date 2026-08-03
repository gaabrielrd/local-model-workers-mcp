import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  applyGlobalPreferences,
  applyHarnessConfiguration,
  proposeGlobalPreferences,
  proposeHarnessConfigurations,
  runInteractiveSetup,
  runInstallationCommand,
} from "../src/features/installation/index.js";

const protectedEnvironment = {
  LMW_ALLOWED_MODELS: '["qwen/qwen3.5-9b","google/gemma-4-12b-qat"]',
  LMW_LM_STUDIO_BASE_URL: "http://pc-gabriel.local:1234/v1",
  LMW_LM_STUDIO_BEARER_TOKEN: "fixture-secret-never-print",
};

void test("proposes cancellation or both harnesses without writing", async (t) => {
  const fixture = await createFixture(t);
  assert.deepEqual(
    await proposeHarnessConfigurations({
      selection: "cancel",
      projectRoot: fixture.project,
      homeDirectory: fixture.home,
    }),
    [],
  );

  const proposalsBoth = await proposeHarnessConfigurations({
    selection: "both",
    projectRoot: fixture.project,
    homeDirectory: fixture.home,
  });
  assert.deepEqual(
    proposalsBoth.map((proposal) => [proposal.harness, proposal.state]),
    [
      ["claude-code", "fresh"],
      ["codex", "fresh"],
    ],
  );

  const proposalsAll = await proposeHarnessConfigurations({
    selection: "all",
    projectRoot: fixture.project,
    homeDirectory: fixture.home,
  });
  assert.deepEqual(
    proposalsAll.map((proposal) => [proposal.harness, proposal.state]),
    [
      ["claude-code", "fresh"],
      ["codex", "fresh"],
      ["antigravity", "fresh"],
    ],
  );
  await assert.rejects(access(path.join(fixture.project, ".mcp.json")));
  await assert.rejects(
    access(path.join(fixture.home, ".codex", "config.toml")),
  );
  await assert.rejects(
    access(path.join(fixture.home, ".gemini", "config", "mcp_config.json")),
  );
});

void test("accepts an explicit harness array selection", async (t) => {
  const fixture = await createFixture(t);
  const proposals = await proposeHarnessConfigurations({
    selection: ["codex", "antigravity"],
    projectRoot: fixture.project,
    homeDirectory: fixture.home,
  });
  assert.deepEqual(
    proposals.map((proposal) => [proposal.harness, proposal.state]),
    [
      ["codex", "fresh"],
      ["antigravity", "fresh"],
    ],
  );
  assert.deepEqual(
    await proposeHarnessConfigurations({
      selection: [],
      projectRoot: fixture.project,
      homeDirectory: fixture.home,
    }),
    [],
  );
});

void test("configures antigravity harness in ~/.gemini/config/mcp_config.json", async (t) => {
  const fixture = await createFixture(t);
  const [proposal] = await proposeHarnessConfigurations({
    selection: "antigravity",
    homeDirectory: fixture.home,
  });
  assert.ok(proposal);
  assert.equal(proposal.harness, "antigravity");
  assert.equal(
    proposal.target_path,
    path.join(fixture.home, ".gemini", "config", "mcp_config.json"),
  );

  const result = await applyHarnessConfiguration({
    proposal,
    confirmation: { approved: true, proposal_id: proposal.proposal_id },
  });
  assert.equal(result.outcome, "written");

  const contents = JSON.parse(await readFile(proposal.target_path, "utf8")) as {
    mcpServers: Record<string, { command: string }>;
  };
  const entry = contents.mcpServers["local-model-workers"];
  assert.ok(entry);
  assert.equal(entry.command, "local-model-workers-mcp");
});

void test("requires exact confirmation and writes secret-safe harness files", async (t) => {
  const fixture = await createFixture(t);
  const proposals = await proposeHarnessConfigurations({
    selection: "both",
    projectRoot: fixture.project,
    homeDirectory: fixture.home,
  });
  const first = proposals[0];
  assert.ok(first);
  await assert.rejects(
    applyHarnessConfiguration({ proposal: first }),
    /Explicit confirmation/,
  );

  for (const proposal of proposals) {
    const result = await applyHarnessConfiguration({
      proposal,
      confirmation: { approved: true, proposal_id: proposal.proposal_id },
    });
    assert.equal(result.outcome, "written");
  }

  const claudePath = path.join(fixture.home, ".claude.json");
  const codexPath = path.join(fixture.home, ".codex", "config.toml");
  const claude = await readFile(claudePath, "utf8");
  const codex = await readFile(codexPath, "utf8");
  assert.match(claude, /http:\/\/localhost:1234\/v1/);
  assert.match(codex, /LMW_LM_STUDIO_BEARER_TOKEN/);
  assert.equal(
    `${claude}${codex}`.includes(
      protectedEnvironment.LMW_LM_STUDIO_BEARER_TOKEN,
    ),
    false,
  );
  if (process.platform !== "win32") {
    assert.equal((await stat(claudePath)).mode & 0o777, 0o600);
    assert.equal((await stat(codexPath)).mode & 0o777, 0o600);
  }

  const identical = await proposeHarnessConfigurations({
    selection: "both",
    projectRoot: fixture.project,
    homeDirectory: fixture.home,
  });
  assert.deepEqual(
    identical.map((proposal) => proposal.state),
    ["identical", "identical"],
  );
});

void test("preserves unrelated compatible Claude and Codex configuration", async (t) => {
  const fixture = await createFixture(t);
  await writeFile(
    path.join(fixture.project, ".mcp.json"),
    JSON.stringify({
      projectSetting: true,
      mcpServers: { other: { command: "other" } },
    }),
  );
  await mkdir(path.join(fixture.home, ".codex"), { recursive: true });
  await writeFile(
    path.join(fixture.home, ".codex", "config.toml"),
    'model = "approved-model"\n\n[mcp_servers.other]\ncommand = "other"\n',
  );
  const proposals = await proposeHarnessConfigurations({
    selection: ["claude-code-project", "codex"],
    projectRoot: fixture.project,
    homeDirectory: fixture.home,
  });
  assert.deepEqual(
    proposals.map((proposal) => proposal.state),
    ["compatible", "compatible"],
  );
  for (const proposal of proposals) {
    await applyHarnessConfiguration({
      proposal,
      confirmation: { approved: true, proposal_id: proposal.proposal_id },
    });
  }
  const claude = JSON.parse(
    await readFile(path.join(fixture.project, ".mcp.json"), "utf8"),
  ) as {
    projectSetting: boolean;
    mcpServers: Record<string, unknown>;
  };
  assert.equal(claude.projectSetting, true);
  assert.ok(claude.mcpServers.other);
  const codex = await readFile(
    path.join(fixture.home, ".codex", "config.toml"),
    "utf8",
  );
  assert.match(codex, /model = "approved-model"/);
  assert.match(codex, /\[mcp_servers\.other\]/);
});

void test("redacts conflicting content and rejects malformed or stale harness files", async (t) => {
  const fixture = await createFixture(t);
  const secretMarker = "existing-harness-secret-marker";
  const claudePath = path.join(fixture.project, ".mcp.json");
  await writeFile(
    claudePath,
    JSON.stringify({
      mcpServers: {
        "local-model-workers": { command: "old", env: { TOKEN: secretMarker } },
      },
    }),
  );
  const [conflict] = await proposeHarnessConfigurations({
    selection: "claude-code-project",
    projectRoot: fixture.project,
  });
  assert.ok(conflict);
  assert.equal(conflict.state, "conflicting");
  assert.equal(JSON.stringify(conflict).includes(secretMarker), false);
  const before = await readFile(claudePath, "utf8");
  await assert.rejects(
    applyHarnessConfiguration({ proposal: conflict }),
    /confirmation/,
  );
  assert.equal(await readFile(claudePath, "utf8"), before);

  await writeFile(claudePath, '{"changed":true}\n');
  await assert.rejects(
    applyHarnessConfiguration({
      proposal: conflict,
      confirmation: { approved: true, proposal_id: conflict.proposal_id },
    }),
    /changed after the proposal/,
  );

  await mkdir(path.join(fixture.home, ".codex"), { recursive: true });
  await writeFile(
    path.join(fixture.home, ".codex", "config.toml"),
    "# local-model-workers-mcp:start\nmissing end marker\n",
  );
  const [malformed] = await proposeHarnessConfigurations({
    selection: "codex",
    homeDirectory: fixture.home,
  });
  assert.ok(malformed);
  assert.equal(malformed.state, "malformed");
  assert.equal(malformed.applicable, false);
});

void test("validates, confirms, and atomically writes global preferences", async (t) => {
  const fixture = await createFixture(t);
  const proposal = await proposeGlobalPreferences({
    preferences: {
      schema_version: 1,
      default_model: "qwen/qwen3.5-9b",
      limits: { max_concurrency: 2 },
    },
    environment: protectedEnvironment,
    platform: "linux",
    homeDirectory: fixture.home,
  });
  assert.equal(proposal.state, "fresh");
  await assert.rejects(
    applyGlobalPreferences({
      proposal,
      environment: protectedEnvironment,
      platform: "linux",
      homeDirectory: fixture.home,
    }),
    /confirmation/,
  );
  const result = await applyGlobalPreferences({
    proposal,
    confirmation: { approved: true, proposal_id: proposal.proposal_id },
    environment: protectedEnvironment,
    platform: "linux",
    homeDirectory: fixture.home,
  });
  assert.equal(result.outcome, "written");
  const contents = await readFile(result.target_path, "utf8");
  assert.equal(
    contents.includes(protectedEnvironment.LMW_LM_STUDIO_BEARER_TOKEN),
    false,
  );

  const merged = await proposeGlobalPreferences({
    preferences: {
      schema_version: 1,
      default_model: "google/gemma-4-12b-qat",
    },
    environment: protectedEnvironment,
    platform: "linux",
    homeDirectory: fixture.home,
  });
  assert.deepEqual(merged.preferences.limits, { max_concurrency: 2 });

  await assert.rejects(
    proposeGlobalPreferences({
      preferences: { schema_version: 1, bearer_token: "forbidden" },
      environment: protectedEnvironment,
      platform: "linux",
      homeDirectory: fixture.home,
    }),
    /strict editable schema/,
  );
  await assert.rejects(
    proposeGlobalPreferences({
      preferences: { schema_version: 1, default_model: "not/allowed" },
      environment: protectedEnvironment,
      platform: "linux",
      homeDirectory: fixture.home,
    }),
    /not allowed/,
  );
});

void test("CLI dry-run and unconfirmed flows make no changes or leak credentials", async (t) => {
  const fixture = await createFixture(t);
  const output: string[] = [];
  const io = {
    write: (message: string): void => {
      output.push(message);
    },
    environment: protectedEnvironment,
    cwd: fixture.project,
    homeDirectory: fixture.home,
    platform: "linux" as const,
  };
  assert.equal(
    await runInstallationCommand(
      ["configure-harness", "--target", "both", "--dry-run"],
      io,
    ),
    0,
  );
  assert.equal(
    await runInstallationCommand(
      ["configure-global", "--default-model", "qwen/qwen3.5-9b"],
      io,
    ),
    77,
  );
  await assert.rejects(access(path.join(fixture.project, ".mcp.json")));
  await assert.rejects(
    access(path.join(fixture.home, ".codex", "config.toml")),
  );
  assert.equal(
    output.join("").includes(protectedEnvironment.LMW_LM_STUDIO_BEARER_TOKEN),
    false,
  );
});

void test("interactive setup command creates harness and global preference files and performs health check", async (t) => {
  const fixture = await createFixture(t);
  const output: string[] = [];
  const io = {
    write: (message: string): void => {
      output.push(message);
    },
    environment: protectedEnvironment,
    cwd: fixture.project,
    homeDirectory: fixture.home,
    platform: "linux" as const,
  };
  const exitCode = await runInstallationCommand(
    ["setup", "--target", "both", "--yes"],
    io,
  );
  assert.equal(exitCode, 0);
  const claudePath = path.join(fixture.home, ".claude.json");
  const codexPath = path.join(fixture.home, ".codex", "config.toml");
  const claude = await readFile(claudePath, "utf8");
  const codex = await readFile(codexPath, "utf8");
  assert.match(claude, /http:\/\/pc-gabriel\.local:1234\/v1/);
  assert.match(codex, /LMW_LM_STUDIO_BEARER_TOKEN/);
  const text = output.join("");
  assert.match(text, /Setup Complete/);
  assert.match(text, /Health status/);
});

void test("setup persists an explicit MCP feature selection", async (t) => {
  const fixture = await createFixture(t);
  const output: string[] = [];
  const io = {
    write: (message: string): void => {
      output.push(message);
    },
    environment: protectedEnvironment,
    cwd: fixture.project,
    homeDirectory: fixture.home,
    platform: "linux" as const,
  };

  const exitCode = await runInstallationCommand(
    ["setup", "--target", "both", "--features", "docs,tests", "--yes"],
    io,
  );

  assert.equal(exitCode, 0);
  const preferences = JSON.parse(
    await readFile(
      path.join(
        fixture.home,
        ".config",
        "local-model-workers",
        "preferences.json",
      ),
      "utf8",
    ),
  ) as { enabled_features?: string[] };
  assert.deepEqual(preferences.enabled_features, ["docs", "tests"]);
  assert.match(output.join(""), /Enabled MCP features: docs, tests/);
});

void test("interactive setup selects MCP features with keyboard controls", async (t) => {
  const fixture = await createFixture(t);
  const output: string[] = [];
  const rawModes: boolean[] = [];
  const input = new PassThrough() as PassThrough & {
    isTTY: boolean;
    setRawMode(mode: boolean): void;
  };
  input.isTTY = true;
  input.setRawMode = (mode): void => {
    rawModes.push(mode);
  };
  const readlineInterface = {
    question: (prompt: string): Promise<string> =>
      Promise.resolve(prompt.includes("Apply these changes") ? "yes" : ""),
    close: (): void => undefined,
  } as unknown as NonNullable<Parameters<typeof runInteractiveSetup>[2]>;
  const io = {
    write: (message: string): void => {
      output.push(message);
    },
    environment: protectedEnvironment,
    cwd: fixture.project,
    homeDirectory: fixture.home,
    platform: "linux" as const,
  };

  const setup = runInteractiveSetup(
    new Map([
      ["target", "both"],
      ["url", "http://127.0.0.1:1/v1"],
    ]),
    io,
    readlineInterface,
    input,
  );
  setImmediate(() => input.write(" \x1b[B \x1b[B\x1b[B \r"));

  assert.equal(await setup, 0);
  const preferences = JSON.parse(
    await readFile(
      path.join(
        fixture.home,
        ".config",
        "local-model-workers",
        "preferences.json",
      ),
      "utf8",
    ),
  ) as { enabled_features?: string[] };
  assert.deepEqual(preferences.enabled_features, ["docs"]);
  assert.deepEqual(rawModes, [true, false]);
  assert.match(output.join(""), /Select MCP features/);
});

void test("setup rejects unknown MCP feature selections", async (t) => {
  const fixture = await createFixture(t);
  const output: string[] = [];
  const io = {
    write: (message: string): void => {
      output.push(message);
    },
    environment: protectedEnvironment,
    cwd: fixture.project,
    homeDirectory: fixture.home,
    platform: "linux" as const,
  };

  assert.equal(
    await runInstallationCommand(
      ["setup", "--target", "both", "--features", "docs,unknown", "--yes"],
      io,
    ),
    65,
  );
  await assert.rejects(
    access(
      path.join(
        fixture.home,
        ".config",
        "local-model-workers",
        "preferences.json",
      ),
    ),
  );
  assert.match(output.join(""), /Invalid feature selection/);
});

void test("setup dry-run makes no changes to filesystem", async (t) => {
  const fixture = await createFixture(t);
  const output: string[] = [];
  const io = {
    write: (message: string): void => {
      output.push(message);
    },
    environment: protectedEnvironment,
    cwd: fixture.project,
    homeDirectory: fixture.home,
    platform: "linux" as const,
  };
  const exitCode = await runInstallationCommand(
    ["init", "--target", "both", "--dry-run"],
    io,
  );
  assert.equal(exitCode, 0);
  await assert.rejects(access(path.join(fixture.project, ".mcp.json")));
  await assert.rejects(
    access(path.join(fixture.home, ".codex", "config.toml")),
  );
  assert.match(output.join(""), /Dry Run/);
});

async function createFixture(
  t: test.TestContext,
): Promise<{ home: string; project: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lmw-installation-"));
  const home = path.join(root, "home");
  const project = path.join(root, "project");
  await mkdir(home, { recursive: true });
  await mkdir(project, { recursive: true });
  t.after(async () => rm(root, { recursive: true, force: true }));
  return { home, project };
}
