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
  STEERING_MARKER_END,
  STEERING_MARKER_START,
  applyHarnessConfiguration,
  describeJetBrainsVersionWarnings,
  detectJetBrainsIdeVersions,
  proposeHarnessConfigurations,
  resolveJetBrainsMcpConfigPath,
  resolveJetBrainsRulesPath,
  runInstallationCommand,
  type InstallationCommandIo,
  type JetBrainsDirectoryReader,
} from "../src/features/installation/index.js";

const protectedEnvironment = {
  LMW_ALLOWED_MODELS: '["qwen/qwen3.5-9b"]',
  LMW_LM_STUDIO_BASE_URL: "http://127.0.0.1:1234/v1",
  LMW_LM_STUDIO_BEARER_TOKEN: "fixture-secret-never-print",
};

const PLATFORM = "linux" as const;

void test("resolves the shared AI Assistant mcp.json path per platform", () => {
  const environment = { ...protectedEnvironment };
  assert.equal(
    resolveJetBrainsMcpConfigPath({
      platform: "darwin",
      homeDirectory: "/home/user",
      environment,
    }),
    "/home/user/Library/Application Support/JetBrains/AIAssistant/mcp.json",
  );
  assert.equal(
    resolveJetBrainsMcpConfigPath({
      platform: "linux",
      homeDirectory: "/home/user",
      environment,
    }),
    "/home/user/.config/JetBrains/AIAssistant/mcp.json",
  );
  assert.equal(
    resolveJetBrainsMcpConfigPath({
      platform: "linux",
      homeDirectory: "/home/user",
      environment: { ...environment, XDG_CONFIG_HOME: "/custom/config" },
    }),
    "/custom/config/JetBrains/AIAssistant/mcp.json",
  );
  assert.equal(
    resolveJetBrainsMcpConfigPath({
      platform: "win32",
      homeDirectory: "C:\\Users\\dev",
      environment: {
        ...environment,
        APPDATA: "C:\\Users\\dev\\AppData\\Roaming",
      },
    }),
    "C:\\Users\\dev\\AppData\\Roaming\\JetBrains\\AIAssistant\\mcp.json",
  );
  assert.equal(
    resolveJetBrainsMcpConfigPath({
      platform: "win32",
      homeDirectory: "C:\\Users\\dev",
      environment,
    }),
    "C:\\Users\\dev\\AppData\\Roaming\\JetBrains\\AIAssistant\\mcp.json",
  );
});

void test("detects unsupported JetBrains IDE versions and reports warnings", async () => {
  const reader: JetBrainsDirectoryReader = {
    readDirectory: () =>
      Promise.resolve([
        "IntelliJIdea2024.3",
        "PyCharm2025.1",
        "WebStorm2024.3",
        "GoLand2025.2",
        "CLion2025.1",
        "PhpStorm2025.1",
        "marker",
        "IntelliJIdea",
      ]),
  };
  const installations = await detectJetBrainsIdeVersions({
    platform: PLATFORM,
    homeDirectory: "/home/user",
    environment: protectedEnvironment,
    reader,
  });
  assert.deepEqual(
    installations.map(({ product, supported }) => [product, supported]),
    [
      ["CLion", true],
      ["GoLand", true],
      ["IntelliJIdea", false],
      ["PyCharm", true],
      ["WebStorm", false],
    ],
  );
  const warnings = describeJetBrainsVersionWarnings(installations);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0] ?? "", /IntelliJ IDEA 2024\.3 does not support MCP/);
  assert.match(warnings[1] ?? "", /WebStorm 2024\.3 does not support MCP/);
});

void test("detecting versions is fail-soft when the config root is missing", async () => {
  assert.deepEqual(
    await detectJetBrainsIdeVersions({
      platform: PLATFORM,
      homeDirectory: "/home/user",
      environment: protectedEnvironment,
    }),
    [],
  );
  assert.deepEqual(
    await detectJetBrainsIdeVersions({
      platform: PLATFORM,
      homeDirectory: "/home/user",
      environment: protectedEnvironment,
      reader: {
        readDirectory: () => Promise.reject(new Error("permission denied")),
      },
    }),
    [],
  );
});

void test("proposes and applies jetbrains config without overwriting existing entries", async (t) => {
  const fixture = await createJetBrainsFixture(t);
  const existingPath = path.join(
    fixture.home,
    ".config",
    "JetBrains",
    "AIAssistant",
    "mcp.json",
  );
  await mkdir(path.dirname(existingPath), { recursive: true });
  await writeFile(
    existingPath,
    JSON.stringify({
      mcpServers: {
        "my-other-server": {
          command: "npx",
          args: ["-y", "@some/package"],
        },
      },
    }),
    "utf8",
  );

  const [proposal] = await proposeHarnessConfigurations({
    selection: "jetbrains",
    projectRoot: fixture.project,
    homeDirectory: fixture.home,
    environment: protectedEnvironment,
    platform: PLATFORM,
  });
  assert.ok(proposal);
  assert.equal(proposal.harness, "jetbrains");
  assert.equal(proposal.state, "compatible");
  assert.equal(
    proposal.target_path,
    path.join(fixture.home, ".config", "JetBrains", "AIAssistant", "mcp.json"),
  );
  assert.equal(
    proposal.steering.target_path,
    resolveJetBrainsRulesPath(fixture.project),
  );
  assert.equal(proposal.requires_confirmation, true);

  const result = await applyHarnessConfiguration({
    proposal,
    confirmation: { approved: true, proposal_id: proposal.proposal_id },
    environment: protectedEnvironment,
  });
  assert.equal(result.outcome, "written");

  const merged = JSON.parse(await readFile(existingPath, "utf8")) as {
    mcpServers: Record<string, unknown>;
  };
  assert.ok(merged.mcpServers["my-other-server"]);
  const managed = merged.mcpServers["local-model-workers"] as {
    command: string;
    env: Record<string, string>;
  };
  assert.equal(managed.command, "local-model-workers-mcp");
  assert.equal(managed.env.LMW_LM_STUDIO_BASE_URL, "http://127.0.0.1:1234/v1");
  assert.equal(managed.env.LMW_ALLOWED_MODELS, '["qwen/qwen3.5-9b"]');
  assert.equal(
    managed.env.LMW_LM_STUDIO_BEARER_TOKEN,
    "fixture-secret-never-print",
  );

  const rules = await readFile(
    resolveJetBrainsRulesPath(fixture.project),
    "utf8",
  );
  assert.ok(rules.startsWith(STEERING_MARKER_START));
  assert.ok(rules.trimEnd().endsWith(STEERING_MARKER_END));
  assert.match(rules, /## Offload repository work to local MCP tools/);
});

void test("jetbrains re-proposal is identical and apply is unchanged", async (t) => {
  const fixture = await createJetBrainsFixture(t);
  const first = await proposeJetBrains(fixture);
  await applyHarnessConfiguration({
    proposal: first,
    confirmation: { approved: true, proposal_id: first.proposal_id },
    environment: protectedEnvironment,
  });
  const again = await proposeJetBrains(fixture);
  assert.equal(again.state, "identical");
  assert.equal(again.steering.state, "identical");
  assert.equal(again.requires_confirmation, false);
  const result = await applyHarnessConfiguration({
    proposal: again,
    environment: protectedEnvironment,
  });
  assert.equal(result.outcome, "unchanged");
});

void test("malformed existing jetbrains config is fail-closed", async (t) => {
  const fixture = await createJetBrainsFixture(t);
  const existingPath = path.join(
    fixture.home,
    ".config",
    "JetBrains",
    "AIAssistant",
    "mcp.json",
  );
  await mkdir(path.dirname(existingPath), { recursive: true });
  await writeFile(existingPath, "not-json", "utf8");

  const proposal = await proposeJetBrains(fixture);
  assert.equal(proposal.state, "malformed");
  assert.equal(proposal.applicable, false);
  await assert.rejects(
    applyHarnessConfiguration({
      proposal,
      confirmation: { approved: true, proposal_id: proposal.proposal_id },
      environment: protectedEnvironment,
    }),
    /cannot be updated safely/,
  );
  assert.equal(await readFile(existingPath, "utf8"), "not-json");
});

void test("configure-harness --target jetbrains writes the shared config", async (t) => {
  const fixture = await createJetBrainsFixture(t);
  const output: string[] = [];
  const exitCode = await runInstallationCommand(
    ["configure-harness", "--target", "jetbrains", "--yes"],
    buildIo(fixture, output),
  );
  assert.equal(exitCode, 0);
  assert.match(output.join(""), /jetbrains: written\./);
  await assert.doesNotReject(
    access(
      path.join(
        fixture.home,
        ".config",
        "JetBrains",
        "AIAssistant",
        "mcp.json",
      ),
    ),
  );
  await assert.doesNotReject(
    access(resolveJetBrainsRulesPath(fixture.project)),
  );
});

void test("configure-harness dry-run previews jetbrains without writing", async (t) => {
  const fixture = await createJetBrainsFixture(t);
  const output: string[] = [];
  const exitCode = await runInstallationCommand(
    ["configure-harness", "--target", "jetbrains", "--dry-run"],
    buildIo(fixture, output),
  );
  assert.equal(exitCode, 0);
  assert.match(output.join(""), /mcpServers\.local-model-workers\.command/);
  await assert.rejects(
    access(
      path.join(
        fixture.home,
        ".config",
        "JetBrains",
        "AIAssistant",
        "mcp.json",
      ),
    ),
  );
});

async function proposeJetBrains(fixture: JetBrainsFixture) {
  const [proposal] = await proposeHarnessConfigurations({
    selection: "jetbrains",
    projectRoot: fixture.project,
    homeDirectory: fixture.home,
    environment: protectedEnvironment,
    platform: PLATFORM,
  });
  if (proposal === undefined) {
    throw new Error("Expected a jetbrains proposal.");
  }
  return proposal;
}

interface JetBrainsFixture {
  readonly root: string;
  readonly home: string;
  readonly project: string;
}

async function createJetBrainsFixture(
  t: test.TestContext,
): Promise<JetBrainsFixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lmw-jetbrains-"));
  const home = path.join(root, "home");
  const project = path.join(root, "project");
  await mkdir(home, { recursive: true });
  await mkdir(project, { recursive: true });
  t.after(async () => rm(root, { recursive: true, force: true }));
  return { root, home, project };
}

function buildIo(
  fixture: JetBrainsFixture,
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
