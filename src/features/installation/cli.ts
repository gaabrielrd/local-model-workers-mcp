import os from "node:os";
import process from "node:process";

import {
  CONFIGURATION_SCHEMA_VERSION,
  RESULT_VERBOSITY_LEVELS,
  getEffectiveConfiguration,
} from "../configuration/index.js";
import {
  applyGlobalPreferences,
  proposeGlobalPreferences,
} from "./global-preferences.js";
import {
  applyHarnessConfiguration,
  proposeHarnessConfigurations,
  type HarnessConfigurationProposal,
  type HarnessSelection,
} from "./harnesses.js";
import { runInteractiveSetup } from "./interactive.js";

export interface InstallationCommandIo {
  readonly write: (message: string) => void;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly cwd?: string;
  readonly homeDirectory?: string;
  readonly platform?: NodeJS.Platform;
}

export function isInstallationCommand(arguments_: readonly string[]): boolean {
  return (
    arguments_[0] === "configure-harness" ||
    arguments_[0] === "configure-global" ||
    arguments_[0] === "init" ||
    arguments_[0] === "setup" ||
    arguments_[0] === "quickstart"
  );
}

export async function runInstallationCommand(
  arguments_: readonly string[],
  io: InstallationCommandIo,
): Promise<number> {
  try {
    const command = arguments_[0];
    const options = parseOptions(arguments_.slice(1));
    if (command === "init" || command === "setup" || command === "quickstart") {
      return await runInteractiveSetup(options, io);
    }
    if (command === "configure-harness") {
      return await configureHarness(options, io);
    }
    if (command === "configure-global") {
      return await configureGlobal(options, io);
    }
    io.write("Unknown installation command.\n");
    return 64;
  } catch (error: unknown) {
    io.write(`${safeMessage(error)}\n`);
    return 65;
  }
}

async function configureHarness(
  options: ReadonlyMap<string, string | true>,
  io: InstallationCommandIo,
): Promise<number> {
  assertAllowedOptions(options, [
    "target",
    "scope",
    "project-root",
    "home",
    "command",
    "dry-run",
    "yes",
  ]);
  const selection = requiredOption(options, "target");
  if (!isHarnessSelection(selection)) {
    throw new Error(
      "Target must be claude-code, claude-code-project, codex, antigravity, cursor, vscode, neovim, jetbrains, all, both, or cancel.",
    );
  }
  const rawScope = stringOption(options, "scope");
  if (
    rawScope !== undefined &&
    rawScope !== "global" &&
    rawScope !== "project" &&
    rawScope !== "both"
  ) {
    throw new Error("Option --scope must be global, project, or both.");
  }
  const scope = rawScope;
  const executableCommand = stringOption(options, "command");
  const projectRoot =
    stringOption(options, "project-root") ?? io.cwd ?? process.cwd();
  const homeDirectory =
    stringOption(options, "home") ?? io.homeDirectory ?? os.homedir();
  const steeringPrompt = await readSteeringPrompt(
    projectRoot,
    homeDirectory,
    io,
  );
  const proposals = await proposeHarnessConfigurations({
    selection,
    ...(scope === undefined ? {} : { scope }),
    projectRoot,
    homeDirectory,
    environment: io.environment ?? process.env,
    platform: io.platform ?? process.platform,
    ...(executableCommand === undefined ? {} : { command: executableCommand }),
    ...(steeringPrompt === undefined ? {} : { steeringPrompt }),
  });
  if (proposals.length === 0) {
    io.write("Configuration cancelled; no files changed.\n");
    return 0;
  }
  for (const proposal of proposals) {
    printHarnessProposal(proposal, io.write);
  }
  if (proposals.some((proposal) => !proposal.applicable)) {
    io.write("Manual repair is required; no files changed.\n");
    return 65;
  }
  if (options.has("dry-run")) {
    io.write("Dry run complete; no files changed.\n");
    return 0;
  }
  const pending = proposals.filter(
    (proposal) => proposal.requires_confirmation,
  );
  if (pending.length > 0 && !options.has("yes")) {
    io.write("Review the proposal, then repeat with --yes to confirm it.\n");
    return 77;
  }
  for (const proposal of proposals) {
    const result = await applyHarnessConfiguration({
      proposal,
      ...(proposal.requires_confirmation
        ? {
            confirmation: {
              approved: true as const,
              proposal_id: proposal.proposal_id,
            },
          }
        : {}),
      environment: io.environment ?? process.env,
    });
    io.write(`${result.harness}: ${result.outcome}.\n`);
  }
  return 0;
}

async function configureGlobal(
  options: ReadonlyMap<string, string | true>,
  io: InstallationCommandIo,
): Promise<number> {
  const limitNames = [
    "max-concurrency",
    "queue-timeout-ms",
    "processing-timeout-ms",
    "max-exploration-interactions",
    "context-budget-bytes",
  ] as const;
  assertAllowedOptions(options, [
    "default-model",
    "steering-prompt",
    "result-verbosity",
    ...limitNames,
    "home",
    "dry-run",
    "yes",
  ]);
  const limits = Object.fromEntries(
    limitNames
      .filter((name) => options.has(name))
      .map((name) => [
        name.replaceAll("-", "_"),
        positiveIntegerOption(options, name),
      ]),
  );
  const defaultModel = stringOption(options, "default-model");
  const steeringPrompt = stringOption(options, "steering-prompt");
  const resultVerbosity = enumOption(
    options,
    "result-verbosity",
    RESULT_VERBOSITY_LEVELS,
  );
  if (
    defaultModel === undefined &&
    steeringPrompt === undefined &&
    resultVerbosity === undefined &&
    Object.keys(limits).length === 0
  ) {
    throw new Error(
      "At least --default-model, --steering-prompt, --result-verbosity, or one limit is required.",
    );
  }
  const homeDirectory =
    stringOption(options, "home") ?? io.homeDirectory ?? os.homedir();
  const proposal = await proposeGlobalPreferences({
    preferences: {
      schema_version: CONFIGURATION_SCHEMA_VERSION,
      ...(defaultModel === undefined ? {} : { default_model: defaultModel }),
      ...(steeringPrompt === undefined
        ? {}
        : { steering_prompt: steeringPrompt }),
      ...(resultVerbosity === undefined
        ? {}
        : { result_verbosity: resultVerbosity }),
      ...(Object.keys(limits).length === 0 ? {} : { limits }),
    },
    environment: io.environment ?? process.env,
    platform: io.platform ?? process.platform,
    homeDirectory,
  });
  io.write(`global: ${proposal.state} -> ${proposal.target_path}\n`);
  for (const line of proposal.preview) {
    io.write(`  ${line}\n`);
  }
  if (!proposal.applicable) {
    io.write("Manual repair is required; no files changed.\n");
    return 65;
  }
  if (options.has("dry-run")) {
    io.write("Dry run complete; no files changed.\n");
    return 0;
  }
  if (proposal.requires_confirmation && !options.has("yes")) {
    io.write("Review the proposal, then repeat with --yes to confirm it.\n");
    return 77;
  }
  const result = await applyGlobalPreferences({
    proposal,
    ...(proposal.requires_confirmation
      ? {
          confirmation: {
            approved: true as const,
            proposal_id: proposal.proposal_id,
          },
        }
      : {}),
    environment: io.environment ?? process.env,
    platform: io.platform ?? process.platform,
    homeDirectory,
  });
  io.write(`global: ${result.outcome}.\n`);
  return 0;
}

function printHarnessProposal(
  proposal: HarnessConfigurationProposal,
  write: (message: string) => void,
): void {
  write(`${proposal.harness}: ${proposal.state} -> ${proposal.target_path}\n`);
  for (const line of proposal.preview) {
    write(`  ${line}\n`);
  }
  for (const warning of proposal.warnings) {
    write(`  warning: ${warning}\n`);
  }
}

async function readSteeringPrompt(
  projectRoot: string,
  homeDirectory: string,
  io: InstallationCommandIo,
): Promise<string | undefined> {
  try {
    const effective = await getEffectiveConfiguration({
      projectRoot,
      homeDirectory,
      environment: io.environment ?? process.env,
      platform: io.platform ?? process.platform,
    });
    return effective.steering_prompt;
  } catch {
    return undefined;
  }
}

function parseOptions(
  arguments_: readonly string[],
): ReadonlyMap<string, string | true> {
  const options = new Map<string, string | true>();
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (
      argument === undefined ||
      !argument.startsWith("--") ||
      argument.length === 2
    ) {
      throw new Error("Options must use --name value syntax.");
    }
    const name = argument.slice(2);
    if (options.has(name)) {
      throw new Error(`Option --${name} was supplied more than once.`);
    }
    if (name === "dry-run" || name === "yes") {
      options.set(name, true);
      continue;
    }
    const value = arguments_[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Option --${name} requires a value.`);
    }
    options.set(name, value);
    index += 1;
  }
  return options;
}

function assertAllowedOptions(
  options: ReadonlyMap<string, string | true>,
  allowed: readonly string[],
): void {
  for (const name of options.keys()) {
    if (!allowed.includes(name)) {
      throw new Error(`Unknown option: --${name}.`);
    }
  }
}

function requiredOption(
  options: ReadonlyMap<string, string | true>,
  name: string,
): string {
  const value = stringOption(options, name);
  if (value === undefined) {
    throw new Error(`Option --${name} is required.`);
  }
  return value;
}

function stringOption(
  options: ReadonlyMap<string, string | true>,
  name: string,
): string | undefined {
  const value = options.get(name);
  return typeof value === "string" ? value : undefined;
}

function positiveIntegerOption(
  options: ReadonlyMap<string, string | true>,
  name: string,
): number {
  const value = Number(requiredOption(options, name));
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Option --${name} must be a positive integer.`);
  }
  return value;
}

function enumOption(
  options: ReadonlyMap<string, string | true>,
  name: string,
  allowed: readonly string[],
): string | undefined {
  const value = stringOption(options, name);
  if (value === undefined) {
    return undefined;
  }
  if (!allowed.includes(value)) {
    throw new Error(`Option --${name} must be one of: ${allowed.join(", ")}.`);
  }
  return value;
}

function isHarnessSelection(value: string): value is HarnessSelection {
  return (
    value === "claude-code" ||
    value === "claude-code-global" ||
    value === "claude-code-project" ||
    value === "codex" ||
    value === "antigravity" ||
    value === "cursor" ||
    value === "vscode" ||
    value === "neovim" ||
    value === "jetbrains" ||
    value === "all" ||
    value === "both" ||
    value === "cancel"
  );
}

function safeMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Installation command failed.";
}
