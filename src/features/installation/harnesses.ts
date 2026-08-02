import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { writeConfigurationFileAtomically } from "../configuration/index.js";
import {
  STEERING_MARKER_END,
  STEERING_MARKER_START,
  buildSteeringInstructions,
  type SteeringInstructions,
} from "./steering.js";

const MANAGED_SERVER_NAME = "local-model-workers";
const DEFAULT_COMMAND = "local-model-workers-mcp";
const FORWARDED_ENVIRONMENT_NAMES = [
  "LMW_LM_STUDIO_BASE_URL",
  "LMW_LM_STUDIO_BEARER_TOKEN",
  "LMW_ALLOWED_MODELS",
] as const;

export type Harness = "claude-code" | "codex" | "antigravity";
export type HarnessSelection = Harness | "all" | "both" | "cancel";
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
  readonly command: string;
  readonly steering: HarnessSteeringPlan;
  readonly steeringPrompt?: string | undefined;
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
  readonly projectRoot?: string;
  readonly homeDirectory?: string;
  readonly command?: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly steeringPrompt?: string;
}

export interface ApplyHarnessConfigurationInput {
  readonly proposal: HarnessConfigurationProposal;
  readonly confirmation?: HarnessConfirmation;
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
  const harnesses = expandSelection(input.selection);
  const environment = input.environment ?? process.env;

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
      );
    }),
  );
}

function expandSelection(
  selection: readonly Harness[] | HarnessSelection,
): readonly Harness[] {
  if (typeof selection !== "string") {
    return selection;
  }
  if (selection === "cancel") {
    return [];
  }
  if (selection === "all") {
    return ["claude-code", "codex", "antigravity"];
  }
  if (selection === "both") {
    return ["claude-code", "codex"];
  }
  return [selection];
}

export async function applyHarnessConfiguration(
  input: ApplyHarnessConfigurationInput,
): Promise<HarnessConfigurationResult> {
  const current = await proposeOne(
    input.proposal.harness,
    input.proposal.target_path,
    input.proposal.steering.target_path,
    input.proposal.command,
    undefined,
    input.proposal.steeringPrompt,
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
): Promise<HarnessConfigurationProposal> {
  const proposedFile = await inspectHarnessFile(
    harness,
    targetPath,
    command,
    environment,
  );
  const steeringFile = await inspectSteeringFile(
    steeringTargetPath,
    buildSteeringInstructions(
      steeringPrompt === undefined ? {} : { custom_directives: steeringPrompt },
    ),
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
    command,
    ...(steeringPrompt === undefined ? {} : { steeringPrompt }),
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
  return harness === "claude-code" || harness === "antigravity"
    ? inspectJsonMcpConfiguration(
        harness,
        currentContents,
        command,
        environment,
      )
    : inspectCodexConfiguration(currentContents, command);
}

function inspectJsonMcpConfiguration(
  harness: "claude-code" | "antigravity",
  currentContents: string | undefined,
  command: string,
  environment?: Readonly<Record<string, string | undefined>>,
): ProposedFile {
  const envObj =
    harness === "claude-code"
      ? {
          LMW_LM_STUDIO_BASE_URL: "${LMW_LM_STUDIO_BASE_URL}",
          LMW_LM_STUDIO_BEARER_TOKEN: "${LMW_LM_STUDIO_BEARER_TOKEN:-}",
          LMW_ALLOWED_MODELS: "${LMW_ALLOWED_MODELS}",
        }
      : buildAntigravityEnv(environment);
  const managedEntry = {
    command,
    args: [] as string[],
    env: envObj,
  };
  const preview = [
    `mcpServers.${MANAGED_SERVER_NAME}.command = ${JSON.stringify(command)}`,
    `mcpServers.${MANAGED_SERVER_NAME}.args = []`,
    `mcpServers.${MANAGED_SERVER_NAME}.env = ${harness === "claude-code" ? "protected environment references only" : JSON.stringify(envObj)}`,
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
  const label = harness === "claude-code" ? "Claude Code" : "Antigravity";
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
  if (harness === "claude-code") {
    if (
      input.projectRoot === undefined ||
      input.projectRoot.trim().length === 0
    ) {
      throw new Error(
        "A project root is required for Claude Code configuration.",
      );
    }
    return path.resolve(input.projectRoot, ".mcp.json");
  }
  if (
    input.homeDirectory === undefined ||
    input.homeDirectory.trim().length === 0
  ) {
    throw new Error(
      `A home directory is required for ${harness === "antigravity" ? "Antigravity" : "Codex"} configuration.`,
    );
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
  if (harness === "claude-code") {
    if (
      input.projectRoot === undefined ||
      input.projectRoot.trim().length === 0
    ) {
      throw new Error(
        "A project root is required for Claude Code configuration.",
      );
    }
    return path.resolve(input.projectRoot, "AGENTS.md");
  }
  if (
    input.homeDirectory === undefined ||
    input.homeDirectory.trim().length === 0
  ) {
    throw new Error(
      `A home directory is required for ${harness === "antigravity" ? "Antigravity" : "Codex"} configuration.`,
    );
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

function buildAntigravityEnv(
  environment?: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const env: Record<string, string> = {
    LMW_LM_STUDIO_BASE_URL:
      environment?.LMW_LM_STUDIO_BASE_URL ?? "http://localhost:1234/v1",
  };
  const token = environment?.LMW_LM_STUDIO_BEARER_TOKEN?.trim();
  if (token !== undefined && token.length > 0) {
    env.LMW_LM_STUDIO_BEARER_TOKEN = token;
  }
  const allowed = environment?.LMW_ALLOWED_MODELS?.trim();
  if (allowed !== undefined && allowed.length > 0) {
    env.LMW_ALLOWED_MODELS = allowed;
  }
  return env;
}
