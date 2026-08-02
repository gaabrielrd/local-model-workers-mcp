import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { writeConfigurationFileAtomically } from "../configuration/index.js";

const MANAGED_SERVER_NAME = "local-model-workers";
const DEFAULT_COMMAND = "local-model-workers-mcp";
const CODEX_MARKER_START = "# local-model-workers-mcp:start";
const CODEX_MARKER_END = "# local-model-workers-mcp:end";
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
}

export interface HarnessConfirmation {
  readonly approved: true;
  readonly proposal_id: string;
}

export interface ProposeHarnessConfigurationsInput {
  readonly selection: HarnessSelection;
  readonly projectRoot?: string;
  readonly homeDirectory?: string;
  readonly command?: string;
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
  if (input.selection === "cancel") {
    return [];
  }

  const command = normalizeCommand(input.command);
  const harnesses: readonly Harness[] =
    input.selection === "all"
      ? ["claude-code", "codex", "antigravity"]
      : input.selection === "both"
        ? ["claude-code", "codex"]
        : [input.selection];

  return Promise.all(
    harnesses.map(async (harness) => {
      const targetPath = resolveTargetPath(harness, input);
      return proposeOne(harness, targetPath, command);
    }),
  );
}

export async function applyHarnessConfiguration(
  input: ApplyHarnessConfigurationInput,
): Promise<HarnessConfigurationResult> {
  const current = await proposeOne(
    input.proposal.harness,
    input.proposal.target_path,
    input.proposal.command,
  );
  if (current.proposal_id !== input.proposal.proposal_id) {
    throw new Error("The harness configuration changed after the proposal.");
  }
  if (!current.applicable) {
    throw new Error("The harness configuration cannot be updated safely.");
  }
  if (current.state === "identical") {
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
  return {
    harness: current.harness,
    target_path: current.target_path,
    outcome: "written",
  };
}

async function proposeOne(
  harness: Harness,
  targetPath: string,
  command: string,
): Promise<HarnessConfigurationProposal> {
  const proposedFile = await inspectHarnessFile(harness, targetPath, command);
  const expectedRevision = revision(proposedFile.currentContents);
  const proposedRevision = revision(proposedFile.proposedContents);
  const proposalId = hash(
    JSON.stringify({
      harness,
      targetPath,
      command,
      expectedRevision,
      proposedRevision,
    }),
  );

  return Object.freeze({
    harness,
    target_path: targetPath,
    state: proposedFile.state,
    applicable: proposedFile.applicable,
    requires_confirmation:
      proposedFile.applicable && proposedFile.state !== "identical",
    proposal_id: proposalId,
    expected_revision: expectedRevision,
    preview: Object.freeze([...proposedFile.preview]),
    command,
  });
}

async function inspectHarnessFile(
  harness: Harness,
  targetPath: string,
  command: string,
): Promise<ProposedFile> {
  const currentContents = await readOptionalFile(targetPath);
  return harness === "claude-code" || harness === "antigravity"
    ? inspectJsonMcpConfiguration(harness, currentContents, command)
    : inspectCodexConfiguration(currentContents, command);
}

function inspectJsonMcpConfiguration(
  harness: "claude-code" | "antigravity",
  currentContents: string | undefined,
  command: string,
): ProposedFile {
  const managedEntry = {
    command,
    args: [] as string[],
    env: {
      LMW_LM_STUDIO_BASE_URL: "${LMW_LM_STUDIO_BASE_URL}",
      LMW_LM_STUDIO_BEARER_TOKEN: "${LMW_LM_STUDIO_BEARER_TOKEN:-}",
      LMW_ALLOWED_MODELS: "${LMW_ALLOWED_MODELS}",
    },
  };
  const preview = [
    `mcpServers.${MANAGED_SERVER_NAME}.command = ${JSON.stringify(command)}`,
    `mcpServers.${MANAGED_SERVER_NAME}.args = []`,
    `mcpServers.${MANAGED_SERVER_NAME}.env = protected environment references only`,
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

function findMarkedRanges(
  contents: string,
): readonly { readonly start: number; readonly end: number }[] | undefined {
  const starts = allIndexes(contents, CODEX_MARKER_START);
  const ends = allIndexes(contents, CODEX_MARKER_END);
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
  const lineEnd = contents.indexOf("\n", endMarker + CODEX_MARKER_END.length);
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
    CODEX_MARKER_START,
    `[mcp_servers.${MANAGED_SERVER_NAME}]`,
    `command = ${JSON.stringify(command)}`,
    "args = []",
    `env_vars = ${JSON.stringify(FORWARDED_ENVIRONMENT_NAMES)}`,
    CODEX_MARKER_END,
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
