import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  writeConfigurationFileAtomically,
  type FeatureGroup,
} from "../configuration/index.js";
import {
  STEERING_MARKER_END,
  STEERING_MARKER_START,
  buildSteeringInstructions,
  type SteeringInstructions,
} from "./steering.js";
import {
  describeJetBrainsVersionWarnings,
  detectJetBrainsIdeVersions,
  resolveJetBrainsMcpConfigPath,
  resolveJetBrainsRulesPath,
} from "./jetbrains.js";

const MANAGED_SERVER_NAME = "local-model-workers";
const DEFAULT_COMMAND = "local-model-workers-mcp";
const FORWARDED_ENVIRONMENT_NAMES = [
  "LMW_LM_STUDIO_BASE_URL",
  "LMW_LM_STUDIO_BEARER_TOKEN",
  "LMW_ALLOWED_MODELS",
] as const;

export type Harness =
  | "claude-code"
  | "claude-code-project"
  | "codex"
  | "antigravity"
  | "cursor"
  | "vscode"
  | "neovim"
  | "jetbrains";
export type HarnessSelection =
  Harness | "claude-code-global" | "all" | "both" | "cancel";
export type InstallationState =
  "fresh" | "identical" | "compatible" | "conflicting" | "malformed";

export interface HarnessConfigurationProposal {
  readonly harness: Harness;
  readonly target_path: string;
  readonly state: InstallationState;
  readonly applicable: boolean;
  readonly requires_confirmation: boolean;
  readonly proposal_id: `sha256:${string}`;
  readonly expected_revision: `sha256:${string}`;
  readonly preview: readonly string[];
  readonly warnings: readonly string[];
  readonly command: string;
  readonly steering: HarnessSteeringPlan;
  readonly steeringPrompt?: string | undefined;
  readonly enabledFeatures?: readonly FeatureGroup[] | undefined;
}

export interface HarnessSteeringPlan {
  readonly target_path: string;
  readonly state: InstallationState;
  readonly applicable: boolean;
  readonly expected_revision: `sha256:${string}`;
  readonly preview: readonly string[];
  readonly proposed_contents?: string | undefined;
}

export interface HarnessConfirmation {
  readonly approved: true;
  readonly proposal_id: string;
}

export interface ProposeHarnessConfigurationsInput {
  readonly selection: readonly Harness[] | HarnessSelection;
  readonly scope?: "global" | "project" | "both";
  readonly projectRoot?: string;
  readonly homeDirectory?: string;
  readonly command?: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
  readonly steeringPrompt?: string;
  readonly enabledFeatures?: readonly FeatureGroup[] | undefined;
}

export interface ApplyHarnessConfigurationInput {
  readonly proposal: HarnessConfigurationProposal;
  readonly confirmation?: HarnessConfirmation;
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

export interface HarnessConfigurationResult {
  readonly harness: Harness;
  readonly target_path: string;
  readonly outcome: "unchanged" | "written";
}

interface ProposedFile {
  readonly state: InstallationState;
  readonly applicable: boolean;
  readonly currentContents: string | undefined;
  readonly proposedContents: string | undefined;
  readonly preview: readonly string[];
}

export async function proposeHarnessConfigurations(
  input: ProposeHarnessConfigurationsInput,
): Promise<readonly HarnessConfigurationProposal[]> {
  const command = normalizeCommand(input.command);
  const harnesses = expandSelection(input.selection, input.scope);
  const environment = input.environment ?? process.env;
  const platform = input.platform ?? process.platform;
  const warnings = await resolveWarnings(
    harnesses,
    platform,
    input.homeDirectory,
    environment,
  );

  return Promise.all(
    harnesses.map(async (harness) => {
      const targetPath = resolveTargetPath(harness, input);
      const steeringTargetPath = resolveSteeringTargetPath(harness, input);
      return proposeOne(
        harness,
        targetPath,
        steeringTargetPath,
        command,
        environment,
        input.steeringPrompt,
        input.enabledFeatures,
        warnings.get(harness) ?? [],
      );
    }),
  );
}

async function resolveWarnings(
  harnesses: readonly Harness[],
  platform: NodeJS.Platform,
  homeDirectory: string | undefined,
  environment: Readonly<Record<string, string | undefined>>,
): Promise<ReadonlyMap<Harness, readonly string[]>> {
  if (
    !harnesses.includes("jetbrains") ||
    homeDirectory === undefined ||
    homeDirectory.trim().length === 0
  ) {
    return new Map();
  }
  const installations = await detectJetBrainsIdeVersions({
    platform,
    homeDirectory,
    environment,
  });
  return new Map([
    ["jetbrains", describeJetBrainsVersionWarnings(installations)],
  ]);
}

function expandSelection(
  selection: readonly Harness[] | HarnessSelection,
  scope?: "global" | "project" | "both",
): readonly Harness[] {
  if (typeof selection !== "string") {
    return applyScopeToHarnesses(selection, scope);
  }
  if (selection === "cancel") {
    return [];
  }
  let base: readonly Harness[];
  if (selection === "claude-code-global") {
    base = ["claude-code"];
  } else if (selection === "all") {
    base = [
      "claude-code",
      "codex",
      "antigravity",
      "cursor",
      "vscode",
      "neovim",
      "jetbrains",
    ];
  } else if (selection === "both") {
    base = ["claude-code", "codex"];
  } else {
    base = [selection];
  }
  return applyScopeToHarnesses(base, scope);
}

function applyScopeToHarnesses(
  harnesses: readonly Harness[],
  scope?: "global" | "project" | "both",
): readonly Harness[] {
  if (scope === undefined || scope === "global") {
    return harnesses;
  }
  const result: Harness[] = [];
  for (const item of harnesses) {
    if (item === "claude-code") {
      if (scope === "project") {
        result.push("claude-code-project");
      } else if (scope === "both") {
        result.push("claude-code", "claude-code-project");
      }
    } else {
      result.push(item);
    }
  }
  return result;
}

export async function applyHarnessConfiguration(
  input: ApplyHarnessConfigurationInput,
): Promise<HarnessConfigurationResult> {
  const current = await proposeOne(
    input.proposal.harness,
    input.proposal.target_path,
    input.proposal.steering.target_path,
    input.proposal.command,
    input.environment,
    input.proposal.steeringPrompt,
    input.proposal.enabledFeatures,
    input.proposal.warnings,
  );
  if (current.proposal_id !== input.proposal.proposal_id) {
    throw new Error("The harness configuration changed after the proposal.");
  }
  if (!current.applicable) {
    throw new Error("The harness configuration cannot be updated safely.");
  }
  if (current.state === "identical" && current.steering.state === "identical") {
    return {
      harness: current.harness,
      target_path: current.target_path,
      outcome: "unchanged",
    };
  }
  if (
    input.confirmation?.approved !== true ||
    input.confirmation.proposal_id !== current.proposal_id
  ) {
    throw new Error("Explicit confirmation for this proposal is required.");
  }

  const proposedFile = await inspectHarnessFile(
    current.harness,
    current.target_path,
    current.command,
    input.environment,
  );
  if (proposedFile.proposedContents === undefined) {
    throw new Error("The harness configuration cannot be updated safely.");
  }
  await mkdir(path.dirname(current.target_path), {
    recursive: true,
    mode: 0o700,
  });
  await writeConfigurationFileAtomically(
    current.target_path,
    proposedFile.proposedContents,
  );

  if (current.steering.proposed_contents === undefined) {
    throw new Error("The harness configuration cannot be updated safely.");
  }
  await mkdir(path.dirname(current.steering.target_path), {
    recursive: true,
    mode: 0o700,
  });
  await writeConfigurationFileAtomically(
    current.steering.target_path,
    current.steering.proposed_contents,
  );
  return {
    harness: current.harness,
    target_path: current.target_path,
    outcome: "written",
  };
}

async function proposeOne(
  harness: Harness,
  targetPath: string,
  steeringTargetPath: string,
  command: string,
  environment?: Readonly<Record<string, string | undefined>>,
  steeringPrompt?: string,
  enabledFeatures?: readonly FeatureGroup[],
  warnings: readonly string[] = [],
): Promise<HarnessConfigurationProposal> {
  const proposedFile = await inspectHarnessFile(
    harness,
    targetPath,
    command,
    environment,
  );
  const steeringFile = await inspectSteeringFile(
    steeringTargetPath,
    buildSteeringInstructions({
      ...(steeringPrompt === undefined
        ? {}
        : { custom_directives: steeringPrompt }),
      ...(enabledFeatures === undefined
        ? {}
        : { enabled_features: enabledFeatures }),
    }),
  );
  const expectedRevision = revision(proposedFile.currentContents);
  const proposedRevision = revision(proposedFile.proposedContents);
  const steeringExpectedRevision = revision(steeringFile.currentContents);
  const steeringProposedRevision = revision(steeringFile.proposedContents);
  const proposalId = hash(
    JSON.stringify({
      harness,
      targetPath,
      steeringTargetPath,
      command,
      steeringPrompt,
      enabledFeatures,
      expectedRevision,
      proposedRevision,
      steeringExpectedRevision,
      steeringProposedRevision,
    }),
  );
  const applicable = proposedFile.applicable && steeringFile.applicable;

  return Object.freeze({
    harness,
    target_path: targetPath,
    state: proposedFile.state,
    applicable,
    requires_confirmation:
      applicable &&
      (proposedFile.state !== "identical" ||
        steeringFile.state !== "identical"),
    proposal_id: proposalId,
    expected_revision: expectedRevision,
    preview: Object.freeze([...proposedFile.preview, ...steeringFile.preview]),
    warnings: Object.freeze([...warnings]),
    command,
    ...(steeringPrompt === undefined ? {} : { steeringPrompt }),
    ...(enabledFeatures === undefined ? {} : { enabledFeatures }),
    steering: Object.freeze({
      target_path: steeringTargetPath,
      state: steeringFile.state,
      applicable: steeringFile.applicable,
      expected_revision: steeringExpectedRevision,
      preview: Object.freeze([...steeringFile.preview]),
      ...(steeringFile.proposedContents === undefined
        ? {}
        : { proposed_contents: steeringFile.proposedContents }),
    }),
  });
}

async function inspectHarnessFile(
  harness: Harness,
  targetPath: string,
  command: string,
  environment?: Readonly<Record<string, string | undefined>>,
): Promise<ProposedFile> {
  const currentContents = await readOptionalFile(targetPath);
  return harness === "codex"
    ? inspectCodexConfiguration(currentContents, command)
    : inspectJsonMcpConfiguration(
        harness,
        currentContents,
        command,
        environment,
      );
}

function inspectJsonMcpConfiguration(
  harness: Exclude<Harness, "codex">,
  currentContents: string | undefined,
  command: string,
  environment?: Readonly<Record<string, string | undefined>>,
): ProposedFile {
  const envObj = buildMcpEnv(harness, environment);
  const managedEntry = {
    command,
    args: [] as string[],
    env: envObj,
  };
  const preview = [
    `mcpServers.${MANAGED_SERVER_NAME}.command = ${JSON.stringify(command)}`,
    `mcpServers.${MANAGED_SERVER_NAME}.args = []`,
    `mcpServers.${MANAGED_SERVER_NAME}.env = ${formatEnvPreview(envObj)}`,
  ];
  if (currentContents === undefined) {
    return {
      state: "fresh",
      applicable: true,
      currentContents,
      proposedContents: serializeJson({
        mcpServers: { [MANAGED_SERVER_NAME]: managedEntry },
      }),
      preview,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(currentContents);
  } catch {
    return malformed(currentContents, preview);
  }
  if (!isRecord(parsed)) {
    return malformed(currentContents, preview);
  }
  const servers = parsed.mcpServers;
  if (servers !== undefined && !isRecord(servers)) {
    return malformed(currentContents, preview);
  }
  const existingEntry = isRecord(servers)
    ? servers[MANAGED_SERVER_NAME]
    : undefined;
  if (existingEntry !== undefined && deepEqual(existingEntry, managedEntry)) {
    return {
      state: "identical",
      applicable: true,
      currentContents,
      proposedContents: currentContents,
      preview,
    };
  }

  const proposed = {
    ...parsed,
    mcpServers: {
      ...(servers ?? {}),
      [MANAGED_SERVER_NAME]: managedEntry,
    },
  };
  const label =
    harness === "claude-code"
      ? "Claude Code (Global)"
      : harness === "claude-code-project"
        ? "Claude Code (Project)"
        : harness === "antigravity"
          ? "Antigravity"
          : harness === "cursor"
            ? "Cursor"
            : harness === "vscode"
              ? "VS Code"
              : harness === "neovim"
                ? "Neovim"
                : "JetBrains (AI Assistant)";
  return {
    state: existingEntry === undefined ? "compatible" : "conflicting",
    applicable: true,
    currentContents,
    proposedContents: serializeJson(proposed),
    preview:
      existingEntry === undefined
        ? preview
        : [`replace existing managed ${label} entry`, ...preview],
  };
}

function inspectCodexConfiguration(
  currentContents: string | undefined,
  command: string,
): ProposedFile {
  const block = codexManagedBlock(command);
  const preview = [
    `[mcp_servers.${MANAGED_SERVER_NAME}]`,
    `command = ${JSON.stringify(command)}`,
    "args = []",
    `env_vars = ${JSON.stringify(FORWARDED_ENVIRONMENT_NAMES)}`,
  ];
  if (currentContents === undefined) {
    return {
      state: "fresh",
      applicable: true,
      currentContents,
      proposedContents: `${block}\n`,
      preview,
    };
  }

  const markerRanges = findMarkedRanges(currentContents);
  if (markerRanges === undefined) {
    return malformed(currentContents, preview);
  }
  if (markerRanges.length === 1) {
    const range = markerRanges[0];
    if (range === undefined) {
      return malformed(currentContents, preview);
    }
    const existing = currentContents.slice(range.start, range.end).trim();
    if (existing === block) {
      return {
        state: "identical",
        applicable: true,
        currentContents,
        proposedContents: currentContents,
        preview,
      };
    }
    return {
      state: "conflicting",
      applicable: true,
      currentContents,
      proposedContents: replaceRange(currentContents, range, block),
      preview: ["replace existing managed Codex entry", ...preview],
    };
  }

  const unmarkedRanges = findUnmarkedCodexRanges(currentContents);
  if (unmarkedRanges === undefined) {
    return malformed(currentContents, preview);
  }
  if (unmarkedRanges.length === 1) {
    const range = unmarkedRanges[0];
    if (range === undefined) {
      return malformed(currentContents, preview);
    }
    return {
      state: "conflicting",
      applicable: true,
      currentContents,
      proposedContents: replaceRange(currentContents, range, block),
      preview: ["replace existing unmarked Codex entry", ...preview],
    };
  }

  const separator =
    currentContents.length === 0 || currentContents.endsWith("\n\n")
      ? ""
      : currentContents.endsWith("\n")
        ? "\n"
        : "\n\n";
  return {
    state: "compatible",
    applicable: true,
    currentContents,
    proposedContents: `${currentContents}${separator}${block}\n`,
    preview,
  };
}

async function inspectSteeringFile(
  targetPath: string,
  instructions: SteeringInstructions,
): Promise<ProposedFile> {
  const currentContents = await readOptionalFile(targetPath);
  const preview = [
    `instructions: ${JSON.stringify(path.basename(targetPath))}`,
    ...instructions.preview,
  ];
  if (currentContents === undefined) {
    return {
      state: "fresh",
      applicable: true,
      currentContents,
      proposedContents: `${instructions.block}\n`,
      preview,
    };
  }
  const markerRanges = findMarkedRanges(currentContents);
  if (markerRanges === undefined) {
    return malformed(currentContents, preview);
  }
  if (markerRanges.length === 1) {
    const range = markerRanges[0];
    if (range === undefined) {
      return malformed(currentContents, preview);
    }
    const existing = currentContents.slice(range.start, range.end).trim();
    if (existing === instructions.block) {
      return {
        state: "identical",
        applicable: true,
        currentContents,
        proposedContents: currentContents,
        preview,
      };
    }
    return {
      state: "conflicting",
      applicable: true,
      currentContents,
      proposedContents: replaceRange(
        currentContents,
        range,
        instructions.block,
      ),
      preview: ["replace existing managed instructions block", ...preview],
    };
  }

  const separator =
    currentContents.length === 0 || currentContents.endsWith("\n\n")
      ? ""
      : currentContents.endsWith("\n")
        ? "\n"
        : "\n\n";
  return {
    state: "compatible",
    applicable: true,
    currentContents,
    proposedContents: `${currentContents}${separator}${instructions.block}\n`,
    preview,
  };
}

function findMarkedRanges(
  contents: string,
): readonly { readonly start: number; readonly end: number }[] | undefined {
  const starts = allIndexes(contents, STEERING_MARKER_START);
  const ends = allIndexes(contents, STEERING_MARKER_END);
  if (starts.length !== ends.length || starts.length > 1) {
    return undefined;
  }
  if (starts.length === 0) {
    return [];
  }
  const start = starts[0];
  const endMarker = ends[0];
  if (start === undefined || endMarker === undefined || endMarker < start) {
    return undefined;
  }
  const lineEnd = contents.indexOf(
    "\n",
    endMarker + STEERING_MARKER_END.length,
  );
  return [{ start, end: lineEnd === -1 ? contents.length : lineEnd }];
}
function findUnmarkedCodexRanges(
  contents: string,
): readonly { readonly start: number; readonly end: number }[] | undefined {
  const header = `[mcp_servers.${MANAGED_SERVER_NAME}]`;
  const starts = allIndexes(contents, header).filter(
    (index) => index === 0 || contents[index - 1] === "\n",
  );
  if (starts.length > 1) {
    return undefined;
  }
  return starts.map((start) => {
    const nextTable = contents.indexOf("\n[", start + header.length);
    return { start, end: nextTable === -1 ? contents.length : nextTable + 1 };
  });
}

function codexManagedBlock(command: string): string {
  return [
    STEERING_MARKER_START,
    `[mcp_servers.${MANAGED_SERVER_NAME}]`,
    `command = ${JSON.stringify(command)}`,
    "args = []",
    `env_vars = ${JSON.stringify(FORWARDED_ENVIRONMENT_NAMES)}`,
    STEERING_MARKER_END,
  ].join("\n");
}

function replaceRange(
  contents: string,
  range: { readonly start: number; readonly end: number },
  replacement: string,
): string {
  const suffix = contents.slice(range.end);
  return `${contents.slice(0, range.start)}${replacement}${suffix.startsWith("\n") || suffix.length === 0 ? "" : "\n"}${suffix}`;
}

function resolveTargetPath(
  harness: Harness,
  input: ProposeHarnessConfigurationsInput,
): string {
  if (harness === "claude-code-project") {
    if (
      input.projectRoot === undefined ||
      input.projectRoot.trim().length === 0
    ) {
      throw new Error(
        "A project root is required for project-scoped Claude Code configuration.",
      );
    }
    return path.resolve(input.projectRoot, ".mcp.json");
  }
  if (harness === "cursor") {
    if (input.scope === "project" && input.projectRoot) {
      return path.resolve(input.projectRoot, ".cursor", "mcp.json");
    }
    if (
      input.homeDirectory === undefined ||
      input.homeDirectory.trim().length === 0
    ) {
      throw new Error("A home directory is required for Cursor configuration.");
    }
    return path.resolve(input.homeDirectory, ".cursor", "mcp.json");
  }
  if (harness === "vscode") {
    if (input.scope === "project" && input.projectRoot) {
      return path.resolve(input.projectRoot, ".vscode", "mcp.json");
    }
    if (
      input.homeDirectory === undefined ||
      input.homeDirectory.trim().length === 0
    ) {
      throw new Error(
        "A home directory is required for VS Code configuration.",
      );
    }
    return path.resolve(input.homeDirectory, ".vscode", "mcp.json");
  }
  if (harness === "neovim") {
    if (input.scope === "project" && input.projectRoot) {
      return path.resolve(input.projectRoot, ".neovim", "mcp.json");
    }
    if (
      input.homeDirectory === undefined ||
      input.homeDirectory.trim().length === 0
    ) {
      throw new Error("A home directory is required for Neovim configuration.");
    }
    return path.resolve(input.homeDirectory, ".config", "nvim", "mcp.json");
  }
  if (harness === "jetbrains") {
    if (
      input.homeDirectory === undefined ||
      input.homeDirectory.trim().length === 0
    ) {
      throw new Error(
        "A home directory is required for JetBrains configuration.",
      );
    }
    return resolveJetBrainsMcpConfigPath({
      platform: input.platform ?? process.platform,
      homeDirectory: input.homeDirectory,
      environment: input.environment ?? process.env,
    });
  }
  if (
    input.homeDirectory === undefined ||
    input.homeDirectory.trim().length === 0
  ) {
    throw new Error(
      `A home directory is required for ${harness === "antigravity" ? "Antigravity" : harness === "codex" ? "Codex" : "Claude Code"} configuration.`,
    );
  }
  if (harness === "claude-code") {
    return path.resolve(input.homeDirectory, ".claude.json");
  }
  if (harness === "antigravity") {
    return path.resolve(
      input.homeDirectory,
      ".gemini",
      "config",
      "mcp_config.json",
    );
  }
  return path.resolve(input.homeDirectory, ".codex", "config.toml");
}

function resolveSteeringTargetPath(
  harness: Harness,
  input: ProposeHarnessConfigurationsInput,
): string {
  if (harness === "claude-code-project") {
    if (
      input.projectRoot === undefined ||
      input.projectRoot.trim().length === 0
    ) {
      throw new Error(
        "A project root is required for project-scoped Claude Code configuration.",
      );
    }
    return path.resolve(input.projectRoot, "AGENTS.md");
  }
  if (harness === "cursor") {
    if (input.scope === "project" && input.projectRoot) {
      return path.resolve(input.projectRoot, ".cursor", "rules", "mcp.md");
    }
    if (
      input.homeDirectory === undefined ||
      input.homeDirectory.trim().length === 0
    ) {
      throw new Error("A home directory is required for Cursor configuration.");
    }
    return path.resolve(input.homeDirectory, ".cursor", "rules", "mcp.md");
  }
  if (harness === "vscode") {
    if (input.scope === "project" && input.projectRoot) {
      return path.resolve(input.projectRoot, ".vscode", "instructions.md");
    }
    if (
      input.homeDirectory === undefined ||
      input.homeDirectory.trim().length === 0
    ) {
      throw new Error(
        "A home directory is required for VS Code configuration.",
      );
    }
    return path.resolve(input.homeDirectory, ".vscode", "instructions.md");
  }
  if (harness === "neovim") {
    if (input.scope === "project" && input.projectRoot) {
      return path.resolve(input.projectRoot, ".neovim", "instructions.md");
    }
    if (
      input.homeDirectory === undefined ||
      input.homeDirectory.trim().length === 0
    ) {
      throw new Error("A home directory is required for Neovim configuration.");
    }
    return path.resolve(
      input.homeDirectory,
      ".config",
      "nvim",
      "instructions.md",
    );
  }
  if (harness === "jetbrains") {
    if (
      input.projectRoot === undefined ||
      input.projectRoot.trim().length === 0
    ) {
      throw new Error(
        "A project root is required for JetBrains steering rules.",
      );
    }
    return resolveJetBrainsRulesPath(input.projectRoot);
  }
  if (
    input.homeDirectory === undefined ||
    input.homeDirectory.trim().length === 0
  ) {
    throw new Error(
      `A home directory is required for ${harness === "antigravity" ? "Antigravity" : harness === "codex" ? "Codex" : "Claude Code"} configuration.`,
    );
  }
  if (harness === "claude-code") {
    return path.resolve(input.homeDirectory, ".claude", "CLAUDE.md");
  }
  if (harness === "antigravity") {
    return path.resolve(input.homeDirectory, ".gemini", "instructions.md");
  }
  return path.resolve(input.homeDirectory, ".codex", "instructions.md");
}

function normalizeCommand(command: string | undefined): string {
  const normalized = command?.trim() ?? DEFAULT_COMMAND;
  if (normalized.length === 0 || normalized.includes("\0")) {
    throw new Error("The executable command is invalid.");
  }
  return normalized;
}

async function readOptionalFile(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error: unknown) {
    if (isFileSystemError(error, "ENOENT")) {
      return undefined;
    }
    throw new Error("The harness configuration cannot be read.", {
      cause: error,
    });
  }
}

function malformed(
  currentContents: string,
  preview: readonly string[],
): ProposedFile {
  return {
    state: "malformed",
    applicable: false,
    currentContents,
    proposedContents: undefined,
    preview: ["manual repair required; no write will be attempted", ...preview],
  };
}

function revision(contents: string | undefined): `sha256:${string}` {
  return hash(contents === undefined ? "<missing>" : contents);
}

function hash(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, undefined, 2)}\n`;
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function allIndexes(contents: string, value: string): number[] {
  const indexes: number[] = [];
  let from = 0;
  while (from <= contents.length) {
    const index = contents.indexOf(value, from);
    if (index === -1) {
      break;
    }
    indexes.push(index);
    from = index + value.length;
  }
  return indexes;
}

function isFileSystemError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function buildMcpEnv(
  harness: Exclude<Harness, "codex">,
  environment?: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const env: Record<string, string> = {
    LMW_LM_STUDIO_BASE_URL:
      environment?.LMW_LM_STUDIO_BASE_URL ?? "http://localhost:1234/v1",
  };
  const allowed = environment?.LMW_ALLOWED_MODELS?.trim();
  if (allowed !== undefined && allowed.length > 0) {
    env.LMW_ALLOWED_MODELS = allowed;
  }
  if (harness === "antigravity" || harness === "jetbrains") {
    const token = environment?.LMW_LM_STUDIO_BEARER_TOKEN?.trim();
    if (token !== undefined && token.length > 0) {
      env.LMW_LM_STUDIO_BEARER_TOKEN = token;
    }
  }
  return env;
}

function formatEnvPreview(envObj: Record<string, string>): string {
  const safeEnv = { ...envObj };
  if (safeEnv.LMW_LM_STUDIO_BEARER_TOKEN !== undefined) {
    safeEnv.LMW_LM_STUDIO_BEARER_TOKEN = "<redacted>";
  }
  return JSON.stringify(safeEnv);
}
